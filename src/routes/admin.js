

import { Router } from 'express';
import { pool } from '../db.js';
import { authRequired } from '../middlewares/authMiddleware.js';

function buildOrderApprovedEmailData(orderRow) {
  return {
    orderId: orderRow.id,
    customerName: orderRow.user_name,
    customerEmail: orderRow.user_email,
    total: orderRow.total,
    channel: orderRow.channel,
    shippingAddress: orderRow.shipping_address,
    billingInfo: orderRow.billing_info,
    items: orderRow.items || [],
  };
}

/**
 * Placeholder para etapa 1.
 * Acá después enchufamos Resend / Nodemailer / lo que decidas.
 */
async function sendOrderApprovedNotifications(orderRow) {
  const emailData = buildOrderApprovedEmailData(orderRow);

  console.log('[ADMIN NOTIFY] Pedido aprobado, enviar emails:', {
    toCustomer: emailData.customerEmail,
    internalTo: process.env.BUSINESS_EMAIL || process.env.SMTP_FROM || null,
    orderId: emailData.orderId,
    total: emailData.total,
    channel: emailData.channel,
  });

  // TODO etapa 1:
  // 1) enviar email al cliente
  // 2) enviar email interno al negocio
}

const router = Router();

// ==============================
// 🏁 Dashboard admin welcome
// ==============================
router.get('/', authRequired('admin'), async (req, res) => {
  res.json({ message: `Bienvenido al panel admin, usuario ID: ${req.user.id}` });
});


// ==============================
// 👤 Usuarios
// ==============================

// Obtener todos los usuarios
router.get('/users', authRequired('admin'), async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, email, role FROM users ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener usuarios:', err);
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
});

// Actualizar rol de usuario
router.put('/users/:id/role', authRequired('admin'), async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;

  if (!['admin', 'customer'].includes(role)) {
    return res.status(400).json({ error: 'Rol inválido' });
  }

  try {
    const result = await pool.query(
      'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, name, email, role',
      [role, id]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Usuario no encontrado' });

    res.json({ message: 'Rol actualizado', user: result.rows[0] });
  } catch (err) {
    console.error('Error al actualizar rol:', err);
    res.status(500).json({ error: 'Error al actualizar rol del usuario' });
  }
});



// ==============================
// 📦 Productos (Admin)
// ==============================

