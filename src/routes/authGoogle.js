import { Router } from "express";
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import { pool } from "../db.js";
import crypto from "crypto";
import bcrypt from "bcryptjs";

const router = Router();
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// 🚀 Registro / Login con Google
router.post("/google-login", async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ error: "Falta el token de Google" });

    // 1️⃣ Verificar token con Google
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    const {
      email,
      given_name: nombre,
      family_name: apellido,
      picture: avatar_url,
      sub: google_id,
    } = payload;

    if (!email) return res.status(400).json({ error: "No se pudo obtener el correo de Google" });

    // 2️⃣ Buscar si ya existe el usuario
    const existing = await pool.query("SELECT * FROM users WHERE email = $1", [email]);

    let user;

    if (existing.rows.length === 0) {
  const fullName = `${nombre} ${apellido || ""}`.trim();

  // 🔐 Generar contraseña aleatoria segura
  const randomPassword = crypto.randomBytes(16).toString("hex");
  const passwordHash = await bcrypt.hash(randomPassword, 10);

  const insert = await pool.query(
        `INSERT INTO users (name, email, google_id, avatar_url, verificado, status, password_hash)
        VALUES ($1, $2, $3, $4, true, 'active', $5)
        ON CONFLICT (email)
        DO UPDATE SET
            name = EXCLUDED.name,
            avatar_url = EXCLUDED.avatar_url,
            google_id = EXCLUDED.google_id,
            verificado = true,
            updated_at = now()
        RETURNING id, name, email, role, avatar_url, verificado, google_id`,
        [fullName, email, google_id, avatar_url, passwordHash]
    );

    user = insert.rows[0];
    console.log(`🆕 Nuevo usuario creado con Google: ${user.email}`);
    } else {
      // 🔄 Actualizar datos de usuario existentes con los más recientes de Google
      const current = existing.rows[0];

      const update = await pool.query(
        `UPDATE users
         SET name = $1,
             avatar_url = $2,
             google_id = $3,
             verificado = true,
             updated_at = NOW()
         WHERE id = $4
         RETURNING id, name, email, role, avatar_url, verificado`,
        [`${nombre} ${apellido || ""}`.trim(), avatar_url, google_id, current.id]
      );

      user = update.rows[0];
      console.log(`🔁 Usuario actualizado desde Google: ${user.email}`);
    }

    // 3️⃣ Generar token JWT
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    // 4️⃣ Responder con los datos actualizados
    res.json({
      message: "Inicio de sesión exitoso con Google",
      token,
      user,
    });
  } catch (err) {
    console.error("💥 Error en login con Google:", err);
    res.status(500).json({ error: "Error al autenticar con Google" });
  }
});
router.post("/google-sync", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "Falta token" });

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const userRes = await pool.query("SELECT * FROM users WHERE id = $1", [decoded.id]);
    const user = userRes.rows[0];
    if (!user || !user.google_id)
      return res.status(400).json({ error: "El usuario no tiene cuenta Google vinculada" });

    if (!req.body.credential) {
        // si no hay token nuevo, simplemente devolvemos lo que hay
        return res.json({ message: "Sin datos nuevos de Google", user });
    }
    // Sincronizar nuevamente con Google
    const ticket = await client.verifyIdToken({
      idToken: req.body.credential || null,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();


    const { given_name, family_name, picture } = payload;
    const fullName = `${given_name} ${family_name || ""}`.trim();

    const update = await pool.query(
      `UPDATE users SET name = $1, avatar_url = $2, verificado = true, updated_at = now()
       WHERE id = $3 RETURNING id, name, email, role, avatar_url, verificado, google_id`,
      [fullName, picture, user.id]
    );

    res.json({ message: "Datos sincronizados con Google", user: update.rows[0] });
  } catch (err) {
    console.error("💥 Error en sincronización Google:", err);
    res.status(500).json({ error: "Error al sincronizar datos con Google" });
  }
});

export default router;
