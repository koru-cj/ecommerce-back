// src/routes/paymentRoutes.js
import express from 'express';
import {
  createPreference,
  mercadoPagoWebhook,
} from '../controllers/paymentWebhookController.js';

const router = express.Router();

/**
 * Este endpoint puede quedar para testing/manual,
 * pero el checkout real del ecommerce sigue viviendo en /api/v1/checkout/init
 */
router.post('/create-preference', createPreference);

/**
 * Webhook alternativo / preparado para futura migración.
 * El flujo ACTIVO hoy sigue en /api/v1/checkout/webhook
 * porque así lo tenés funcionando.
 */
router.post('/webhook', mercadoPagoWebhook);

export default router;