import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { pool } from './db.js';
import rootRouter from './routes/root.js';
import productsRouter from './routes/products.js';

import categoriesRouter from './routes/categories.js';
import authRouter from './routes/auth.js';
import authGoogleRouter from './routes/authGoogle.js';
import adminRouter from './routes/admin.js';

import wishlistRouter from './routes/wishlist.js';
import wishlistAdminRouter from './routes/wishlistAdmin.js';
import themeRouter from './routes/theme.js';
import settingsRouter from './routes/settings.js';
import cartRouter from './routes/cart.js';

import checkoutRouter from './routes/checkout.js';
import ordersRouter from './routes/orders.js'

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({
  origin: 'http://localhost:5173', // tu frontend
  credentials: true, // si vas a usar cookies o headers auth
}));
app.use(morgan('dev'));
app.use(express.json());


app.use('/api/v1', rootRouter);
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/auth', authGoogleRouter);
app.use('/api/v1/dashboard', adminRouter);
app.use('/api/v1/products', productsRouter);  
app.use('/api/v1/categories', categoriesRouter);  
app.use('/api/v1/wishlist', wishlistRouter);
app.use('/api/v1/wishlistAdmin', wishlistAdminRouter);
app.use('/api/v1/theme', themeRouter);
app.use('/api/v1/settings', settingsRouter);
app.use('/api/v1/cart', cartRouter);
app.use('/api/v1/checkout', checkoutRouter); 
app.use('/api/v1/orders', ordersRouter);

(async () => {
  try {
    await pool.query('SELECT NOW()');
    console.log('✅ Conectado a PostgreSQL vía Railway');
  } catch (err) {
    console.error('❌ Error al conectar con la DB:', err);
  }
})();


app.listen(PORT, () => console.log(`API running on port ${PORT}`));
