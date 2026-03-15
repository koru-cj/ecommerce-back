import { Router } from 'express';
import crypto from 'crypto';
import { pool } from '../db.js';

const router = Router();

function parseXSignature(headerValue = '') {
  const out = {};

  for (const part of String(headerValue).split(',')) {
    const [k, v] = part.split('=');
    if (k && v) out[k.trim()] = v.trim();
  }

  return {
    ts: out.ts,
    v1: out.v1,
  };
}

function validateMercadoPagoSignature(req) {
  const secret = process.env.MP_WEBHOOK_SECRET;

  if (!secret) {
    console.warn('MP_WEBHOOK_SECRET no configurado. Se omite validación de firma.');
    return true;
  }

  const xSignature = req.headers['x-signature'];
  const xRequestId = req.headers['x-request-id'];

  if (!xSignature || !xRequestId) return false;

  const { ts, v1 } = parseXSignature(String(xSignature));
  if (!ts || !v1) return false;

  const dataId =
    req.query['data.id'] ||
    req.body?.data?.id ||
    req.query.id ||
    req.body?.id ||
    '';

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;

  const hash = crypto
    .createHmac('sha256', secret)
    .update(manifest)
    .digest('hex');

  return hash === v1;
}

async function getPaymentById(paymentId) {
  const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${process.env.MP_ACCESSTOKEN}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`MP payment lookup failed: ${response.status} - ${text}`);
  }

  return response.json();
}

