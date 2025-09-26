import { Router } from 'express';
import { pool } from '../db.js';
import { authRequired } from '../middlewares/authMiddleware.js';
const router = Router();
router.get('/', authRequired() ,async (req, res) => {
      try {
    const userId = req.user.id;

    const { rows } = await pool.query(`
      SELECT c.id, c.quantity, c.created_at, p.*,
             (p.price * c.quantity) as subtotal
      FROM cart_items c
      JOIN products p ON p.id = c.product_id
      WHERE c.user_id = $1
      ORDER BY c.created_at DESC
    `, [userId]);

    res.json(rows);
  } catch (err) {
    console.error('Error al obtener carrito:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});
router.post('/', authRequired(), async (req, res) => {
  try {
    const userId = req.user.id;
    const { product_id, quantity } = req.body;


    if (!product_id) {
      return res.status(400).json({ error: 'Falta product_id' });
    }
    if (typeof quantity !== 'number' || quantity <= 0) {
    return res.status(400).json({ error: 'Cantidad inválida' });
    }


    const cantidad = typeof quantity === 'number' && quantity > 0 ? quantity : 1;
    await pool.query(`
      INSERT INTO cart_items (user_id, product_id, quantity, created_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (user_id, product_id)
      DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity
    `, [userId, product_id, cantidad]);

    res.json({ message: 'Producto agregado a la carrito' });
  } catch (err) {
    console.error('🔥 ERROR AL AGREGAR A CARRITO:', err.message);
    res.status(500).json({ error: 'Error interno: ' + err.message });
  }
});

router.delete('/:product_id', authRequired(), async (req, res) => {
  try {
    const userId = req.user.id;
    const { product_id } = req.params;

    await pool.query(`
      DELETE FROM cart_items
      WHERE user_id = $1 AND product_id = $2
    `, [userId, product_id]);

    res.json({ message: 'Producto eliminado de la carrito' });
  } catch (err) {
    console.error('Error al eliminar de carrito:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});
router.patch('/', authRequired(), async (req, res) => {
  try {
    const userId = req.user.id;
    const { product_id, quantity } = req.body;

    if (!product_id || typeof quantity !== 'number' || quantity < 0) {
      return res.status(400).json({ error: 'Datos inválidos' });
    }

    if (quantity === 0) {
      // Si la cantidad es 0, eliminamos el producto del carrito
      await pool.query('DELETE FROM cart_items WHERE user_id = $1 AND product_id = $2', [userId, product_id]);
    } else {
      await pool.query(`
        UPDATE cart_items
        SET quantity = $1
        WHERE user_id = $2 AND product_id = $3
      `, [quantity, userId, product_id]);
    }

    res.json({ message: 'Carrito actualizado' });
  } catch (err) {
    console.error('🔥 ERROR EN PATCH CARRITO:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});
router.delete('/', authRequired(), async (req, res) => {
  await pool.query('DELETE FROM cart_items WHERE user_id = $1', [req.user.id]);
  res.json({ message: 'Carrito vaciado' });
});

export default router;
