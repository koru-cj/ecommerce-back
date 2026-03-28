import { Router } from 'express';
import { pool } from '../db.js';
import { authRequired } from '../middlewares/authMiddleware.js';

const router = Router();

function parsePagination(query) {
  const page = Math.max(1, parseInt(query.page || '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt(query.limit || '20', 10)));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

function isAdmin(user) {
  if (!user) return false;
  return ['admin', 'superadmin'].includes(String(user.role || '').toLowerCase());
}

/* GET /api/v1/orders -> historial completo de mis órdenes */
router.get('/', authRequired(), async (req, res) => {
  const userId = req.user.id;
  const { page, limit, offset } = parsePagination(req.query);

  try {
    const { rows } = await pool.query(
      `
      SELECT
        o.id,
        o.status,
        o.payment_status,
        o.channel,
        o.currency,
        o.subtotal::numeric AS subtotal,
        o.discount::numeric AS discount,
        o.shipping_cost::numeric AS shipping_cost,
        o.tax::numeric AS tax,
        o.total::numeric AS total,
        o.created_at,
        o.updated_at,
        COALESCE(SUM(oi.quantity), 0) AS items_count,
        p.id AS payment_id,
        p.method AS payment_method,
        p.status AS payment_local_status,
        p.provider_id,
        p.provider_reference,
        p.provider_status,
        p.provider_status_detail,
        p.amount::numeric AS payment_amount
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN payments p ON p.order_id = o.id
      WHERE o.user_id = $1
      GROUP BY o.id, p.id
      ORDER BY o.created_at DESC
      LIMIT $2 OFFSET $3
      `,
      [userId, limit, offset]
    );

    res.json({ page, limit, data: rows });
  } catch (err) {
    console.error('GET /orders error', err);
    res.status(500).json({ error: 'No se pudo listar órdenes' });
  }
});

/* GET /api/v1/orders/tracking -> solo órdenes activas/no cerradas */
router.get('/tracking', authRequired(), async (req, res) => {
  const userId = req.user.id;
  const { page, limit, offset } = parsePagination(req.query);

  try {
    const { rows } = await pool.query(
      `
      SELECT
        o.id,
        o.status,
        o.payment_status,
        o.channel,
        o.currency,
        o.subtotal::numeric AS subtotal,
        o.discount::numeric AS discount,
        o.shipping_cost::numeric AS shipping_cost,
        o.tax::numeric AS tax,
        o.total::numeric AS total,
        o.created_at,
        o.updated_at,
        COALESCE(SUM(oi.quantity), 0) AS items_count,
        p.id AS payment_id,
        p.method AS payment_method,
        p.status AS payment_local_status,
        p.provider_id,
        p.provider_reference,
        p.provider_status,
        p.provider_status_detail,
        p.amount::numeric AS payment_amount
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN payments p ON p.order_id = o.id
      WHERE o.user_id = $1
        AND o.status NOT IN ('delivered', 'cancelled')
      GROUP BY o.id, p.id
      ORDER BY o.created_at DESC
      LIMIT $2 OFFSET $3
      `,
      [userId, limit, offset]
    );

    res.json({ page, limit, data: rows });
  } catch (err) {
    console.error('GET /orders/tracking error', err);
    res.status(500).json({ error: 'No se pudo listar el seguimiento' });
  }
});

/* GET /api/v1/orders/admin/all -> admin ve todas las órdenes */
router.get('/admin/all', authRequired(), async (req, res) => {
  if (!isAdmin(req.user)) {
    return res.status(403).json({ error: 'No autorizado' });
  }

  const { page, limit, offset } = parsePagination(req.query);

  try {
    const { rows } = await pool.query(
      `
      SELECT
        o.id,
        o.user_id,
        o.status,
        o.payment_status,
        o.channel,
        o.currency,
        o.subtotal::numeric AS subtotal,
        o.discount::numeric AS discount,
        o.shipping_cost::numeric AS shipping_cost,
        o.tax::numeric AS tax,
        o.total::numeric AS total,
        o.created_at,
        o.updated_at,
        u.name AS user_name,
        u.email AS user_email,
        u.phone AS user_phone,
        p.id AS payment_id,
        p.method AS payment_method,
        p.status AS payment_local_status,
        p.provider_id,
        p.provider_reference,
        p.provider_status,
        p.provider_status_detail,
        p.amount::numeric AS payment_amount,
        COALESCE(SUM(oi.quantity), 0) AS items_count
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN payments p ON p.order_id = o.id
      GROUP BY o.id, u.id, p.id
      ORDER BY o.created_at DESC
      LIMIT $1 OFFSET $2
      `,
      [limit, offset]
    );

    res.json({ page, limit, data: rows });
  } catch (err) {
    console.error('GET /orders/admin/all error', err);
    res.status(500).json({ error: 'No se pudo listar órdenes del admin' });
  }
});

/* GET /api/v1/orders/admin/:id -> admin ve detalle completo */
router.get('/admin/:id', authRequired(), async (req, res) => {
  if (!isAdmin(req.user)) {
    return res.status(403).json({ error: 'No autorizado' });
  }

  const orderId = parseInt(req.params.id, 10);
  if (Number.isNaN(orderId)) {
    return res.status(400).json({ error: 'ID de orden inválido' });
  }

  try {
    const { rows } = await pool.query(
      `
      SELECT
        o.id,
        o.user_id,
        o.status,
        o.payment_status,
        o.channel,
        o.currency,
        o.subtotal::numeric AS subtotal,
        o.discount::numeric AS discount,
        o.shipping_cost::numeric AS shipping_cost,
        o.tax::numeric AS tax,
        o.total::numeric AS total,
        o.shipping_address,
        o.billing_info,
        o.notes,
        o.created_at,
        o.updated_at,
        json_build_object(
          'id', u.id,
          'name', u.name,
          'email', u.email,
          'phone', u.phone
        ) AS user_info,
        json_build_object(
          'id', p.id,
          'amount', p.amount::numeric,
          'currency', p.currency,
          'method', p.method,
          'status', p.status,
          'provider_id', p.provider_id,
          'provider_reference', p.provider_reference,
          'provider_status', p.provider_status,
          'provider_status_detail', p.provider_status_detail,
          'created_at', p.created_at,
          'updated_at', p.updated_at
        ) AS payment,
        COALESCE(
          json_agg(
            json_build_object(
              'product_id', oi.product_id,
              'name', pr.name,
              'quantity', oi.quantity,
              'unit_price', oi.unit_price::numeric
            )
            ORDER BY oi.id
          ) FILTER (WHERE oi.product_id IS NOT NULL),
          '[]'::json
        ) AS items
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN payments p ON p.order_id = o.id
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products pr ON pr.id = oi.product_id
      WHERE o.id = $1
      GROUP BY o.id, u.id, p.id
      `,
      [orderId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('GET /orders/admin/:id error', err);
    res.status(500).json({ error: 'No se pudo obtener el detalle admin' });
  }
});

/* GET /api/v1/orders/:id -> detalle de mi orden */
router.get('/:id', authRequired(), async (req, res) => {
  const userId = req.user.id;
  const orderId = parseInt(req.params.id, 10);

  if (Number.isNaN(orderId)) {
    return res.status(400).json({ error: 'ID de orden inválido' });
  }

  try {
    const { rows } = await pool.query(
      `
      SELECT
        o.id,
        o.status,
        o.payment_status,
        o.channel,
        o.currency,
        o.subtotal::numeric AS subtotal,
        o.discount::numeric AS discount,
        o.shipping_cost::numeric AS shipping_cost,
        o.tax::numeric AS tax,
        o.total::numeric AS total,
        o.shipping_address,
        o.billing_info,
        o.notes,
        o.created_at,
        o.updated_at,
        json_build_object(
          'id', p.id,
          'amount', p.amount::numeric,
          'currency', p.currency,
          'method', p.method,
          'status', p.status,
          'provider_id', p.provider_id,
          'provider_reference', p.provider_reference,
          'provider_status', p.provider_status,
          'provider_status_detail', p.provider_status_detail,
          'created_at', p.created_at,
          'updated_at', p.updated_at
        ) AS payment,
        COALESCE(
          json_agg(
            json_build_object(
              'product_id', oi.product_id,
              'name', pr.name,
              'quantity', oi.quantity,
              'unit_price', oi.unit_price::numeric
            )
            ORDER BY oi.id
          ) FILTER (WHERE oi.product_id IS NOT NULL),
          '[]'::json
        ) AS items
      FROM orders o
      LEFT JOIN payments p ON p.order_id = o.id
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products pr ON pr.id = oi.product_id
      WHERE o.id = $1
        AND o.user_id = $2
      GROUP BY o.id, p.id
      `,
      [orderId, userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('GET /orders/:id error', err);
    res.status(500).json({ error: 'No se pudo obtener el detalle' });
  }
});

export default router;