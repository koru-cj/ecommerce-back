

import { Router } from 'express';
import { pool } from '../db.js';
import { authRequired } from '../middlewares/authMiddleware.js';

const router = Router();

// ==============================
// 🏁 Dashboard admin welcome
// ==============================
router.get('/dashboard', authRequired('admin'), async (req, res) => {
  res.json({ message: `Bienvenido al panel admin, usuario ID: ${req.user.id} `});
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
        SET status = 'approved', provider_id = 'manual-'||EXCLUDED.order_id
    `, [id]);

    // 2) Marcar orden como pagada
    await pool.query(`
      UPDATE orders
      SET status = 'paid', payment_status = 'approved', updated_at = NOW()
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


export default router;
