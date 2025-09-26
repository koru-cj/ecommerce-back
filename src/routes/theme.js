import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();
// GET /api/theme
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT variables
      FROM themes
      WHERE activo = TRUE
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No hay tema activo' });
    }

    res.json(result.rows[0].variables);
  } catch (err) {
    console.error('Error al obtener el tema activo:', err);
    res.status(500).json({ error: 'Error al obtener el tema activo' });
  }
});


export default router;
