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
    console.warn('[MP webhook] MP_WEBHOOK_SECRET no configurado. Se omite validación de firma.');
    return true;
  }

  const xSignature = req.headers['x-signature'];
  const xRequestId = req.headers['x-request-id'];

  if (!xSignature || !xRequestId) {
    console.warn('[MP webhook] faltan x-signature o x-request-id');
    return false;
  }

  const { ts, v1 } = parseXSignature(String(xSignature));
  if (!ts || !v1) {
    console.warn('[MP webhook] firma inválida: faltan ts o v1');
    return false;
  }

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

  const valid = hash === v1;

  if (!valid) {
    console.warn('[MP webhook] firma inválida', {
      dataId,
      xRequestId,
      ts,
      expected: hash,
      received: v1,
    });
  }

  return valid;
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
      (sum, it) => sum + Number(it.price) * Number(it.quantity),
      0
    );
    const shipping = 0;
    const discount = 0;
    const tax = 0;
    const total = subtotal - discount + shipping + tax;

    const {
      rows: [profile],
    } = await client.query(
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

    const {
      rows: [order],
    } = await client.query(
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

    const {
      rows: [paymentRow],
    } = await client.query(
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
    if (!process.env.FRONTEND_URL) {
      throw new Error('Falta configurar FRONTEND_URL.');
    }
    if (!process.env.BACKEND_PUBLIC_URL) {
      throw new Error('Falta configurar BACKEND_PUBLIC_URL.');
    }

    const preference = new Preference(mpClient);

    const successUrl = `${process.env.FRONTEND_URL}/payment/success`;
    const pendingUrl = `${process.env.FRONTEND_URL}/payment/pending`;
    const failureUrl = `${process.env.FRONTEND_URL}/payment/failure`;
    const notificationUrl = `${process.env.BACKEND_PUBLIC_URL}/api/v1/checkout/webhook`;

    console.log('[checkout init] MP preference URLs', {
      successUrl,
      pendingUrl,
      failureUrl,
      notificationUrl,
      orderId,
    });

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
        notification_url: notificationUrl,
        back_urls: {
          success: successUrl,
          pending: pendingUrl,
          failure: failureUrl,
        },
        auto_return: 'approved',
        metadata: {
          order_id: orderId,
          local_payment_id: paymentRow.id,
          user_id: userId,
        },
      },
    });

    console.log('[checkout init] MP preferenceResult', {
      id: preferenceResult?.id,
      init_point: preferenceResult?.init_point,
      sandbox_init_point: preferenceResult?.sandbox_init_point,
    });

    if (!preferenceResult?.init_point) {
      throw new Error('Mercado Pago no devolvió init_point.');
    }

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
      mp_init_point: preferenceResult.init_point,
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
 * Se mantiene acá para no romper el flujo actual.
 */
