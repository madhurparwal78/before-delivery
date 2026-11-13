import { config } from "./config";
import { iso, now } from "./clock";
import { fail } from "./errors";
import { isBefore } from "./rules";
import { isObject, parseJson } from "./parse";
import type { EstimateView } from "../shared/types";

const CARRIER_WAIT_MS = 4000;

interface CarrierRequest {
  weightG: number;
  longestSideMm: number;
  postcodeArea: string;
}

function readAnswer(raw: string): EstimateView {
  const body = parseJson(raw);
  if (!isObject(body)) return fail("carrier_malformed");
  const { band, charge_minor: charge, currency, valid_until: validUntil } = body;
  if (typeof band !== "string" || !/^[A-Z0-9]{1,4}$/.test(band)) return fail("carrier_malformed");
  if (typeof charge !== "number" || !Number.isInteger(charge) || charge < 0) return fail("carrier_malformed");
  if (currency !== "GBP") return fail("carrier_malformed");
  if (typeof validUntil !== "string") return fail("carrier_malformed");
  const until = new Date(validUntil);
  if (Number.isNaN(until.getTime()) || !isBefore(now(), until)) return fail("carrier_malformed");
  return { band, charge_minor: charge, currency: "GBP", valid_until: iso(until) };
}

/** The carrier is the only source of carriage bands and charges: slow, failing and malformed answers make no quote. */
export async function carriageQuote(request: CarrierRequest): Promise<EstimateView> {
  const query = new URLSearchParams({ weight_g: String(request.weightG), longest_side_mm: String(request.longestSideMm), postcode_area: request.postcodeArea });
  let status: number;
  let raw: string;
  try {
    const response = await fetch(`${config.carrierUrl}/v1/carriage/quote?${query.toString()}`, { signal: AbortSignal.timeout(CARRIER_WAIT_MS) });
    status = response.status;
    raw = await response.text();
  } catch (error) {
    return fail(error instanceof Error && error.name === "TimeoutError" ? "carrier_timeout" : "carrier_unavailable");
  }
  if (status !== 200) return fail("carrier_unavailable");
  return readAnswer(raw);
}
