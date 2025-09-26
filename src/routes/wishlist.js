import { Router } from 'express';
import { pool } from '../db.js';
import { authRequired } from '../middlewares/authMiddleware.js';
const router = Router();
router.get('/', authRequired() ,async (req, res) => {
      try {
    const userId = req.user.id;

    const { rows } = await pool.query(`
      SELECT w.id, w.created_at, p.*
      FROM wishlist_items w
      JOIN products p ON p.id = w.product_id
      WHERE w.user_id = $1
      ORDER BY w.created_at DESC
    `, [userId]);

    res.json(rows);
  } catch (err) {
    console.error('Error al obtener wishlist:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});
router.post('/', authRequired(), async (req, res) => {
  try {
    const userId = req.user.id;
    const { product_id } = req.body;


    if (!product_id) {
      return res.status(400).json({ error: 'Falta product_id' });
    }

    await pool.query(`
      INSERT INTO wishlist_items (user_id, product_id, created_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT DO NOTHING
    `, [userId, product_id]);

    res.json({ message: 'Producto agregado a la wishlist' });
  } catch (err) {
    console.error('🔥 ERROR AL AGREGAR A WISHLIST:', err.message);
    res.status(500).json({ error: 'Error interno: ' + err.message });
  }
});

router.delete('/:product_id', authRequired(), async (req, res) => {
  try {
    const userId = req.user.id;
    const { product_id } = req.params;

    await pool.query(`
      DELETE FROM wishlist_items
      WHERE user_id = $1 AND product_id = $2
    `, [userId, product_id]);

    res.json({ message: 'Producto eliminado de la wishlist' });
  } catch (err) {
    console.error('Error al eliminar de wishlist:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});
export default router;