// Obtener todos los productos (admin)
router.get('/products', authRequired('admin'), async (_, res) => {
  try {
    const result = await pool.query(`
      SELECT
        p.*,
        c.name AS category
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      ORDER BY p.name;
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener productos:', err);
    res.status(500).json({ error: 'Error al obtener productos' });
  }
});

// Crear producto (con lógica inteligente)
router.post('/products', authRequired('admin'), async (req, res) => {
  try {
    let {

      name,
      description,
      price,
      original_price,
      stock,
      category_id,
      image_url,
      brand,
      tags,
      unit,
      visible = true,
      discount_expiration,
      weight_grams,
      dimensions,
      organic,
      senasa,
      rendimiento
    } = req.body;

    if (!name || !original_price || isNaN(original_price)) {
      return res.status(400).json({ error: 'Nombre y precio original son obligatorios' });
    }

    original_price = parseFloat(original_price);
    price = parseFloat(price);

    // Descuento automático
    let discount_percentage = 0;
    if (price && original_price && price < original_price) {
      discount_percentage = Math.round(100 * (1 - price / original_price));
    } else {
      price = original_price;
    }

    // Si descuento expiró → reiniciar
    if (discount_expiration && new Date(discount_expiration) < new Date()) {
      discount_percentage = 0;
      price = original_price;
    }

    // Stock visible automático
    if (stock === 0) {
      visible = false;
    }
    console.log('Recibido en backend para crear producto:', req.body);

    const result = await pool.query(`
      INSERT INTO products (
        name, description, price, original_price, discount_percentage,
        stock, category_id, image_url, brand, tags, unit, visible,
        discount_expiration, created_at, updated_at,
        weight_grams, dimensions, organic, senasa, rendimiento
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10, $11, $12,
        $13, NOW(), NOW(),
        $14, $15, $16, $17, $18
      ) RETURNING *;
    `, [
      name.trim(), description?.trim(), price, original_price, discount_percentage,
      stock, category_id, image_url, brand?.trim(), tags, unit, visible,
      discount_expiration,
      weight_grams, dimensions, organic, senasa, rendimiento
    ]);

    res.status(201).json({ message: 'Producto creado', product: result.rows[0] });
  } catch (err) {
    console.error('Error al crear producto:', err);
    res.status(500).json({ error: 'Error al crear producto' });
  }
});
router.put('/products/:id', authRequired('admin'), async (req, res) => {
  const { id } = req.params;
  let {
    name,
    description,
    price,
    original_price,
    stock,
    category_id,
    image_url,
    brand,
    tags,
    unit,
    visible,
    discount_expiration,
    weight_grams,
    dimensions,
    organic,
    senasa,
    rendimiento
  } = req.body;

  try {
    // Obtener producto actual
    const { rows } = await pool.query('SELECT * FROM products WHERE id = $1', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    const current = rows[0];

    const fields = [];
    const values = [];
    let paramIndex = 1;

    const pushIfChanged = (key, newValue) => {
      const oldValue = current[key];
      const changed =
        typeof newValue === 'number'
          ? parseFloat(newValue) !== parseFloat(oldValue)
          : newValue !== oldValue;

      if (changed) {
        fields.push(`${key} = $${paramIndex++}`);
        values.push(newValue);
      }
    };

    // Comparar y agregar solo si cambió
    if (price !== undefined) {
      price = parseFloat(price);
      pushIfChanged('price', price);
    }
    if (original_price !== undefined) {
      original_price = parseFloat(original_price);
      pushIfChanged('original_price', original_price);
    }
    if (stock !== undefined) pushIfChanged('stock', stock);
    if (category_id !== undefined) pushIfChanged('category_id', category_id);
    if (image_url !== undefined) pushIfChanged('image_url', image_url);
    if (tags !== undefined) pushIfChanged('tags', tags);
    if (unit !== undefined) pushIfChanged('unit', unit);
    if (visible !== undefined) pushIfChanged('visible', visible);
    if (weight_grams !== undefined) pushIfChanged('weight_grams', weight_grams);
    if (dimensions !== undefined) pushIfChanged('dimensions', dimensions);
    if (organic !== undefined) pushIfChanged('organic', organic);
    if (senasa !== undefined) pushIfChanged('senasa', senasa);
    if (rendimiento !== undefined) pushIfChanged('rendimiento', rendimiento);
    if (name !== undefined) pushIfChanged('name', name.trim());
    if (description !== undefined) pushIfChanged('description', description.trim());
    if (brand !== undefined) pushIfChanged('brand', brand.trim());

    // Descuento inteligente
    let discount = current.discount_percentage;

    if (price !== undefined && original_price !== undefined) {
      // Fecha expirada → reset
      if (discount_expiration && new Date(discount_expiration) < new Date()) {
        discount = 0;
        discount_expiration = null;
        pushIfChanged('discount_expiration', null);
      }
      // Si hay descuento real
      else if (price < original_price) {
        discount = Math.round(100 * (1 - price / original_price));
      }
      // Si no hay descuento real y no se pasó fecha → limpiar
      else {
        discount = 0;
        if (discount_expiration !== null) {
          pushIfChanged('discount_expiration', null);
        }
      }

      // Solo agregar descuento si cambió
      if (discount !== current.discount_percentage) {
        pushIfChanged('discount_percentage', discount);
      }
    }

    if (fields.length === 0) {
      return res.status(200).json({ message: 'Producto sin cambios', product: current });
    }

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const result = await pool.query(
      `UPDATE products SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    res.json({ message: 'Producto actualizado', product: result.rows[0] });

  } catch (err) {
    console.error('Error al editar producto:', err.message, err.stack);
    res.status(500).json({ error: 'Error al editar producto' });
  }
});



// ==============================
// 📦 THEMES (Admin)
// ==============================

// Obtener todos los productos (admin)
router.get('/themes', authRequired('admin'), async (_, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM themes;
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener temas:', err);
    res.status(500).json({ error: 'Error al obtener temas' });
  }
});

