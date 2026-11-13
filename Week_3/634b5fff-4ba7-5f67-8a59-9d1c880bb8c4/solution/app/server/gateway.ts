import { config } from "./config.js";

/** The invented card gateway, bank and courier, served by WireMock. */

export class GatewayUnreachable extends Error {
  constructor() {
    super("gateway unreachable");
  }
}

export interface GatewayReply {
  status: number;
  body: Record<string, unknown>;
}

const post = async (path: string, body: unknown, idempotencyKey: string): Promise<GatewayReply> => {
  let response: Response;
  try {
    response = await fetch(`${config.wiremockUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new GatewayUnreachable();
  }
  if (response.status >= 500) throw new GatewayUnreachable();
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
};

export interface CardDetails {
  number: string;
  expiry: string;
  cvc: string;
}

export const authorise = (reference: string, amountOre: number, card: CardDetails, key: string): Promise<GatewayReply> =>
  post("/v1/authorisations", { reference, amountOre, currency: "DKK", card }, key);

export const answerChallenge = (challengeId: string, code: string, key: string): Promise<GatewayReply> =>
  post(`/v1/challenges/${encodeURIComponent(challengeId)}`, { code }, key);

export const capture = (paymentId: string, amountOre: number, key: string): Promise<GatewayReply> =>
  post(`/v1/payments/${encodeURIComponent(paymentId)}/capture`, { amountOre }, key);

export const voidPayment = (paymentId: string, key: string): Promise<GatewayReply> =>
  post(`/v1/payments/${encodeURIComponent(paymentId)}/void`, {}, key);

export const refundPayment = (paymentId: string, amountOre: number, key: string): Promise<GatewayReply> =>
  post(`/v1/payments/${encodeURIComponent(paymentId)}/refunds`, { amountOre }, key);

export const reserveTransfer = (reference: string, amountOre: number, key: string): Promise<GatewayReply> =>
  post("/v1/transfers", { reference, amountOre, currency: "DKK" }, key);

export const refundTransfer = (transferId: string, amountOre: number, key: string): Promise<GatewayReply> =>
  post(`/v1/transfers/${encodeURIComponent(transferId)}/refund`, { amountOre }, key);

export const returnTransfer = (transferId: string, amountOre: number, key: string): Promise<GatewayReply> =>
  post(`/v1/transfers/${encodeURIComponent(transferId)}/return`, { amountOre }, key);

interface CourierBooking {
  reference: string;
  boxNumber: number;
  recipientName: string;
  address: { street: string; postcode: string; city: string };
}

export const bookCourier = (booking: CourierBooking, key: string): Promise<GatewayReply> =>
  post("/v1/courier/bookings", booking, key);
