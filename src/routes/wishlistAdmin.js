import { Router } from 'express';
import { pool } from '../db.js';
import { authRequired } from '../middlewares/authMiddleware.js';

const router = Router();

router.get('/', authRequired('admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        p.id AS product_id,
        p.name AS product_name,
        COUNT(w.user_id) AS wishlist_count
      FROM wishlist_items w
      JOIN products p ON p.id = w.product_id
      GROUP BY p.id, p.name
      ORDER BY wishlist_count DESC
    `);

    res.json(rows);
  } catch (err) {
    console.error('❌ Error al obtener estadísticas de wishlist:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;
