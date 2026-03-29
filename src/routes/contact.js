import { Router } from 'express';
import dotenv from 'dotenv';
import { pool } from '../db.js';
import { sendMail } from '../services/mailService.js';

dotenv.config();

const router = Router();

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escapeHtml(str = '') {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

router.post('/quote', async (req, res) => {
  try {
    const { email, productIds, quantity } = req.body;

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ error: 'Email inválido' });
    }

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ error: 'Debés seleccionar al menos un producto' });
    }

    const safeQuantity = Number(quantity);
    if (!Number.isInteger(safeQuantity) || safeQuantity < 1) {
      return res.status(400).json({ error: 'Cantidad inválida' });
    }

    const normalizedIds = productIds
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0);

    if (normalizedIds.length === 0) {
      return res.status(400).json({ error: 'IDs de productos inválidos' });
    }

    const receiverEmail = process.env.CONTACT_RECEIVER_EMAIL;

    if (!receiverEmail) {
      console.error('Falta CONTACT_RECEIVER_EMAIL en .env');
      return res.status(500).json({ error: 'Falta configurar el email receptor' });
    }

    const { rows: products } = await pool.query(
      `
      SELECT id, name, price, original_price
      FROM products
      WHERE id = ANY($1::int[]) AND visible = true
      ORDER BY name ASC
      `,
      [normalizedIds]
    );

    if (!products.length) {
      return res.status(404).json({ error: 'No se encontraron productos válidos' });
    }

    const productsHtml = products
      .map(
        (product) => `
          <tr>
            <td style="padding:10px;border-bottom:1px solid #eee;">${escapeHtml(product.name)}</td>
            <td style="padding:10px;border-bottom:1px solid #eee;">${escapeHtml(product.category || 'Sin categoría')}</td>
            <td style="padding:10px;border-bottom:1px solid #eee;text-align:center;">${safeQuantity}</td>
          </tr>
        `
      )
      .join('');

    const customerHtml = `
      <div style="font-family:Arial,sans-serif;padding:24px;color:#222;">
        <h2 style="color:#b22222;margin:0 0 16px;">Recibimos tu solicitud 🔥</h2>

        <p style="margin:0 0 16px;">
          Gracias por contactarte con <strong>Fuego Eterno</strong>.
          Ya recibimos tu pedido de presupuesto y te vamos a responder a la brevedad.
        </p>

        <div style="margin:20px 0;padding:16px;border:1px solid #eee;border-radius:12px;background:#fafafa;">
          <p style="margin:0 0 10px;"><strong>Email de contacto:</strong> ${escapeHtml(email)}</p>
          <p style="margin:0 0 10px;"><strong>Cantidad solicitada:</strong> ${safeQuantity}</p>
          <p style="margin:0;"><strong>Productos:</strong></p>
          <ul style="margin:10px 0 0 20px;padding:0;">
            ${products.map((product) => `<li>${escapeHtml(product.name)}</li>`).join('')}
          </ul>
        </div>

        <p style="margin-top:20px;">Gracias por elegirnos.</p>
        <p style="font-size:13px;color:#888;margin-top:24px;">
          © ${new Date().getFullYear()} Fuego Eterno
        </p>
      </div>
    `;

    const internalHtml = `
      <div style="font-family:Arial,sans-serif;padding:24px;color:#222;">
        <h2 style="color:#b22222;margin:0 0 16px;">Nuevo presupuesto solicitado</h2>

        <p style="margin:0 0 12px;"><strong>Email del cliente:</strong> ${escapeHtml(email)}</p>
        <p style="margin:0 0 20px;"><strong>Cantidad general:</strong> ${safeQuantity}</p>

        <table style="width:100%;border-collapse:collapse;border:1px solid #eee;">
          <thead>
            <tr style="background:#fafafa;">
              <th style="padding:10px;text-align:left;border-bottom:1px solid #eee;">Producto</th>
              <th style="padding:10px;text-align:left;border-bottom:1px solid #eee;">Categoría</th>
              <th style="padding:10px;text-align:center;border-bottom:1px solid #eee;">Cantidad</th>
            </tr>
          </thead>
          <tbody>
            ${productsHtml}
          </tbody>
        </table>

        <p style="font-size:13px;color:#888;margin-top:24px;">
          Generado automáticamente desde la landing de Fuego Eterno.
        </p>
      </div>
    `;

    console.log({
            email,
            normalizedIds,
            safeQuantity,
            receiverEmail,
            products,
            });

    await sendMail({
      to: email,
      subject: '🔥 Recibimos tu solicitud de presupuesto - Fuego Eterno',
      html: customerHtml,
    });

    await sendMail({
      to: receiverEmail,
      subject: '📩 Nuevo pedido de presupuesto - Fuego Eterno',
      html: internalHtml,
    });

    return res.status(200).json({
      ok: true,
      message: 'Solicitud de presupuesto enviada correctamente',
    });
  } catch (error) {
    console.error('Error en /contact/quote:', error?.response?.data || error?.message || error);

    return res.status(500).json({
      error: 'Error interno del servidor',
      detail:
        process.env.NODE_ENV !== 'production'
          ? error?.message || 'Error desconocido'
          : undefined,
    });
  }
});

export default router;