router.post('/themes/:id/activate', authRequired('admin'), async (req, res) => {
  const { id } = req.params;

  try {
    await pool.query('BEGIN');

    // Desactiva todos los temas
    await pool.query('UPDATE themes SET activo = FALSE');

    // Activa el tema seleccionado
    await pool.query('UPDATE themes SET activo = TRUE WHERE id = $1', [id]);

    await pool.query('COMMIT');
    res.json({ success: true, message: `Tema ${id} activado.` });

  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Error al activar tema:', err);
    res.status(500).json({ error: 'Error al activar el tema' });
  }
});
// POST /api/v1/dashboard/orders/:id/confirm-payment
router.post('/orders/:id/confirm-payment', authRequired('admin'), async (req, res) => {
  const { id } = req.params;

  try {
    await pool.query('BEGIN');

    // 1) Actualizar pago → approved (si no existe, lo creamos)
    await pool.query(`
      INSERT INTO payments (order_id, amount, method, status, currency, provider_id, created_at)
      SELECT o.id, o.total, 'manual', 'approved', o.currency, 'manual-'||o.id, NOW()
      FROM orders o
      WHERE o.id = $1
      ON CONFLICT (order_id) DO UPDATE
        SET status = 'approved', provider_id = 'manual-'||EXCLUDED.order_id,updated_at = NOW()
    `, [id]);

    // 2) Marcar orden como pagada
    await pool.query(`
      UPDATE orders
        SET status = 'paid', payment_status = 'paid', updated_at = NOW()
      WHERE id = $1
    `, [id]);

    await pool.query('COMMIT');
    res.json({ ok: true, message: `Orden #${id} marcada como pagada` });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('❌ Error confirmando pago:', err);
    res.status(400).json({ error: 'No se pudo confirmar el pago' });
  }
});
router.get('/orders', authRequired('admin'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        o.id,
        o.user_id,
        u.name AS user_name,
        u.email AS user_email,
        o.status,
        o.payment_status,
        o.channel,
        o.currency,
        o.subtotal,
        o.discount,
        o.shipping_cost,
        o.tax,
        o.total,
        o.created_at,
        o.updated_at,
        p.id AS payment_id,
        p.method AS payment_method,
        p.status AS payment_record_status,
        p.provider_id,
        p.provider_reference,
        p.provider_status,
        p.provider_status_detail,
        p.amount AS payment_amount
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN payments p ON p.order_id = o.id
      ORDER BY o.created_at DESC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener órdenes admin:', err);
    res.status(500).json({ error: 'Error al obtener órdenes' });
  }
});
router.get('/orders/:id', authRequired('admin'), async (req, res) => {
  const { id } = req.params;

  try {
    const { rows: [order] } = await pool.query(`
      SELECT
        o.*,
        u.name AS user_name,
        u.email AS user_email,
        p.id AS payment_id,
        p.method AS payment_method,
        p.status AS payment_record_status,
        p.provider_id,
        p.provider_reference,
        p.provider_status,
        p.provider_status_detail,
        p.provider_payload
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN payments p ON p.order_id = o.id
      WHERE o.id = $1
    `, [id]);

    if (!order) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }

    const itemsResult = await pool.query(`
      SELECT
        oi.*,
        pr.name AS product_name,
        pr.image_url
      FROM order_items oi
      LEFT JOIN products pr ON pr.id = oi.product_id
      WHERE oi.order_id = $1
      ORDER BY oi.product_id
    `, [id]);

    res.json({
      ...order,
      items: itemsResult.rows,
    });
  } catch (err) {
    console.error('Error al obtener detalle admin de orden:', err);
    res.status(500).json({ error: 'Error al obtener detalle de orden' });
  }
});

// ==============================
// 🧾 Pedidos (Admin)
// ==============================

