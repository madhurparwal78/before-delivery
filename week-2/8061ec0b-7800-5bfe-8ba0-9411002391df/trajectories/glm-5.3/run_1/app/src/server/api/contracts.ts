// Contract endpoints: list, detail, signing links, closing moves, invoice,
// equity, quotes, PDFs and condition checks.
import type { PoolClient } from "pg";
import type { ApiRequest, FileResponse } from "../http/server.js";
import type { RouteRegistrar, HandlerResult } from "./routes.js";
import { loadContract, familyContact, isoSecond } from "./routes.js";
import { ApiError } from "../errors.js";
import type { SessionUser } from "../sessions.js";
import { serializeContract } from "../serialize.js";
import {
  appendHistory,
  equityOf,
} from "../domain/contractState.js";
import { itemFor, priceListById, priceListInForceOn, type PriceListRow } from "../domain/priceLists.js";
import { monthlyInvoice } from "../domain/billing.js";
import { quoteForMonth } from "../domain/quotes.js";
import { instrumentLabel } from "../../shared/domain.js";
import { formatTaxPercent } from "../domain/money.js";
import { lockContract, requireUser, storeToday, ts, withSweep } from "./helpers.js";
import {
  agreementKey,
  billOfSaleKey,
  conditionPhotoKey,
} from "../services/storage.js";
import { KillBillUnavailable } from "../services/killbill.js";
import { checkPhotoContent, checkPhotoSize, reencodeAsJpeg } from "../services/images.js";
import { randomToken } from "../auth.js";
import { formatStoreDateTime } from "./format.js";

