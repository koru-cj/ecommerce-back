// src/config/mercadoPago.js
import { MercadoPagoConfig } from "mercadopago";

export const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESSTOKEN,
});


export const createMpPreference = () => new Preference(mpClient);