router.get('/orders', authRequired('admin'), async (req, res) => {
  try {
    const result = await pool.query(`
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
        p.amount::numeric AS payment_amount
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN payments p ON p.order_id = o.id
      ORDER BY o.created_at DESC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener pedidos admin:', err);
    res.status(500).json({ error: 'Error al obtener pedidos' });
  }
});

router.get('/orders/:id', authRequired('admin'), async (req, res) => {
  const orderId = parseInt(req.params.id, 10);

  if (Number.isNaN(orderId)) {
    return res.status(400).json({ error: 'ID de pedido inválido' });
  }

  try {
    const result = await pool.query(`
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
        u.name AS user_name,
        u.email AS user_email,
        u.phone AS user_phone,
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
    `, [orderId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error al obtener detalle admin del pedido:', err);
    res.status(500).json({ error: 'Error al obtener detalle del pedido' });
  }
});

router.get('/orders/:id', authRequired('admin'), async (req, res) => {
  const orderId = parseInt(req.params.id, 10);

  if (Number.isNaN(orderId)) {
    return res.status(400).json({ error: 'ID de pedido inválido' });
  }

  try {
    const result = await pool.query(`
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
        u.name AS user_name,
        u.email AS user_email,
        u.phone AS user_phone,
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
    `, [orderId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error al obtener detalle admin del pedido:', err);
    res.status(500).json({ error: 'Error al obtener detalle del pedido' });
  }
});
router.post('/orders/:id/approve-payment', authRequired('admin'), async (req, res) => {
  const orderId = parseInt(req.params.id, 10);

  if (Number.isNaN(orderId)) {
    return res.status(400).json({ error: 'ID de pedido inválido' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const {
      rows: [orderRow],
    } = await client.query(`
      SELECT
        o.id,
        o.user_id,
        o.status,
        o.payment_status,
        o.channel,
        o.total,
        o.shipping_address,
        o.billing_info,
        u.name AS user_name,
        u.email AS user_email,
        u.phone AS user_phone
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      WHERE o.id = $1
      FOR UPDATE OF o
    `, [orderId]);

    if (!orderRow) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }

    if (orderRow.channel !== 'whatsapp') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Solo se puede aprobar manualmente un pedido del canal WhatsApp',
      });
    }

    if (orderRow.payment_status !== 'pending' || orderRow.status !== 'pending_payment') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'El pedido no está en un estado válido para aprobar pago manualmente',
      });
    }

    const {
      rows: [paymentRow],
    } = await client.query(`
      SELECT id, status, method, metadata
      FROM payments
      WHERE order_id = $1
      ORDER BY id ASC
      LIMIT 1
      FOR UPDATE
    `, [orderId]);

    if (!paymentRow) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No se encontró el pago local del pedido' });
    }

    await client.query(`
      UPDATE payments
      SET
        status = 'approved',
        method = COALESCE(method, 'manual'),
        provider_status = 'manual_approved',
        provider_status_detail = 'approved_by_admin',
        metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb,
        updated_at = NOW()
      WHERE id = $2
    `, [
      JSON.stringify({
        approved_by_admin: true,
        approved_by_admin_id: req.user.id,
        approved_by_admin_at: new Date().toISOString(),
      }),
      paymentRow.id,
    ]);

    await client.query(`
      UPDATE orders
      SET
        payment_status = 'approved',
        status = 'preparing',
        updated_at = NOW()
      WHERE id = $1
    `, [orderId]);

    const itemsResult = await client.query(`
      SELECT
        oi.product_id,
        pr.name,
        oi.quantity,
        oi.unit_price::numeric AS unit_price
      FROM order_items oi
      JOIN products pr ON pr.id = oi.product_id
      WHERE oi.order_id = $1
      ORDER BY oi.id
    `, [orderId]);

    await client.query('COMMIT');

    const fullOrderRow = {
      ...orderRow,
      status: 'preparing',
      payment_status: 'approved',
      items: itemsResult.rows,
    };

    try {
      await sendOrderApprovedNotifications(fullOrderRow);
    } catch (notifyErr) {
      console.error('Error enviando notificaciones de pedido aprobado:', notifyErr);
    }

    return res.json({
      message: 'Pago aprobado manualmente. El pedido pasó a preparación.',
      order: fullOrderRow,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al aprobar pago manual:', err);
    return res.status(500).json({ error: 'Error al aprobar pago manualmente' });
  } finally {
    client.release();
  }
});

router.post('/orders/:id/mark-shipped', authRequired('admin'), async (req, res) => {
  const orderId = parseInt(req.params.id, 10);

  if (Number.isNaN(orderId)) {
    return res.status(400).json({ error: 'ID de pedido inválido' });
  }

  try {
    const result = await pool.query(`
      UPDATE orders
      SET
        status = 'shipped',
        updated_at = NOW()
      WHERE id = $1
        AND payment_status = 'approved'
        AND status = 'preparing'
      RETURNING *
    `, [orderId]);

    if (result.rows.length === 0) {
      return res.status(400).json({
        error: 'El pedido no está en un estado válido para marcar como enviado',
      });
    }

    return res.json({
      message: 'Pedido marcado como enviado',
      order: result.rows[0],
    });
  } catch (err) {
    console.error('Error al marcar pedido como enviado:', err);
    return res.status(500).json({ error: 'Error al marcar pedido como enviado' });
  }
});
router.post('/orders/:id/mark-delivered', authRequired('admin'), async (req, res) => {
  const orderId = parseInt(req.params.id, 10);

  if (Number.isNaN(orderId)) {
    return res.status(400).json({ error: 'ID de pedido inválido' });
  }

  try {
    const result = await pool.query(`
      UPDATE orders
      SET
        status = 'delivered',
        updated_at = NOW()
      WHERE id = $1
        AND payment_status = 'approved'
        AND status = 'shipped'
      RETURNING *
    `, [orderId]);

    if (result.rows.length === 0) {
      return res.status(400).json({
        error: 'El pedido no está en un estado válido para marcar como entregado',
      });
    }

    return res.json({
      message: 'Pedido marcado como entregado',
      order: result.rows[0],
    });
  } catch (err) {
    console.error('Error al marcar pedido como entregado:', err);
    return res.status(500).json({ error: 'Error al marcar pedido como entregado' });
  }
});

export default router;
