import { Router } from 'express';
import { pool } from '../db.js';
import { authRequired } from '../middlewares/authMiddleware.js';

const router = Router();

/* GET /api/v1/orders  -> lista mis órdenes (paginado simple) */
router.get('/', authRequired(), async (req, res) => {
  const userId = req.user.id;
  const page  = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '20', 10)));
  const offset = (page - 1) * limit;

  try {
    const { rows } = await pool.query(`
      select o.id,
             o.status,
             o.payment_status,
             o.channel,
             o.currency,
             o.total::numeric as total,
             o.created_at,
             coalesce(sum(oi.quantity), 0) as items_count
      from orders o
      left join order_items oi on oi.order_id = o.id
      where o.user_id = $1
      group by o.id
      order by o.created_at desc
      limit $2 offset $3
    `, [userId, limit, offset]);

    res.json({ page, limit, data: rows });
  } catch (err) {
    console.error('GET /orders error', err);
    res.status(500).json({ error: 'No se pudo listar órdenes' });
  }
});

/* GET /api/v1/orders/:id  -> detalle de mi orden */
router.get('/:id', authRequired(), async (req, res) => {
  const userId = req.user.id;
  const orderId = parseInt(req.params.id, 10);

  try {
    const { rows } = await pool.query(`
      select
        o.id,
        o.status,
        o.payment_status,
        o.channel,
        o.currency,
        o.subtotal::numeric as subtotal,
        o.discount::numeric as discount,
        o.shipping_cost::numeric as shipping_cost,
        o.tax::numeric as tax,
        o.total::numeric as total,
        o.shipping_address,
        o.billing_info,
        o.created_at,
        o.updated_at,
        json_agg(
          json_build_object(
            'product_id', oi.product_id,
            'name', p.name,
            'quantity', oi.quantity,
            'unit_price', oi.unit_price::numeric
          )
          order by oi.id
        ) as items
      from orders o
      join order_items oi on oi.order_id = o.id
      join products p on p.id = oi.product_id
      where o.id = $1 and o.user_id = $2
      group by o.id
    `, [orderId, userId]);

    if (rows.length === 0) return res.status(404).json({ error: 'Orden no encontrada' });
    res.json(rows[0]);
  } catch (err) {
    console.error('GET /orders/:id error', err);
    res.status(500).json({ error: 'No se pudo obtener el detalle' });
  }
});

export default router;
