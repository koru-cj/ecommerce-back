// src/routes/auth.js
import { Router } from 'express';
import { pool } from '../db.js';
import { body, validationResult } from 'express-validator';
import { hashPassword, comparePassword, signToken } from '../lib/authHash.js';
import { authRequired } from '../middlewares/authMiddleware.js';
import { sendVerificationToken } from "../lib/tokenMailer.js";

const router = Router();
//
// 🧱 REGISTER – Crea usuario y envía mail de verificación
//
router.post(
  "/register",
  [
    body("name").notEmpty().withMessage("El nombre es obligatorio"),
    body("email").isEmail().withMessage("Correo inválido"),
    body("password").isLength({ min: 6 }).withMessage("Debe tener al menos 6 caracteres"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    const { name, email, password } = req.body;

    try {
      // 🔍 Verificar si ya existe el email
      const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
      if (existing.rows.length)
        return res.status(409).json({ error: "El email ya está registrado" });

      // 🔐 Hashear contraseña y crear usuario pendiente
      const hashed = await hashPassword(password);
      const result = await pool.query(
        `INSERT INTO users (name, email, password_hash, status, verificado)
         VALUES ($1, $2, $3, 'pending', false)
         RETURNING id, name, email`,
        [name, email, hashed]
      );
      const user = result.rows[0];

      // ✉️ Generar token y enviar correo de verificación
      await sendVerificationToken(user);

      // ✅ Respuesta al frontend
      res.status(201).json({
        message:
          "Usuario creado correctamente. Revisá tu correo para verificar la cuenta.",
      });
    } catch (err) {
      console.error("💥 Error en registro:", err);
      res.status(500).json({ error: "Error en el servidor" });
    }
  }
);

//
// ✅ VERIFY EMAIL – Confirma cuenta
//
router.get("/verify-email", async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status (400).json({ error: "Token requerido" });

  try {
    const result = await pool.query(
      `SELECT * FROM email_verifications WHERE token = $1 AND used = false`,
      [token]
    );
    const record = result.rows[0];
    if (!record) return res.status(400).json({ error: "Token inválido o usado" });
    if (new Date(record.expires_at) < new Date())
      return res.status(400).json({ error: "Token expirado" });

    // Marcar usuario como verificado
    await pool.query(
      `UPDATE users SET verificado = true, status = 'active' WHERE id = $1`,
      [record.user_id]
    );
    await pool.query(`UPDATE email_verifications SET used = true WHERE id = $1`, [
      record.id,
    ]);

    res.json({ message: "Cuenta verificada correctamente ✅" });
  } catch (err) {
    console.error("💥 Error al verificar email:", err);
    res.status(500).json({ error: "Error en el servidor" });
  }
});


router.post("/resend-verification", async (req, res) => {
  const { email } = req.body;
  if (!email)
    return res.status(400).json({ error: "El correo electrónico es requerido" });

  try {
    const result = await pool.query("SELECT id, name, email, verificado FROM users WHERE email = $1", [email]);
    const user = result.rows[0];
    if (!user)
      return res.status(404).json({ error: "No se encontró un usuario con ese correo" });

    if (user.verificado)
      return res.status(400).json({ error: "Esta cuenta ya está verificada" });

    await sendVerificationToken(user);

    res.json({
      message:
        "Se envió un nuevo correo de verificación. Revisá tu bandeja o la carpeta de spam.",
    });
  } catch (err) {
    console.error("💥 Error al reenviar verificación:", err);
    res.status(500).json({ error: "Error en el servidor" });
  }
});
// Login
// src/routes/auth.js  ➜  dentro del handler /login
router.post(
  '/login',
  [
    body('email').isEmail(),
    body('password').notEmpty(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    const { email, password } = req.body;

    try {
      const result = await pool.query(
        'SELECT * FROM users WHERE email = $1',
        [email]
      );
      const user = result.rows[0];
      if (!user) return res.status(401).json({ error: 'Credenciales inválidas' });

      const match = await comparePassword(password, user.password_hash);

      if (!match) return res.status(401).json({ error: 'Credenciales inválidas' });

      const token = signToken({ id: user.id, role: user.role });
      console.log('✅ Login OK, token emitido');  

      res.json({
        token,
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
      });
    } catch (err) {
      console.error('💥 Error en login:', err);       // 5️⃣  cualquier fallo SQL
      res.status(500).json({ error: 'Error en el servidor' });
    }
  }
);

// Endpoint protegido para verificar token y rol
router.get('/me', authRequired(), async (req, res) => {
  try {
    const { id } = req.user;
    const result = await pool.query('SELECT id, name, email, role, created_at, phone, document_number, address, city, postal_code, country FROM users WHERE id = $1', [id]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

// Actualizar datos del usuario con validaciones
router.patch(
  '/updateme',
  authRequired(),
  [
    body('phone')
      .optional()
      .isMobilePhone('any')
      .withMessage('Teléfono inválido'),

    body('document_number')
      .optional()
      .isLength({ max: 20 })
      .withMessage('Documento demasiado largo'),

    body('address')
      .optional()
      .isLength({ max: 60 })
      .withMessage('Dirección demasiado larga'),

    body('city')
      .optional()
      .isLength({ max: 45 }),

    body('postal_code')
      .optional()
      .isLength({ max: 12 }),

    body('country')
      .optional()
      .isLength({ max: 45 })
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    const userId = req.user.id;
    const {
      name,
      phone,
      document_number,
      address,
      city,
      postal_code,
      country,
    } = req.body;

    const fields = [];
    const values = [];
    let idx = 1;

    const updates = {
      name,
      phone,
      document_number,
      address,
      city,
      postal_code,
      country,
    };

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        fields.push(`${key} = $${idx}`);
        values.push(value);
        idx++;
      }
    }

    if (fields.length === 0)
      return res.status(400).json({ error: 'No hay campos para actualizar' });

    values.push(userId);
    const query = `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, name, email, role, created_at, phone, document_number, address, city, postal_code, country`;

    try {
      const result = await pool.query(query, values);
      res.json(result.rows[0]);
    } catch (err) {
      console.error('💥 Error al actualizar usuario:', err);
      res.status(500).json({ error: 'Error en el servidor' });
    }
  }
);
export default router;
