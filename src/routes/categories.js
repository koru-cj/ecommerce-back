import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

/**
 * GET /api/v1/categories
 * Devuelve todos los productos (ordenados por nombre)
 * Ejemplo de consulta: SELECT * FROM categories ORDER BY name;
 */
router.get('/', async (_, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT 
         c.id,
         c.name
       FROM categories c`
    );
    res.json(rows);
  } catch (err) {
    console.error('Error al obtener categorias:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;
