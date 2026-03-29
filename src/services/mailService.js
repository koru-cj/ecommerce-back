import { Resend } from 'resend';
import dotenv from 'dotenv';

dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY);
const from = process.env.CONTACT_FROM_EMAIL;

export async function sendMail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('Falta RESEND_API_KEY en .env');
  }

  if (!from) {
    throw new Error('Falta CONTACT_FROM_EMAIL en .env');
  }

  if (!to) {
    throw new Error('Falta destinatario del email');
  }

  const { data, error } = await resend.emails.send({
    from,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
  });

  if (error) {
    console.error('Resend error:', error);
    throw new Error(error.message || 'No se pudo enviar el email');
  }

  return data;
}