router.post('/webhook', async (req, res) => {
  // responder rápido a MP
  res.sendStatus(200);

  try {
    const isValid = validateMercadoPagoSignature(req);
    if (!isValid) {
      console.warn('Webhook inválido: firma incorrecta');
      return;
    }

    const topic =
      req.query.type ||
      req.body?.type ||
      req.query.topic ||
      req.body?.topic;

    if (topic !== 'payment') {
      return;
    }

    const mpPaymentId =
      req.query['data.id'] ||
      req.body?.data?.id ||
      req.query.id ||
      req.body?.id;

    if (!mpPaymentId) {
      console.warn('Webhook sin payment id');
      return;
    }

    const payment = await getPaymentById(mpPaymentId);

    const orderId = Number(payment.external_reference);
    if (!orderId) {
      console.warn('Pago sin external_reference usable');
      return;
    }

    const mpStatus = payment.status ?? null;
    const mpStatusDetail = payment.status_detail ?? null;

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // 1) Bloquear payment local
      const { rows: [existingPayment] } = await client.query(`
        SELECT id, order_id, status, provider_id
        FROM payments
        WHERE order_id = $1
        ORDER BY id ASC
        LIMIT 1
        FOR UPDATE
      `, [orderId]);

      if (!existingPayment) {
        throw new Error(`No existe payment local para order ${orderId}`);
      }

      // 2) Bloquear orden
      const { rows: [orderRow] } = await client.query(`
        SELECT id, status, payment_status
        FROM orders
        WHERE id = $1
        FOR UPDATE
      `, [orderId]);

      if (!orderRow) {
        throw new Error(`No existe order local para order ${orderId}`);
      }

      // 3) Idempotencia: si ya procesaste este mismo pago aprobado, no repitas descuento
      const alreadyApprovedSamePayment =
        existingPayment.provider_id &&
        String(existingPayment.provider_id) === String(payment.id) &&
        existingPayment.status === 'approved' &&
        orderRow.payment_status === 'paid';

      if (alreadyApprovedSamePayment) {
        await client.query('COMMIT');
        return;
      }

      // 4) Pago aprobado: acá recién se descuenta stock
      if (mpStatus === 'approved') {
        const { rows: orderItems } = await client.query(`
          SELECT
            oi.product_id,
            oi.quantity,
            p.stock,
            p.name
          FROM order_items oi
          JOIN products p ON p.id = oi.product_id
          WHERE oi.order_id = $1
          FOR UPDATE OF p
        `, [orderId]);

        // Validar stock real al momento del cobro
        for (const it of orderItems) {
          if (Number(it.stock) < Number(it.quantity)) {
            await client.query(`
              UPDATE payments
              SET
                provider_id = $1,
                provider_status = $2,
                provider_status_detail = $3,
                provider_payload = $4,
                status = 'approved',
                metadata = COALESCE(metadata, '{}'::jsonb) || $5::jsonb,
                updated_at = NOW()
              WHERE id = $6
            `, [
              String(payment.id),
              mpStatus,
              'approved_but_no_stock',
              JSON.stringify(payment),
              JSON.stringify({
                stock_error: true,
                stock_error_at: new Date().toISOString(),
                stock_error_reason: `Sin stock al acreditar pago para ${it.name}`,
              }),
              existingPayment.id,
            ]);

            await client.query(`
              UPDATE orders
              SET
                status = 'manual_review',
                payment_status = 'paid',
                updated_at = NOW()
              WHERE id = $1
            `, [orderId]);

            await client.query('COMMIT');
            console.error(`Orden ${orderId} aprobada en MP pero sin stock suficiente.`);
            return;
          }
        }

        // Si hay stock, descontar ahora
        for (const it of orderItems) {
          await client.query(`
            UPDATE products
            SET stock = stock - $1
            WHERE id = $2
          `, [it.quantity, it.product_id]);
        }
        await client.query(
            `
            DELETE FROM cart_items
            WHERE user_id = (
              SELECT user_id
              FROM orders
              WHERE id = $1
            )
            `,
            [orderId]
          );


        await client.query(`
          UPDATE payments
          SET
            provider_id = $1,
            provider_status = $2,
            provider_status_detail = $3,
            provider_payload = $4,
            status = 'approved',
            metadata = COALESCE(metadata, '{}'::jsonb) || $5::jsonb,
            updated_at = NOW()
          WHERE id = $6
        `, [
          String(payment.id),
          mpStatus,
          mpStatusDetail,
          JSON.stringify(payment),
          
              JSON.stringify({
              stock_discounted: true,
              stock_discounted_at: new Date().toISOString(),
              cart_cleared: true,
              cart_cleared_at: new Date().toISOString(),
            }),

            
          existingPayment.id,
        ]);

        await client.query(`
          UPDATE orders
          SET
            status = 'paid',
            payment_status = 'paid',
            updated_at = NOW()
          WHERE id = $1
        `, [orderId]);

        await client.query('COMMIT');
        return;
      }

      // 5) Pago pendiente / en proceso
      if (['pending', 'in_process', 'in_mediation'].includes(mpStatus)) {
        await client.query(`
          UPDATE payments
          SET
            provider_id = $1,
            provider_status = $2,
            provider_status_detail = $3,
            provider_payload = $4,
            status = 'pending',
            updated_at = NOW()
          WHERE id = $5
        `, [
          String(payment.id),
          mpStatus,
          mpStatusDetail,
          JSON.stringify(payment),
          existingPayment.id,
        ]);

        await client.query(`
          UPDATE orders
          SET
            status = 'pending_payment',
            payment_status = 'pending',
            updated_at = NOW()
          WHERE id = $1
        `, [orderId]);

        await client.query('COMMIT');
        return;
      }

      // 6) Pago rechazado / cancelado / refund / chargeback
      if (['rejected', 'cancelled', 'refunded', 'charged_back'].includes(mpStatus)) {
        await client.query(`
          UPDATE payments
          SET
            provider_id = $1,
            provider_status = $2,
            provider_status_detail = $3,
            provider_payload = $4,
            status = 'failed',
            updated_at = NOW()
          WHERE id = $5
        `, [
          String(payment.id),
          mpStatus,
          mpStatusDetail,
          JSON.stringify(payment),
          existingPayment.id,
        ]);

        await client.query(`
          UPDATE orders
          SET
            status = 'payment_failed',
            payment_status = 'failed',
            updated_at = NOW()
          WHERE id = $1
        `, [orderId]);

        await client.query('COMMIT');
        return;
      }

      // 7) Otros estados desconocidos
      await client.query(`
        UPDATE payments
        SET
          provider_id = $1,
          provider_status = $2,
          provider_status_detail = $3,
          provider_payload = $4,
          updated_at = NOW()
        WHERE id = $5
      `, [
        String(payment.id),
        mpStatus,
        mpStatusDetail,
        JSON.stringify(payment),
        existingPayment.id,
      ]);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error webhook Mercado Pago:', error);
  }
});

export default router;
