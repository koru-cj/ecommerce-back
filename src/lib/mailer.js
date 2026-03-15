import { Resend } from "resend";
import dotenv from "dotenv";
dotenv.config();

// 🔑 Tu API Key de Resend (desde .env)
const resend = new Resend(process.env.RESEND_API_KEY);

// 🚀 Test de envío de correo
(async function () {
  const { data, error } = await resend.emails.send({
    from: "Fuego Eterno <noreply@fuego-eterno.com>",   // 👈 tu dominio verificado
    to: ["vannordenjordi@gmail.com"],                // 👈 tu mail real de prueba
    subject: "🔥 ¡Fuego Eterno funcionando!",
    html: `
      <div style="font-family: Arial, sans-serif; padding: 16px; color: #333;">
        <h2 style="color:#e63946;">Hola Cami 👋</h2>
        <p>Tu integración con <strong>Resend</strong> y <strong>Fuego Eterno</strong> está funcionando correctamente.</p>
        <p style="margin-top:12px;">Si recibís este correo, significa que tu dominio <b>fuegoeterno.com</b> ya está verificado y listo para enviar emails profesionales 🔥</p>
        <hr style="margin:20px 0;"/>
        <p style="font-size: 13px; color: #999;">© ${new Date().getFullYear()} Fuego Eterno</p>
      </div>
    `,
  });

  if (error) {
    console.error("💥 Error al enviar el correo:", error);
    return;
  }

  console.log("✅ Email enviado correctamente:", data);
})();
