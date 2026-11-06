// The signing endpoints: the token opens only its own agreement, and stops
// working once signed, after its lifetime, when its hold expires, when
// revoked, or when replaced.
import type { ApiRequest, JsonResponseBody } from "../http/server.js";
import type { RouteRegistrar } from "./routes.js";
import { loadContract, isoSecond } from "./routes.js";
import { boundPriceList } from "./contracts.js";
import { ApiError } from "../errors.js";
import { itemFor } from "../domain/priceLists.js";
import { instrumentLabel } from "../../shared/domain.js";
import { formatTaxPercent } from "../domain/money.js";
import { storeToday, withSweep, lockContract } from "./helpers.js";
import { agreementKey } from "../services/storage.js";
import { agreementPdf } from "../services/pdfgen.js";
import { formatStoreDateTime } from "./format.js";
import { appendHistory } from "../domain/contractState.js";
import type { PoolClient } from "pg";

interface SigningLink {
  id: string;
  contractId: string;
  token: string;
  status: string;
  expiresAt: Date;
}

async function liveLink(client: PoolClient, token: string): Promise<SigningLink | null> {
  const rows = await client.query<Record<string, unknown>>(
    "SELECT * FROM signing_links WHERE token = $1",
    [token]
  );
  if (rows.rows.length === 0) return null;
  const r = rows.rows[0];
  return {
    id: r.id as string,
    contractId: r.contract_id as string,
    token: r.token as string,
    status: r.status as string,
    expiresAt: new Date(r.expires_at as string),
  };
}

function linkNotFound(): ApiError {
  return new ApiError(404, "link_not_found", "This signing link is not valid.");
}

function linkExpired(): ApiError {
  return new ApiError(410, "link_expired", "This signing link has expired. Ask Keel & Bell for a new one.");
}

function linkUsed(): ApiError {
  return new ApiError(410, "link_used", "This agreement has already been signed.");
}

export function registerSigningRoutes(reg: RouteRegistrar): void {
  reg.add("GET", "/api/signing/{token}", async (req: ApiRequest) => {
    const today = storeToday(reg.clock);
    return withSweep(reg.db, reg.clock, async (client) => {
      const link = await liveLink(client, req.params.token);
      if (!link || link.status === "revoked") throw linkNotFound();
      if (link.status === "used") throw linkUsed();
      if (link.status === "expired") throw linkExpired();
      if (link.expiresAt.getTime() <= reg.clock.now().getTime()) {
        await client.query("UPDATE signing_links SET status = 'expired' WHERE id = $1 AND status = 'live'", [link.id]);
        throw linkExpired();
      }
      const contract = await loadContract(client, link.contractId);
      if (!contract) throw linkNotFound();
      if (["signed", "active", "exchanged", "paid_off", "returned", "written_off"].includes(contract.status as string)) {
        throw linkUsed();
      }
      if (contract.status === "expired") throw linkExpired();
      const list = await boundPriceList(client, contract, today);
      const item = itemFor(list, contract.instrument_type as never);
      const student = await client.query<{ name: string }>("SELECT name FROM students WHERE id = $1", [contract.student_id]);
      const school = await client.query<{ name: string }>("SELECT name FROM schools WHERE id = $1", [contract.school_id]);
      return {
        status: 200,
        body: {
          server_now: reg.clock.now().toISOString(),
          agreement: {
            contract_id: contract.id as string,
            student_name: student.rows[0]?.name ?? "",
            school_name: school.rows[0]?.name ?? "",
            instrument_label: instrumentLabel(contract.instrument_type as never, contract.size as never),
            serial: contract.serial,
            waiver: Boolean(contract.waiver),
            terms: {
              price_list_id: list.id,
              bound: false,
              base_rent_cents: item.base_rent_cents,
              waiver_cents: item.waiver_cents,
              purchase_price_cents: item.purchase_price_cents,
              tax_rate_bp: list.tax_rate_bp,
              term_months: Math.ceil(item.purchase_price_cents / item.base_rent_cents),
              tiers: list.tiers.map((t) => ({ ...t, label: `${t.name}, ${t.percent}% off remaining` })),
            },
            link_expires_at: isoSecond(link.expiresAt),
            status: "agreement_sent",
          },
        },
      } as JsonResponseBody;
    });
  });

  reg.add("POST", "/api/signing/{token}", async (req: ApiRequest) => {
    const body = (req.body ?? {}) as { full_name?: unknown; agree?: unknown };
    const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
    const agree = body.agree === true;
    const today = storeToday(reg.clock);
    return withSweep(reg.db, reg.clock, async (client) => {
      await lockContract(client, req.params.token);
      const link = await liveLink(client, req.params.token);
      if (!link || link.status === "revoked") throw linkNotFound();
      if (link.status === "used") throw linkUsed();
      if (link.status === "expired") throw linkExpired();
      if (link.expiresAt.getTime() <= reg.clock.now().getTime()) {
        await client.query("UPDATE signing_links SET status = 'expired' WHERE id = $1 AND status = 'live'", [link.id]);
        throw linkExpired();
      }
      const contract = await loadContract(client, link.contractId);
      if (!contract) throw linkNotFound();
      if (contract.status === "expired") throw linkExpired();
      if (contract.status !== "reserved" && contract.status !== "agreement_sent") throw linkUsed();
      const fields: Record<string, string> = {};
      if (fullName.length < 2 || fullName.length > 120) {
        fields.full_name = "Type your full legal name.";
      }
      if (!agree) {
        fields.agree = "Tick the box to agree.";
      }
      if (Object.keys(fields).length > 0) {
        throw ApiError.validation(fields);
      }
      // Bind to the price list in force today, produce and store the PDF,
      // then move the contract to signed.
      const list = await boundPriceList(client, contract, today);
      const item = itemFor(list, contract.instrument_type as never);
      const student = await client.query<{ name: string }>("SELECT name FROM students WHERE id = $1", [contract.student_id]);
      const pdf = await agreementPdf({
        contractId: contract.id as string,
        studentName: student.rows[0]?.name ?? "",
        serial: contract.serial as string,
        instrumentLabel: instrumentLabel(contract.instrument_type as never, contract.size as never),
        priceListId: list.id,
        baseRentCents: item.base_rent_cents,
        waiverCents: contract.waiver ? item.waiver_cents : null,
        purchasePriceCents: item.purchase_price_cents,
        taxPercent: formatTaxPercent(list.tax_rate_bp),
        termMonths: Math.ceil(item.purchase_price_cents / item.base_rent_cents),
        tierLabels: list.tiers.map((t) => `${t.name}, ${t.percent}% off remaining`),
        fullName,
        signedAtText: formatStoreDateTime(reg.clock.now()),
      });
      try {
        await reg.storage.put(agreementKey(contract.id as string), pdf, "application/pdf");
      } catch {
        throw ApiError.unavailable("storage");
      }
      const now = reg.clock.now();
      await client.query(
        "UPDATE contracts SET status = 'signed', signed_at = $2, price_list_id = $3, agreement_stored = true WHERE id = $1",
        [contract.id, now, list.id]
      );
      await client.query("UPDATE signing_links SET status = 'used' WHERE token = $1", [req.params.token]);
      await appendHistory(client, contract.id as string, contract.status as "reserved" | "agreement_sent", "signed", now, "parent", fullName);
      return {
        status: 200,
        body: {
          agreement: {
            contract_id: contract.id as string,
            status: "signed",
            signed_at: isoSecond(now),
          },
        },
      } as JsonResponseBody;
    });
  });
}
