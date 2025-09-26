import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();
try {
  const u = new URL(process.env.DATABASE_URL);
  console.log('Host DB:', JSON.stringify(u.hostname)); // Debe imprimir "db.bjdyynzmcgonnnyjrcec.supabase.co"
} catch (e) {
  console.error('URL inválida:', process.env.DATABASE_URL);
}
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
