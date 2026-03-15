// src/controllers/paymentController.js
import { Preference } from "mercadopago";
import { mpClient } from "../config/mercadopago.js";

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
        notification_url: `${process.env.MP_BASE_URL}/api/payments/webhook`,
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