export function registerContractRoutes(reg: RouteRegistrar): void {
  reg.add("GET", "/api/contracts", async (req: ApiRequest) => {
    const user = await requireUser(reg.db, req.sessionToken, ["owner", "tech", "parent"]);
    const contracts = await withSweep(reg.db, reg.clock, async (client) => {
      const params: unknown[] = [];
      let where = "TRUE";
      if (user.role === "parent") {
        params.push(user.family_id);
        where = "c.family_id = $1";
      }
      const rows = await client.query<Record<string, unknown>>(
        `SELECT c.id, c.status, c.delivery_date, i.serial, i.instrument_type, i.size,
                s.name AS student_name,
                (SELECT COALESCE(SUM(le.amount_cents), 0) FROM ledger_entries le WHERE le.contract_id = c.id) AS equity
           FROM contracts c
           JOIN instruments i ON i.id = c.instrument_id
           JOIN students s ON s.id = c.student_id
          WHERE ${where}
          ORDER BY c.created_seq ASC`,
        params
      );
      return rows.rows.map((r) => ({
        id: r.id as string,
        status: r.status as string,
        student_name: r.student_name as string,
        instrument_label: instrumentLabel(r.instrument_type as never, r.size as never),
        serial: r.serial as string,
        equity_cents: Number(r.equity),
        delivery_date: r.delivery_date as string,
      }));
    });
    return { status: 200, body: { contracts } };
  });

  reg.add("GET", "/api/contracts/{id}", async (req: ApiRequest) => {
    const user = await requireUser(reg.db, req.sessionToken, ["owner", "tech", "parent"]);
    const today = storeToday(reg.clock);
    const result = await withSweep(reg.db, reg.clock, async (client) => {
      const contract = await loadContract(client, req.params.id);
      if (!contract || !canSee(user, contract)) return null;
      const equity = await equityOf(client, contract.id as string);
      return { contract: await serializeContract(client, contract, today, equity) };
    });
    if (!result) throw ApiError.notFound("That contract does not exist.");
    return { status: 200, body: result };
  });

  reg.add("POST", "/api/contracts/{id}/signing-link", async (req: ApiRequest) => {
    const user = await requireUser(reg.db, req.sessionToken, ["owner"]);
    const result = await withSweep(reg.db, reg.clock, async (client) => {
      await lockContract(client, req.params.id);
      const contract = await loadContract(client, req.params.id);
      if (!contract) return null;
      if (contract.status !== "reserved" && contract.status !== "agreement_sent") {
        throw ApiError.conflict("invalid_transition", "This contract can't be sent for signing now.");
      }
      const now = reg.clock.now();
      // Sending again replaces the earlier link: old tokens answer 404.
      await client.query(
        "UPDATE signing_links SET status = 'revoked' WHERE contract_id = $1 AND status = 'live'",
        [contract.id]
      );
      const token = randomToken(24);
      const ttlMs = reg.config.signingLinkTtlSeconds * 1000;
      const linkExpiry = new Date(now.getTime() + ttlMs);
      const holdExpiry = contract.hold_expires_at ? new Date(contract.hold_expires_at as Date) : null;
      const expiresAt = holdExpiry && holdExpiry < linkExpiry ? holdExpiry : linkExpiry;
      await client.query(
        `INSERT INTO signing_links (id, contract_id, token, status, expires_at, created_at)
         VALUES ($1,$2,$3,'live',$4,$5)`,
        [`sl-${contract.id}-${randomToken(6)}`, contract.id, token, expiresAt, now]
      );
      await client.query(
        "UPDATE contracts SET status = 'agreement_sent' WHERE id = $1 AND status = 'reserved'",
        [contract.id]
      );
      if (contract.status === "reserved") {
        await appendHistory(client, contract.id as string, "reserved", "agreement_sent", now, "owner", user.name);
      } else {
        // Re-sending is not a state move.
        void 0;
      }
      const contact = await familyContact(client, contract.family_id as string);
      const student = await client.query<{ name: string }>("SELECT name FROM students WHERE id = $1", [
        contract.student_id,
      ]);
      const refreshed = (await loadContract(client, contract.id as string))!;
      const equity = await equityOf(client, contract.id as string);
      const body = await serializeContract(client, refreshed, storeToday(reg.clock), equity);
      return {
        contract: body,
        email: {
          to: contact?.email ?? "",
          subject: `Sign your rental agreement — ${student.rows[0]?.name}, ${instrumentLabel(contract.instrument_type as never, contract.size as never)}`,
          link: `${origin(reg)}/sign/${token}`,
          expiresAt,
        },
      };
    });
    if (!result) throw ApiError.notFound("That contract does not exist.");
    reg.mailer.queueEmail(`signing-link-${result.contract.id}-${(result.email.expiresAt as Date).getTime()}`, {
      to: result.email.to,
      subject: result.email.subject,
      text:
        `Please sign your rental agreement for your child's instrument.\n\n` +
        `Open this link: ${result.email.link}\n\n` +
        `This link works until ${formatStoreDateTime(result.email.expiresAt as Date)}.\n\n` +
        `Keel & Bell Music`,
    });
    return { status: 201, body: { contract: result.contract } };
  });

  reg.add("POST", "/api/contracts/{id}/signing-link/revoke", async (req: ApiRequest) => {
    await requireUser(reg.db, req.sessionToken, ["owner"]);
    const result = await withSweep(reg.db, reg.clock, async (client) => {
      await lockContract(client, req.params.id);
      const contract = await loadContract(client, req.params.id);
      if (!contract) return null;
      const revoked = await client.query(
        "UPDATE signing_links SET status = 'revoked' WHERE contract_id = $1 AND status = 'live' RETURNING id",
        [contract.id]
      );
      if (revoked.rows.length === 0) {
        throw ApiError.conflict("no_live_link", "There is no live signing link to revoke.");
      }
      const equity = await equityOf(client, contract.id as string);
      return { contract: await serializeContract(client, contract, storeToday(reg.clock), equity) };
    });
    if (!result) throw ApiError.notFound("That contract does not exist.");
    return { status: 200, body: result };
  });

  reg.add("POST", "/api/contracts/{id}/return", async (req: ApiRequest) => {
    return closeContract(reg, req, "returned");
  });

  // Activation: only when the signed PDF is in object storage, and however
  // many requests arrive at once exactly one succeeds.
  reg.add("POST", "/api/contracts/{id}/activate", async (req: ApiRequest) => {
    const user = await requireUser(reg.db, req.sessionToken, ["owner"]);
    const found = await withSweep(reg.db, reg.clock, async (client) => {
      await lockContract(client, req.params.id);
      const contract = await loadContract(client, req.params.id);
      if (!contract) return null;
      if (contract.status !== "signed") {
        throw ApiError.conflict("invalid_transition", "This contract can't be activated now.");
      }
      if (!contract.agreement_stored) {
        throw ApiError.conflict("agreement_not_stored", "The signed agreement isn't stored yet.");
      }
      return contract;
    });
    if (!found) throw ApiError.notFound("That contract does not exist.");
    let exists: boolean;
    try {
      exists = await reg.storage.exists(agreementKey(found.id as string));
    } catch {
      throw ApiError.unavailable("storage");
    }
    if (!exists) {
      throw ApiError.conflict("agreement_not_stored", "The signed agreement isn't stored yet.");
    }
    try {
      const { account } = await ensureAccountFor(reg, found);
      await reg.killbill.ensureSubscription(account.accountId, `${found.id}-rental`);
    } catch (err) {
      if (err instanceof KillBillUnavailable) throw ApiError.unavailable("billing");
      throw err;
    }
    const result = await reg.db.withTransaction(async (client) => {
      await lockContract(client, req.params.id);
      const fresh = await loadContract(client, req.params.id);
      if (!fresh || fresh.status !== "signed") {
        throw ApiError.conflict("invalid_transition", "This contract can't be activated now.");
      }
      const now = reg.clock.now();
      const anchor = storeToday(reg.clock);
      await client.query(
        "UPDATE contracts SET status = 'active', activated_at = $2, billing_anchor_date = $3, subscription_state = 'active' WHERE id = $1",
        [req.params.id, now, anchor]
      );
      await appendHistory(client, req.params.id, "signed", "active", now, "owner", user.name);
      const updated = (await loadContract(client, req.params.id))!;
      const equity = await equityOf(client, req.params.id);
      return { contract: await serializeContract(client, updated, storeToday(reg.clock), equity) };
    });
    return { status: 200, body: result };
  });

  reg.add("POST", "/api/contracts/{id}/write-off", async (req: ApiRequest) => {
    return closeContract(reg, req, "written_off");
  });

  reg.add("GET", "/api/contracts/{id}/invoice", async (req: ApiRequest) => {
    const user = await requireUser(reg.db, req.sessionToken, ["owner", "parent"]);
    const today = storeToday(reg.clock);
    const result = await withSweep(reg.db, reg.clock, async (client) => {
      const contract = await loadContract(client, req.params.id);
      if (!contract || !canSee(user, contract)) return null;
      const list = await boundPriceList(client, contract, today);
      const invoice = await monthlyInvoice(client, {
        contractId: contract.id as string,
        boundPriceList: list,
        instrumentType: contract.instrument_type as string,
        waiver: Boolean(contract.waiver),
        status: contract.status as string,
        anchor: (contract.billing_anchor_date as string | null) ?? null,
        today,
      });
      return { invoice };
    });
    if (!result) throw ApiError.notFound("That contract does not exist.");
    return { status: 200, body: result };
  });

  reg.add("GET", "/api/contracts/{id}/equity", async (req: ApiRequest) => {
    const user = await requireUser(reg.db, req.sessionToken, ["owner", "parent"]);
    const today = storeToday(reg.clock);
    const result = await withSweep(reg.db, reg.clock, async (client) => {
      const contract = await loadContract(client, req.params.id);
      if (!contract || !canSee(user, contract)) return null;
      const list = await boundPriceList(client, contract, today);
      const item = itemFor(list, contract.instrument_type as never);
      const equity = await equityOf(client, contract.id as string);
      const entries = await client.query<Record<string, unknown>>(
        `SELECT le.id, le.kind, le.amount_cents, le.transfer_id, le.payment_id, le.created_at,
                CASE WHEN le.kind = 'payment'
                  THEN EXISTS(SELECT 1 FROM reversals r WHERE r.payment_id = le.payment_id)
                  ELSE NULL END AS reversed,
                p.amount_cents AS payment_amount_cents,
                p.base_rent_cents AS payment_base_cents
           FROM ledger_entries le
           LEFT JOIN payments p ON p.id = le.payment_id AND le.kind = 'payment'
          WHERE le.contract_id = $1
          ORDER BY le.seq ASC`,
        [contract.id]
      );
      return {
        equity_cents: equity,
        purchase_price_cents: item.purchase_price_cents,
        contract_month: Math.floor(equity / (item.base_rent_cents || 1)),
        closed: !["reserved", "agreement_sent", "signed", "active"].includes(contract.status as string),
        entries: entries.rows.map((r) => ({
          id: r.id as string,
          kind: r.kind as string,
          amount_cents: Number(r.amount_cents),
          transfer_id: (r.transfer_id as string | null) ?? null,
          payment_id: (r.payment_id as string | null) ?? null,
          reversed: r.reversed === null || r.reversed === undefined ? null : Boolean(r.reversed),
          created_at: ts(r.created_at as string),
          ...(r.payment_amount_cents !== null && r.payment_amount_cents !== undefined
            ? {
                payment_amount_cents: Number(r.payment_amount_cents),
                payment_base_cents: Number(r.payment_base_cents),
              }
            : {}),
        })),
      };
    });
    if (!result) throw ApiError.notFound("That contract does not exist.");
    return { status: 200, body: result };
  });

  reg.add("GET", "/api/contracts/{id}/quotes", async (req: ApiRequest) => {
    const user = await requireUser(reg.db, req.sessionToken, ["owner", "parent"]);
    const today = storeToday(reg.clock);
    const result = await withSweep(reg.db, reg.clock, async (client) => {
      const contract = await loadContract(client, req.params.id);
      if (!contract || !canSee(user, contract)) return null;
      return { quotes: await quotesFor(client, contract, today) };
    });
    if (!result) throw ApiError.notFound("That contract does not exist.");
    return { status: 200, body: result };
  });

  reg.add("GET", "/api/contracts/{id}/quote", async (req: ApiRequest) => {
    const user = await requireUser(reg.db, req.sessionToken, ["owner", "parent"]);
    const today = storeToday(reg.clock);
    const result = await withSweep(reg.db, reg.clock, async (client) => {
      const contract = await loadContract(client, req.params.id);
      if (!contract || !canSee(user, contract)) return null;
      if (contract.status !== "signed" && contract.status !== "active") {
        throw ApiError.conflict("no_quote", "Quotes exist only on signed and active contracts.");
      }
      const monthRaw = req.query.get("month");
      if (monthRaw === null || !/^\d+$/.test(monthRaw)) {
        throw ApiError.validation({ month: "Choose a month from 0 to the term length." });
      }
      const quotes = await quotesFor(client, contract, today);
      const month = Number(monthRaw);
      if (month > quotes.length - 1) {
        throw ApiError.validation({ month: "Choose a month from 0 to the term length." });
      }
      return { quote: quotes[month] };
    });
    if (!result) throw ApiError.notFound("That contract does not exist.");
    return { status: 200, body: result };
  });

  reg.add("GET", "/api/contracts/{id}/agreement.pdf", async (req: ApiRequest): Promise<FileResponse> => {
    const user = await requireUser(reg.db, req.sessionToken, ["owner", "parent"]);
    const found = await withSweep(reg.db, reg.clock, async (client) => {
      const contract = await loadContract(client, req.params.id);
      if (!contract || !canSee(user, contract)) return null;
      return contract;
    });
    if (!found) throw new ApiError(404, "agreement_not_stored", "The signed agreement is not stored.");
    const contract = found;
    const key = agreementKey(contract.id as string);
    const exists = await reg.storage.exists(key).catch(() => {
      throw ApiError.unavailable("storage");
    });
    if (!exists) {
      if (!contract.signed_at) {
        throw new ApiError(404, "agreement_not_stored", "The signed agreement is not stored.");
      }
      // Seeded contracts store the PDF on the first download.
      const pdf = await buildAgreementPdf(reg, contract);
      await reg.storage.put(key, pdf, "application/pdf").catch(() => {
        throw ApiError.unavailable("storage");
      });
    }
    const bytes = await reg.storage.get(key).catch(() => {
      throw ApiError.unavailable("storage");
    });
    return {
      data: Buffer.from(bytes),
      contentType: "application/pdf",
      disposition: `inline; filename="${contract.id}-agreement.pdf"`,
    };
  });

  reg.add("GET", "/api/contracts/{id}/bill-of-sale.pdf", async (req: ApiRequest): Promise<FileResponse> => {
    const user = await requireUser(reg.db, req.sessionToken, ["owner", "parent"]);
    const found = await withSweep(reg.db, reg.clock, async (client) => {
      const contract = await loadContract(client, req.params.id);
      if (!contract || !canSee(user, contract)) return null;
      return contract;
    });
    if (!found) throw new ApiError(404, "bill_of_sale_not_stored", "The bill of sale is not stored.");
    if (!found.bill_of_sale_stored) {
      throw new ApiError(404, "bill_of_sale_not_stored", "The bill of sale is not stored.");
    }
    const bytes = await reg.storage
      .get(billOfSaleKey(found.id as string))
      .catch(() => {
        throw ApiError.unavailable("storage");
      });
    return {
      data: Buffer.from(bytes),
      contentType: "application/pdf",
      disposition: `inline; filename="${found.id}-bill-of-sale.pdf"`,
    };
  });

  reg.add("GET", "/api/contracts/{id}/condition-events", async (req: ApiRequest) => {
    const user = await requireUser(reg.db, req.sessionToken, ["owner", "tech", "parent"]);
    const result = await withSweep(reg.db, reg.clock, async (client) => {
      const contract = await loadContract(client, req.params.id);
      if (!contract || !canSee(user, contract)) return null;
      const events = await client.query<Record<string, unknown>>(
        `SELECT e.id, e.kind, e.notes, e.recorded_by, e.created_at
           FROM condition_events e WHERE e.contract_id = $1
          ORDER BY e.created_at DESC, e.id DESC`,
        [contract.id]
      );
      const out = [];
      for (const event of events.rows) {
        const photos = await client.query<{ id: string }>(
          "SELECT id FROM condition_photos WHERE event_id = $1 ORDER BY id",
          [event.id]
        );
        out.push({
          id: event.id as string,
          kind: event.kind as string,
          notes: (event.notes as string | null) ?? null,
          recorded_by: event.recorded_by as string,
          created_at: ts(event.created_at as string),
          photos: photos.rows.map((p) => ({ id: p.id, url: `/api/condition-photos/${p.id}` })),
        });
      }
      return { events: out };
    });
    if (!result) throw ApiError.notFound("That contract does not exist.");
    return { status: 200, body: result };
  });

  reg.add(
    "POST",
    "/api/contracts/{id}/condition-events",
    async (req: ApiRequest) => {
      const user = await requireUser(reg.db, req.sessionToken, ["owner", "tech"]);
      const upload = req.multipart!;
      const kind = upload.fields.kind ?? "";
      const notes = upload.fields.notes ?? "";
      const photos = upload.files.filter((f) => f.fieldName === "photos");
      const outcome = await withSweep(reg.db, reg.clock, async (client) => {
        const contract = await loadContract(client, req.params.id);
        if (!contract) return null;
        if (!["signed", "active", "exchanged", "returned"].includes(contract.status as string)) {
          throw ApiError.conflict("contract_not_open", "Condition can't be recorded on this contract.");
        }
        if (!["checkout", "exchange", "return"].includes(kind)) {
          throw ApiError.validation({ kind: "Choose check-out, exchange or return." });
        }
        if (notes.length > 1000) {
          throw ApiError.validation({ notes: "Notes are at most 1,000 characters." });
        }
        if (photos.length < 1 || photos.length > 6) {
          throw ApiError.validation({ photos: "count" });
        }
        // Per-photo checks, completing all three on one photo before the next.
        const processed: { buffer: Buffer; photoId: string }[] = [];
        for (let i = 0; i < photos.length; i++) {
          const photo = photos[i];
          const sizeCheck = checkPhotoSize(photo.size);
          if (!sizeCheck.ok) {
            throw new ApiError(413, "photo_too_large", "That photo is over 5,000,000 bytes.", {
              photo_index: i,
            });
          }
          const contentCheck = await checkPhotoContent(photo.data);
          if (!contentCheck.ok) {
            if (contentCheck.code === "unsupported_image") {
              throw new ApiError(415, "unsupported_image", "That photo isn't a JPEG, PNG or WebP photo.", {
                photo_index: i,
              });
            }
            throw ApiError.validationWith(
              { photos: "dimensions" },
              { photo_index: i }
            );
          }
          processed.push({ buffer: await reencodeAsJpeg(photo.data), photoId: randomToken(16) });
        }
        return { contract, processed };
      });
      if (!outcome) throw ApiError.notFound("That contract does not exist.");
      const { contract, processed } = outcome;
      const eventId = randomToken(12);
      const keys = processed.map((p) => conditionPhotoKey(contract.id as string, eventId, p.photoId));
      // All or nothing: every check has passed; store every object, then commit.
      const written: string[] = [];
      try {
        for (let i = 0; i < keys.length; i++) {
          await reg.storage.put(keys[i], processed[i].buffer, "image/jpeg");
          written.push(keys[i]);
        }
      } catch {
        await reg.storage.delete(written).catch(() => undefined);
        throw ApiError.unavailable("storage");
      }
      await reg.db.withTransaction(async (client) => {
        await client.query(
          `INSERT INTO condition_events (id, contract_id, kind, notes, recorded_by, created_at)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [eventId, contract.id, kind, notes || null, user.name, reg.clock.now()]
        );
        for (const p of processed) {
          await client.query(
            "INSERT INTO condition_photos (id, event_id, contract_id) VALUES ($1,$2,$3)",
            [p.photoId, eventId, contract.id]
          );
        }
      });
      return {
        status: 201,
        body: {
          event: {
            id: eventId,
            kind,
            notes: notes || null,
            recorded_by: user.name,
            created_at: isoSecond(reg.clock.now()),
            photos: processed.map((p) => ({
              id: p.photoId,
              url: `/api/condition-photos/${p.photoId}`,
            })),
          },
        },
      };
    },
    { multipart: true }
  );

  reg.add("GET", "/api/condition-photos/{id}", async (req: ApiRequest): Promise<FileResponse> => {
    const user = await requireUser(reg.db, req.sessionToken, ["owner", "tech", "parent"]);
    const found = await reg.db.withTransaction(async (client) => {
      const photos = await client.query<Record<string, unknown>>(
        "SELECT * FROM condition_photos WHERE id = $1",
        [req.params.id]
      );
      if (photos.rows.length === 0) return null;
      const contract = await loadContract(client, photos.rows[0].contract_id as string);
      if (!contract) return null;
      if (user.role === "parent" && contract.family_id !== user.family_id) return null;
      return {
        key: conditionPhotoKey(
          contract.id as string,
          photos.rows[0].event_id as string,
          photos.rows[0].id as string
        ),
      };
    });
    if (!found) throw ApiError.notFound("That photo does not exist.");
    const bytes = await reg.storage.get(found.key).catch(() => {
      throw ApiError.unavailable("storage");
    });
    return { data: Buffer.from(bytes), contentType: "image/jpeg" };
  });

  async function closeContract(
    reg2: RouteRegistrar,
    req: ApiRequest,
    to: "returned" | "written_off"
  ): Promise<HandlerResult> {
    const user = await requireUser(reg2.db, req.sessionToken, ["owner"]);
    const found = await withSweep(reg2.db, reg2.clock, async (client) => {
      await lockContract(client, req.params.id);
      const contract = await loadContract(client, req.params.id);
      if (!contract) return null;
      if (contract.status !== "active") {
        throw ApiError.conflict("invalid_transition", "This contract can't be changed now.");
      }
      return contract;
    });
    if (!found) throw ApiError.notFound("That contract does not exist.");
    // The Kill Bill steps run before the commit; a failure changes nothing.
    try {
      await ensureSubscriptionCancelled(reg2, found);
    } catch (err) {
      if (err instanceof KillBillUnavailable) throw ApiError.unavailable("billing");
      throw err;
    }
    const result = await reg2.db.withTransaction(async (client) => {
      await lockContract(client, req.params.id);
      const fresh = await loadContract(client, req.params.id);
      if (!fresh || fresh.status !== "active") {
        throw ApiError.conflict("invalid_transition", "This contract can't be changed now.");
      }
      const now = reg2.clock.now();
      await client.query(
        "UPDATE contracts SET status = $2, closed_at = $3, subscription_state = 'cancelled' WHERE id = $1",
        [req.params.id, to, now]
      );
      await client.query(
        "UPDATE instruments SET status = $2, current_contract_id = NULL WHERE current_contract_id = $1",
        [req.params.id, to === "returned" ? "available" : "retired"]
      );
      await appendHistory(client, req.params.id, "active", to, now, "owner", user.name);
      const updated = (await loadContract(client, req.params.id))!;
      const equity = await equityOf(client, req.params.id);
      return { contract: await serializeContract(client, updated, storeToday(reg2.clock), equity) };
    });
    return { status: 200, body: result };
  }
}

function origin(reg: RouteRegistrar): string {
  return reg.config.publicUrl ?? `http://localhost:${reg.config.port}`;
}

function canSee(user: SessionUser, contract: Record<string, unknown>): boolean {
  if (user.role === "owner" || user.role === "tech") return true;
  if (user.role === "parent") return contract.family_id === user.family_id;
  return false;
}

export async function boundPriceList(
  client: PoolClient,
  contract: Record<string, unknown>,
  today: string
): Promise<PriceListRow> {
  if (contract.price_list_id) {
    const list = await priceListById(client, contract.price_list_id as string);
    if (!list) throw new Error("Bound price list missing");
    return list;
  }
  // Unsigned contracts show every term from the version in force today.
  const list = await priceListInForceOn(client, today);
  if (!list) throw new Error("No price list in force today");
  return list;
}

export async function quotesFor(
  client: PoolClient,
  contract: Record<string, unknown>,
  today: string
): Promise<unknown[]> {
  if (contract.status !== "signed" && contract.status !== "active") {
    throw ApiError.conflict("no_quote", "Quotes exist only on signed and active contracts.");
  }
  const list = await boundPriceList(client, contract, today);
  const item = itemFor(list, contract.instrument_type as never);
  const equity = await equityOf(client, contract.id as string);
  const inForce = await priceListInForceOn(client, today);
  const taxRateBp = inForce ? inForce.tax_rate_bp : 0;
  const baseRent = item.base_rent_cents || 1;
  const term = Math.ceil(item.purchase_price_cents / item.base_rent_cents);
  const quotes = [];
  for (let month = 0; month <= term; month++) {
    quotes.push(
      quoteForMonth(
        {
          contractId: contract.id as string,
          equity,
          contractMonth: Math.floor(equity / baseRent),
          item,
          tiers: list.tiers,
          taxRateBp,
          today,
        },
        month
      )
    );
  }
  return quotes;
}

// Kill Bill: the account and subscription are looked up by external key and
// reused; the subscription is cancelled and read back as CANCELLED.
export async function ensureSubscriptionCancelled(
  reg: RouteRegistrar,
  contract: Record<string, unknown>
): Promise<void> {
  const { account, contact } = await ensureAccountFor(reg, contract);
  void contact;
  const subKey = `${contract.id}-rental`;
  const subscription = await reg.killbill.ensureSubscription(account.accountId, subKey);
  await reg.killbill.cancelSubscriptionConfirmed(subscription.subscriptionId);
}

export async function ensureAccountFor(
  reg: RouteRegistrar,
  contract: Record<string, unknown>
): Promise<{ account: { accountId: string; paymentMethodId: string | null }; contact: { parent_name: string; email: string } | null }> {
  const contact = await reg.db.withTransaction((client) =>
    familyContact(client, contract.family_id as string)
  );
  const account = await reg.killbill.ensureAccount(
    contract.id as string,
    contact?.parent_name ?? "Bellroll family",
    contact?.email ?? "rentals@keelandbell.example"
  );
  return { account, contact };
}

export async function buildAgreementPdf(
  reg: RouteRegistrar,
  contract: Record<string, unknown>
): Promise<Uint8Array> {
  const today = storeToday(reg.clock);
  const data = await reg.db.withTransaction(async (client) => {
    const list = await boundPriceList(client, contract, today);
    const item = itemFor(list, contract.instrument_type as never);
    const family = await familyContact(client, contract.family_id as string);
    const student = await client.query<{ name: string }>("SELECT name FROM students WHERE id = $1", [
      contract.student_id,
    ]);
    const { agreementPdf } = await import("../services/pdfgen.js");
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
      fullName: family?.parent_name ?? "",
      signedAtText: formatStoreDateTime(new Date(contract.signed_at as string)),
    });
    return pdf;
  });
  return data;
}
