// src/routes/paymentRoutes.js
import express from "express";
import {
  createPreference,
  mercadoPagoWebhook,
} from "../controllers/paymentWebhookController.js";

const router = express.Router();

router.post("/create-preference", createPreference);
router.post("/webhook", mercadoPagoWebhook);

export default router;
