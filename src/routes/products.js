import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

/**
 * GET /api/v1/products
 * Devuelve todos los productos (ordenados por nombre)
 * Ejemplo de consulta: SELECT * FROM products ORDER BY name;
 */
// RUTA: GET /
router.get('/', async (_, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        p.id,
        p.name,
        p.description,
        p.image_url AS "imageUrl",
        p.price,
        p.original_price AS "originalPrice",
        p.discount_percentage AS discount,
        p.rating,
        p.review_count AS "reviewCount",
        p.stock,
        p.brand,
        p.tags,
        p.unit,
        p.weight_grams AS "weightGrams",
        p.discount_expiration AS "discountExpiration",
        c.name AS category
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.visible = true
      ORDER BY p.name
    `);
    res.json(rows);
  } catch (err) {
    console.error('Error al obtener productos:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});


export default router;