router.post('/webhook', async (req, res) => {
  try {
    console.log('[MP webhook] headers:', {
      xSignature: req.headers['x-signature'],
      xRequestId: req.headers['x-request-id'],
    });
    console.log('[MP webhook] query:', req.query);
    console.log('[MP webhook] body:', req.body);

    const isValid = validateMercadoPagoSignature(req);
    if (!isValid) {
      console.warn('[MP webhook] firma incorrecta');
      return res.status(400).json({ error: 'Firma inválida' });
    }

    const topic =
      req.query.type ||
      req.body?.type ||
      req.query.topic ||
      req.body?.topic;

    console.log('[MP webhook] topic:', topic);

    if (topic !== 'payment') {
      console.log('[MP webhook] tópico ignorado');
      return res.sendStatus(200);
    }

    const mpPaymentId =
      req.query['data.id'] ||
      req.body?.data?.id ||
      req.query.id ||
      req.body?.id;

    console.log('[MP webhook] mpPaymentId:', mpPaymentId);

    if (!mpPaymentId) {
      console.warn('[MP webhook] sin payment id');
      return res.status(400).json({ error: 'Payment id ausente' });
    }

    const payment = await getMercadoPagoPaymentById(mpPaymentId);

    console.log('[MP webhook] payment lookup ok:', {
      id: payment?.id,
      status: payment?.status,
      status_detail: payment?.status_detail,
      external_reference: payment?.external_reference,
    });

    const orderId = Number(payment.external_reference);

    if (!Number.isInteger(orderId) || orderId <= 0) {
      console.warn('[MP webhook] external_reference inválido:', payment.external_reference);
      return res.status(400).json({ error: 'external_reference inválido' });
    }

    const mpStatus = payment.status ?? null;
    const mpStatusDetail = payment.status_detail ?? null;

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const {
        rows: [localPayment],
      } = await client.query(
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

      console.log('[MP webhook] localPayment:', localPayment);

      if (!localPayment) {
        throw new Error(`No existe payment local para la orden ${orderId}`);
      }

      const {
        rows: [orderRow],
      } = await client.query(
        `
        SELECT id, user_id, status, payment_status
        FROM orders
        WHERE id = $1
        FOR UPDATE
        `,
        [orderId]
      );

      console.log('[MP webhook] orderRow:', orderRow);

      if (!orderRow) {
        throw new Error(`No existe la orden ${orderId}`);
      }

      const alreadyApprovedSamePayment =
        localPayment.provider_id &&
        String(localPayment.provider_id) === String(payment.id) &&
        localPayment.status === 'approved' &&
        orderRow.payment_status === 'paid' &&
        ['preparing', 'manual_review', 'shipped', 'delivered'].includes(orderRow.status);

      if (alreadyApprovedSamePayment) {
        console.log('[MP webhook] pago ya procesado, idempotencia OK');
        await client.query('COMMIT');
        return res.sendStatus(200);
      }

      if (mpStatus === 'approved') {
        console.log('[MP webhook] procesando APPROVED para order:', orderId);

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

        console.log('[MP webhook] orderItems:', orderItems);

        for (const it of orderItems) {
          if (Number(it.stock) < Number(it.quantity)) {
            console.error('[MP webhook] approved pero sin stock', {
              orderId,
              productId: it.product_id,
              productName: it.name,
              stock: it.stock,
              quantity: it.quantity,
            });

            await client.query(
              `
              UPDATE payments
              SET
                provider_id = $1,
                provider_status = $2,
                provider_status_detail = $3,
                provider_payload = $4,
                status = 'approved',
                method = COALESCE(method, 'mercadopago'),
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
            return res.sendStatus(200);
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
          DELETE FROM cart_items
          WHERE user_id = $1
          `,
          [orderRow.user_id]
        );

        await client.query(
          `
          UPDATE payments
          SET
            provider_id = $1,
            provider_status = $2,
            provider_status_detail = $3,
            provider_payload = $4,
            status = 'approved',
            method = COALESCE(method, 'mercadopago'),
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
              cart_cleared: true,
              cart_cleared_at: new Date().toISOString(),
            }),
            localPayment.id,
          ]
        );

        await client.query(
          `
          UPDATE orders
          SET
            status = 'preparing',
            payment_status = 'paid',
            updated_at = NOW()
          WHERE id = $1
          `,
          [orderId]
        );

        await client.query('COMMIT');
        console.log('[MP webhook] APPROVED commit OK para order:', orderId);
        return res.sendStatus(200);
      }

      if (['pending', 'in_process', 'in_mediation'].includes(mpStatus)) {
        console.log('[MP webhook] procesando estado pendiente:', mpStatus);

        await client.query(
          `
          UPDATE payments
          SET
            provider_id = $1,
            provider_status = $2,
            provider_status_detail = $3,
            provider_payload = $4,
            status = 'pending',
            method = COALESCE(method, 'mercadopago'),
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
        return res.sendStatus(200);
      }

      if (['rejected', 'cancelled'].includes(mpStatus)) {
        console.log('[MP webhook] procesando FAILED:', mpStatus);

        await client.query(
          `
          UPDATE payments
          SET
            provider_id = $1,
            provider_status = $2,
            provider_status_detail = $3,
            provider_payload = $4,
            status = 'failed',
            method = COALESCE(method, 'mercadopago'),
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
        return res.sendStatus(200);
      }

      if (mpStatus === 'refunded') {
        console.log('[MP webhook] procesando REFUNDED');

        await client.query(
          `
          UPDATE payments
          SET
            provider_id = $1,
            provider_status = $2,
            provider_status_detail = $3,
            provider_payload = $4,
            status = 'refunded',
            method = COALESCE(method, 'mercadopago'),
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
            status = 'cancelled',
            payment_status = 'refunded',
            updated_at = NOW()
          WHERE id = $1
          `,
          [orderId]
        );

        await client.query('COMMIT');
        return res.sendStatus(200);
      }

      if (mpStatus === 'charged_back') {
        console.log('[MP webhook] procesando CHARGEDBACK');

        await client.query(
          `
          UPDATE payments
          SET
            provider_id = $1,
            provider_status = $2,
            provider_status_detail = $3,
            provider_payload = $4,
            status = 'chargeback',
            method = COALESCE(method, 'mercadopago'),
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
            status = 'manual_review',
            payment_status = 'chargeback',
            updated_at = NOW()
          WHERE id = $1
          `,
          [orderId]
        );

        await client.query('COMMIT');
        return res.sendStatus(200);
      }

      console.log('[MP webhook] estado no contemplado, guardando payload:', mpStatus);

      await client.query(
        `
        UPDATE payments
        SET
          provider_id = $1,
          provider_status = $2,
          provider_status_detail = $3,
          provider_payload = $4,
          method = COALESCE(method, 'mercadopago'),
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
      return res.sendStatus(200);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[MP webhook] rollback por error:', err);
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('CHECKOUT WEBHOOK ERROR:', error);
    return res.sendStatus(500);
  }
});

export default router;