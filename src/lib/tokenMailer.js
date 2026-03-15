// src/lib/tokenMailer.js
import { randomBytes } from "crypto";
import { pool } from "../db.js";
import { Resend } from "resend";
import dotenv from "dotenv";
dotenv.config();

// ⚙️ Inicializa Resend
const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Genera token, lo guarda en email_verifications y envía un correo de verificación
 * @param {Object} user - { id, name, email }
 */
export async function sendVerificationToken(user) {
  try {
    // 1️⃣ Generar token y guardarlo
    const token = randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    await pool.query(
      `INSERT INTO email_verifications (user_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, token, expires]
    );

    // 2️⃣ Generar link de verificación
    const link = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;

    // 3️⃣ Plantilla HTML (personalizable)
    const html = `
      <div style="font-family:Arial,sans-serif;padding:16px;color:#333;">
        <h2 style="color:#e63946;">Hola ${user.name} 👋</h2>
        <p>Gracias por registrarte en <strong>Fuego Eterno</strong>.</p>
        <p>Para activar tu cuenta, hacé clic en el siguiente enlace:</p>
        <a href="${link}" 
           style="display:inline-block;margin-top:10px;padding:10px 18px;
                  background:#e63946;color:#fff;text-decoration:none;border-radius:6px;">
          Verificar cuenta 🔥
        </a>
        <p style="margin-top:20px;font-size:13px;color:#999;">
          Si no creaste esta cuenta, podés ignorar este correo.
        </p>
        <hr style="margin:20px 0;"/>
        <p style="font-size: 13px; color: #999;">© ${new Date().getFullYear()} Fuego Eterno</p>
      </div>
    `;

    // 4️⃣ Enviar correo vía Resend
    // 4️⃣ Enviar correo vía Resend
    try {
    const { data, error } = await resend.emails.send({
        from: `Fuego Eterno <${process.env.FROM_EMAIL}>`,
        to: [user.email],
        subject: "Verificá tu cuenta en Fuego Eterno 🔥",
        html,
    });

    if (error) console.error("💥 Error al enviar correo:", error);
    else console.log("✅ Token creado y email enviado:", user.email, data.id);
    } catch (mailError) {
    console.error("⚠️ Falló el envío del correo, pero el usuario fue creado:", mailError);
    }

  } catch (err) {
    console.error("💥 Error en sendVerificationToken:", err);
    throw err;
  }
}
