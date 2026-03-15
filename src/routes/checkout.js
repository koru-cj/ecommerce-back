import { Router } from 'express';
import crypto from 'crypto';
import { MercadoPagoConfig, Preference } from 'mercadopago';
import { pool } from '../db.js';
import { authRequired } from '../middlewares/authMiddleware.js';

const router = Router();

const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESSTOKEN,
});

const formatARS = (n) =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
  }).format(Number(n || 0));

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

async function getMercadoPagoPaymentById(paymentId) {
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

/**
 * POST /api/v1/checkout/init
 * body: { channel: 'whatsapp' | 'mercadopago' }
 */
router.post('/init', authRequired(), async (req, res) => {
  const userId = req.user.id;
  const { channel = 'whatsapp' } = req.body;

  if (!['whatsapp', 'mercadopago'].includes(channel)) {
    return res.status(400).json({ error: 'Canal de checkout inválido.' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows: items } = await client.query(
      `
      SELECT
        p.id AS product_id,
        p.name,
        p.price,
        p.stock,
        c.quantity
      FROM cart_items c
      JOIN products p ON p.id = c.product_id
      WHERE c.user_id = $1
      FOR UPDATE OF p
      `,
      [userId]
    );

    if (items.length === 0) {
      throw new Error('Carrito vacío');
    }

    for (const it of items) {
      if (Number(it.stock) < Number(it.quantity)) {
        throw new Error(`Sin stock de ${it.name}`);
      }
    }

    const subtotal = items.reduce(
      (s, it) => s + Number(it.price) * Number(it.quantity),
      0
    );
    const shipping = 0;
    const discount = 0;
    const tax = 0;
    const total = subtotal - discount + shipping + tax;

    const { rows: [profile] } = await client.query(
      `
      SELECT
        name,
        email,
        phone,
        document_number,
        address,
        city,
        postal_code,
        country
      FROM users
      WHERE id = $1
      `,
      [userId]
    );

    if (!profile) {
      throw new Error('No se encontró el usuario autenticado.');
    }

    const shipping_address = {
      name: profile.name ?? null,
      phone: profile.phone ?? null,
      address: profile.address ?? null,
      city: profile.city ?? null,
      postal_code: profile.postal_code ?? null,
      country: profile.country ?? 'Argentina',
    };

    const billing_info = {
      name: profile.name ?? null,
      email: profile.email ?? null,
      document_number: profile.document_number ?? null,
    };

    const idem = crypto.randomUUID();

    const { rows: [order] } = await client.query(
      `
      INSERT INTO orders (
        user_id,
        status,
        payment_status,
        channel,
        currency,
        subtotal,
        discount,
        shipping_cost,
        tax,
        total,
        shipping_address,
        billing_info,
        idempotency_key,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        'pending_payment',
        'pending',
        $2,
        'ARS',
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        NOW(),
        NOW()
      )
      RETURNING id
      `,
      [
        userId,
        channel,
        subtotal,
        discount,
        shipping,
        tax,
        total,
        JSON.stringify(shipping_address),
        JSON.stringify(billing_info),
        idem,
      ]
    );

    const orderId = order.id;

    const insertItemSQL = `
      INSERT INTO order_items (order_id, product_id, quantity, unit_price)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (order_id, product_id)
      DO UPDATE SET
        quantity = EXCLUDED.quantity,
        unit_price = EXCLUDED.unit_price
    `;

    for (const it of items) {
      await client.query(insertItemSQL, [
        orderId,
        it.product_id,
        it.quantity,
        it.price,
      ]);
    }

    await client.query(`DELETE FROM cart_items WHERE user_id = $1`, [userId]);

    const paymentMethod = channel === 'mercadopago' ? 'mercadopago' : 'manual';

    const paymentMetadata = {
      order_id: orderId,
      user_id: userId,
      channel,
      stock_reserved: false,
      cart_items: items.map((it) => ({
        product_id: it.product_id,
        name: it.name,
        quantity: Number(it.quantity),
        unit_price: Number(it.price),
      })),
    };

    const { rows: [paymentRow] } = await client.query(
      `
      INSERT INTO payments (
        order_id,
        amount,
        method,
        status,
        created_at,
        idempotency_key,
        currency,
        metadata,
        updated_at
      )
      VALUES (
        $1,
        $2,
        $3,
        'pending',
        NOW(),
        $4,
        'ARS',
        $5,
        NOW()
      )
      RETURNING id
      `,
      [
        orderId,
        total,
        paymentMethod,
        idem,
        JSON.stringify(paymentMetadata),
      ]
    );

    if (channel === 'whatsapp') {
      await client.query('COMMIT');

      const tiendaPhone = (process.env.WHATSAPP_NUMBER || '').replace(/\D/g, '');
      const MAX_LINES = 12;
      const shownItems = items.slice(0, MAX_LINES);
      const hidden = Math.max(0, items.length - shownItems.length);

      const lines = [
        `🧾 *Orden #${orderId}*`,
        `Canal: WhatsApp/Transferencia`,
        '',
        '*Cliente*',
        `• Nombre: ${profile?.name ?? ''}`,
        `• Email: ${profile?.email ?? ''}`,
        `• Teléfono: ${profile?.phone ?? ''}`,
        `• DNI: ${profile?.document_number ?? ''}`,
        '',
        '*Envío / Dirección*',
        `• ${shipping_address?.address ?? ''}`,
        `• ${shipping_address?.city ?? ''} (${shipping_address?.postal_code ?? ''}), ${shipping_address?.country ?? ''}`,
        '',
        '*Items*',
        ...shownItems.map(
          (it) =>
            `• ${it.name} ×${it.quantity} — ${formatARS(
              Number(it.price) * Number(it.quantity)
            )}`
        ),
        ...(hidden ? [`… (${hidden} ítem/s más)`] : []),
        '',
        `Subtotal: ${formatARS(subtotal)}`,
        `Envío: ${formatARS(shipping)}`,
        `Descuento: ${formatARS(discount)}`,
        `Impuestos: ${formatARS(tax)}`,
        `*Total: ${formatARS(total)}*`,
        '',
        `Fecha: ${new Date().toLocaleString('es-AR')}`,
      ];

      const msg = encodeURIComponent(lines.join('\n'));
      const wa = `https://wa.me/${tiendaPhone}?text=${msg}`;

      return res.json({
        orderId,
        total,
        pay_url: wa,
        mp_init_point: null,
      });
    }

    if (!process.env.MP_ACCESSTOKEN) {
      throw new Error('Falta configurar MP_ACCESSTOKEN.');
    }

    const preference = new Preference(mpClient);

    const preferenceResult = await preference.create({
      body: {
        items: items.map((it) => ({
          id: String(it.product_id),
          title: it.name,
          quantity: Number(it.quantity),
          unit_price: Number(it.price),
          currency_id: 'ARS',
        })),
        payer: {
          name: profile?.name || undefined,
          email: profile?.email || undefined,
        },
        external_reference: String(orderId),
        notification_url: `${process.env.BACKEND_PUBLIC_URL}/api/v1/checkout/webhook`,
        back_urls: {
          success: `${process.env.FRONTEND_URL}/payment/success`,
          pending: `${process.env.FRONTEND_URL}/payment/pending`,
          failure: `${process.env.FRONTEND_URL}/payment/failure`,
        },
        auto_return: 'approved',
        metadata: {
          order_id: orderId,
          local_payment_id: paymentRow.id,
          user_id: userId,
        },
      },
    });

    await client.query(
      `
      UPDATE payments
      SET
        provider_reference = $1,
        provider_status = $2,
        provider_payload = $3,
        updated_at = NOW()
      WHERE id = $4
      `,
      [
        preferenceResult.id ?? null,
        'preference_created',
        JSON.stringify(preferenceResult),
        paymentRow.id,
      ]
    );

    await client.query('COMMIT');

    return res.json({
      orderId,
      total,
      mp_init_point: preferenceResult.init_point || null,
      pay_url: null,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('CHECKOUT INIT ERROR:', {
      message: e.message,
      stack: e.stack,
      userId,
      channel,
    });
    return res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

/**
 * POST /api/v1/checkout/webhook
 */
router.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  try {
    const isValid = validateMercadoPagoSignature(req);
    if (!isValid) {
      console.warn('Webhook Mercado Pago inválido: firma incorrecta');
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
      console.warn('Webhook Mercado Pago sin payment id');
      return;
    }

    const payment = await getMercadoPagoPaymentById(mpPaymentId);
    const orderId = Number(payment.external_reference);

    if (!orderId) {
      console.warn('Pago MP sin external_reference usable');
      return;
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const { rows: [localPayment] } = await client.query(
        `
        SELECT id, order_id, status, method, provider_id
        FROM payments
        WHERE order_id = $1
        ORDER BY id ASC
        LIMIT 1
        FOR UPDATE
        `,
        [orderId]
      );

      if (!localPayment) {
        throw new Error(`No existe payment local para la orden ${orderId}`);
      }

      const { rows: [orderRow] } = await client.query(
        `
        SELECT id, status, payment_status
        FROM orders
        WHERE id = $1
        FOR UPDATE
        `,
        [orderId]
      );

      if (!orderRow) {
        throw new Error(`No existe la orden ${orderId}`);
      }

      const alreadyApprovedSamePayment =
        localPayment.provider_id &&
        String(localPayment.provider_id) === String(payment.id) &&
        localPayment.status === 'approved' &&
        orderRow.payment_status === 'paid';

      if (alreadyApprovedSamePayment) {
        await client.query('COMMIT');
        return;
      }

      const mpStatus = payment.status ?? null;
      const mpStatusDetail = payment.status_detail ?? null;

      if (mpStatus === 'approved') {
        const { rows: orderItems } = await client.query(
          `
          SELECT oi.product_id, oi.quantity, p.stock, p.name
          FROM order_items oi
          JOIN products p ON p.id = oi.product_id
          WHERE oi.order_id = $1
          FOR UPDATE OF p
          `,
          [orderId]
        );

        for (const it of orderItems) {
          if (Number(it.stock) < Number(it.quantity)) {
            await client.query(
              `
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
              `,
              [
                String(payment.id),
                mpStatus,
                'approved_but_no_stock',
                JSON.stringify(payment),
                JSON.stringify({
                  stock_error: true,
                  stock_error_at: new Date().toISOString(),
                  stock_error_reason: `Sin stock al acreditar pago para ${it.name}`,
                }),
                localPayment.id,
              ]
            );

            await client.query(
              `
              UPDATE orders
              SET
                status = 'manual_review',
                payment_status = 'paid',
                updated_at = NOW()
              WHERE id = $1
              `,
              [orderId]
            );

            await client.query('COMMIT');
            console.error(`Orden ${orderId} aprobada en MP pero sin stock suficiente.`);
            return;
          }
        }

        for (const it of orderItems) {
          await client.query(
            `
            UPDATE products
            SET stock = stock - $1
            WHERE id = $2
            `,
            [it.quantity, it.product_id]
          );
        }

        await client.query(
          `
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
          `,
          [
            String(payment.id),
            mpStatus,
            mpStatusDetail,
            JSON.stringify(payment),
            JSON.stringify({
              stock_discounted: true,
              stock_discounted_at: new Date().toISOString(),
            }),
            localPayment.id,
          ]
        );

        await client.query(
          `
          UPDATE orders
          SET
            status = 'paid',
            payment_status = 'paid',
            updated_at = NOW()
          WHERE id = $1
          `,
          [orderId]
        );

        await client.query('COMMIT');
        return;
      }

      if (['pending', 'in_process', 'in_mediation'].includes(mpStatus)) {
        await client.query(
          `
          UPDATE payments
          SET
            provider_id = $1,
            provider_status = $2,
            provider_status_detail = $3,
            provider_payload = $4,
            status = 'pending',
            updated_at = NOW()
          WHERE id = $5
          `,
          [
            String(payment.id),
            mpStatus,
            mpStatusDetail,
            JSON.stringify(payment),
            localPayment.id,
          ]
        );

        await client.query(
          `
          UPDATE orders
          SET
            status = 'pending_payment',
            payment_status = 'pending',
            updated_at = NOW()
          WHERE id = $1
          `,
          [orderId]
        );

        await client.query('COMMIT');
        return;
      }

      if (['rejected', 'cancelled', 'refunded', 'charged_back'].includes(mpStatus)) {
        await client.query(
          `
          UPDATE payments
          SET
            provider_id = $1,
            provider_status = $2,
            provider_status_detail = $3,
            provider_payload = $4,
            status = 'failed',
            updated_at = NOW()
          WHERE id = $5
          `,
          [
            String(payment.id),
            mpStatus,
            mpStatusDetail,
            JSON.stringify(payment),
            localPayment.id,
          ]
        );

        await client.query(
          `
          UPDATE orders
          SET
            status = 'payment_failed',
            payment_status = 'failed',
            updated_at = NOW()
          WHERE id = $1
          `,
          [orderId]
        );

        await client.query('COMMIT');
        return;
      }

      await client.query(
        `
        UPDATE payments
        SET
          provider_id = $1,
          provider_status = $2,
          provider_status_detail = $3,
          provider_payload = $4,
          updated_at = NOW()
        WHERE id = $5
        `,
        [
          String(payment.id),
          mpStatus,
          mpStatusDetail,
          JSON.stringify(payment),
          localPayment.id,
        ]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('CHECKOUT WEBHOOK ERROR:', error);
  }
});

export default router;
