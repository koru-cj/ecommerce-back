// src/controllers/paymentWebhookController.js
import crypto from "crypto";
import { Preference } from "mercadopago";
import { mpClient } from "../config/mercadopago.js";
if (!process.env.FRONTEND_URL) {
  throw new Error('Falta configurar FRONTEND_URL');
}

if (!process.env.BACKEND_PUBLIC_URL) {
  throw new Error('Falta configurar BACKEND_PUBLIC_URL');
}

const successUrl = `${process.env.FRONTEND_URL}/payment/success`;
const pendingUrl = `${process.env.FRONTEND_URL}/payment/pending`;
const failureUrl = `${process.env.FRONTEND_URL}/payment/failure`;
const notificationUrl = `${process.env.BACKEND_PUBLIC_URL}/checkout/webhook`;

console.log('MP URL DEBUG', {
  successUrl,
  pendingUrl,
  failureUrl,
  notificationUrl,
});

// Si también querés dejar createPreference acá:
export const createPreference = async (req, res) => {
  try {
    const preference = new Preference(mpClient);

    const result = await preference.create({
      body: {
        items: [
          {
            title: "Producto de prueba",
            quantity: 1,
            unit_price: 1000,
            currency_id: "ARS",
          },
        ],
        back_urls: {
          success: "https://tu-frontend.com/payment/success",
          pending: "https://tu-frontend.com/payment/pending",
          failure: "https://tu-frontend.com/payment/failure",
        },
        auto_return: "approved",
        notification_url: `${process.env.MP_BASE_URL}/payments/webhook`,
        external_reference: "ORDER_12345",
      },
    });

    return res.status(200).json({
      id: result.id,
      init_point: result.init_point,
    });
  } catch (error) {
    console.error("Error creando preferencia:", error);
    return res.status(500).json({ error: "No se pudo crear la preferencia" });
  }
};

function parseXSignature(headerValue = "") {
  const parts = headerValue.split(",");
  const data = {};

  for (const part of parts) {
    const [key, value] = part.split("=");
    if (key && value) data[key.trim()] = value.trim();
  }

  return {
    ts: data.ts,
    v1: data.v1,
  };
}

/**
 * Validación de origen del webhook.
 * Mercado Pago documenta el uso de x-signature y x-request-id
 * con una clave secreta para validar autenticidad.
 */
function validateMercadoPagoSignature(req) {
  try {
    const secret = process.env.MP_WEBHOOK_SECRET;
    if (!secret) {
      console.warn("MP_WEBHOOK_SECRET no configurado. Se omite validación de firma.");
      return true;
    }

    const xSignature = req.headers["x-signature"];
    const xRequestId = req.headers["x-request-id"];

    if (!xSignature || !xRequestId) {
      return false;
    }

    const { ts, v1 } = parseXSignature(String(xSignature));
    if (!ts || !v1) {
      return false;
    }

    // Mercado Pago usa un template/manifiesto de firma basado en ts,
    // x-request-id y el identificador del recurso notificado.
    const dataId =
      req.query["data.id"] ||
      req.body?.data?.id ||
      req.query.id ||
      req.body?.id ||
      "";

    const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;

    const hmac = crypto
      .createHmac("sha256", secret)
      .update(manifest)
      .digest("hex");

    return hmac === v1;
  } catch (error) {
    console.error("Error validando firma webhook:", error);
    return false;
  }
}

async function getPaymentById(paymentId) {
  const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${process.env.MP_ACCESSTOKEN}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Error consultando pago ${paymentId}: ${response.status} - ${text}`);
  }

  return response.json();
}

export const mercadoPagoWebhook = async (req, res) => {
  try {
    // 1) Responder rápido
    res.sendStatus(200);

    // 2) Validar firma
    const isValid = validateMercadoPagoSignature(req);
    if (!isValid) {
      console.warn("Webhook Mercado Pago rechazado por firma inválida");
      return;
    }

    // 3) Detectar tipo de evento
    const topic =
      req.query.type ||
      req.body?.type ||
      req.query.topic ||
      req.body?.topic;

    const paymentId =
      req.query["data.id"] ||
      req.body?.data?.id ||
      req.query.id ||
      req.body?.id;

    if (!paymentId) {
      console.warn("Webhook sin payment id");
      return;
    }

    // Para Checkout Pro lo normal es atender pagos
    if (topic !== "payment") {
      console.log("Evento no manejado:", topic);
      return;
    }

    // 4) Consultar el pago real en Mercado Pago
    const payment = await getPaymentById(paymentId);

    console.log("Pago consultado:", {
      id: payment.id,
      status: payment.status,
      status_detail: payment.status_detail,
      external_reference: payment.external_reference,
    });

    // 5) Idempotencia en tu DB
    // Antes de actualizar, verificá si ese payment.id ya fue procesado.
    // Ejemplo:
    // const alreadyProcessed = await paymentsRepo.existsByMpPaymentId(payment.id);
    // if (alreadyProcessed) return;

    // 6) Actualizar tu orden interna según estado real
    switch (payment.status) {
      case "approved":
        // await ordersRepo.markAsPaid({
        //   orderRef: payment.external_reference,
        //   mpPaymentId: payment.id,
        //   raw: payment,
        // });
        console.log("Orden aprobada:", payment.external_reference);
        break;

      case "pending":
      case "in_process":
        // await ordersRepo.markAsPending(...)
        console.log("Orden pendiente:", payment.external_reference);
        break;

      case "rejected":
      case "cancelled":
        // await ordersRepo.markAsFailed(...)
        console.log("Orden rechazada/cancelada:", payment.external_reference);
        break;

      default:
        console.log("Estado no contemplado:", payment.status);
        break;
    }
  } catch (error) {
    console.error("Error procesando webhook Mercado Pago:", error);
  }
};
