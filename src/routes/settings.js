import { Router } from 'express';
import { pool } from '../db.js';
import { authRequired } from '../middlewares/authMiddleware.js';

const router = Router();

// GET público
router.get('/', async (_, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM settings LIMIT 1`);
    res.json(rows[0]);
  } catch (err) {
    console.error('Error al obtener settings:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// PUT protegido
router.put('/', authRequired('admin'), async (req, res) => {
  const { nombre_logo, url_logo, slogan, info_extra } = req.body;

  if (!nombre_logo || !url_logo || !slogan) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

  try {
    const result = await pool.query(
      `UPDATE settings
       SET nombre_logo = $1,
           url_logo = $2,
           slogan = $3,
           info_extra = $4,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = 1
       RETURNING *`,
      [nombre_logo, url_logo, slogan, info_extra]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error al actualizar settings:', err);
    res.status(500).json({ error: 'Error al actualizar configuración' });
  }
});

export default router;
