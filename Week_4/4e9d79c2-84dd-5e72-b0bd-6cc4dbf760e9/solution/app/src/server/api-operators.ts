import { nowSeconds, one, pool, rows, transaction, type Db, only } from "./db.js";
import { ApiError, conflict, MULTIPART_LIMIT, newId, newToken, noContent, notFound, moneyText, instantText, ok, refused, unavailable, route, type ApiRoute, type Ctx, type Untrusted } from "./http.js";
import { moveEnquiryState, parseBidPrice, rateInForce, requireHire, threeYearsBefore, depositFor, vehicleTotals } from "./domain.js";
import { directoryPage, getObject, ProviderDown, putObject, sendMail, deleteObject } from "./providers.js";
import { config } from "./config.js";
import { isRealDate, longDate, ukDate, ukTime } from "../shared/time.js";
import { localJson, stopsOf } from "./api-enquiries.js";
import { createRuns } from "./api-runs.js";
import type { HireRow, OperatorRow, PaperRow, OperatorView, BidAskRow, VehicleRow } from "./records.js";

export const MAIL_DOWN = "We could not send that mail. Try again.";
export const FILE_STORE_DOWN = "The file store is unavailable right now. Nothing was saved.";
const PAPER_NAMES: Record<string, string> = { operatorLicence: "Operator licence", publicLiabilityCover: "Public liability cover" };
export const paperName = (kind: string): string => PAPER_NAMES[kind];

export const operatorsOf = async (db: Db, deskId: string): Promise<OperatorView[]> => {
  const list = await rows<OperatorRow>(db, "SELECT * FROM operators WHERE desk_id=$1 ORDER BY id", [deskId]);
  const papers = await rows<PaperRow>(db, "SELECT * FROM papers WHERE desk_id=$1 ORDER BY kind", [deskId]);
  return list.map((o) => ({ ...o, paperRows: papers.filter((p) => p.operator_id === o.id) }));
};
const paperJson = (p: PaperRow): Record<string, unknown> => ({ kind: p.kind, endsOn: p.ends_on, stored: p.stored, objectKey: p.object_key });
const operatorJson = (o: OperatorView): Record<string, unknown> => ({
  id: o.id, name: o.name, town: o.town, email: o.email, telephone: o.telephone, sizes: o.sizes, listed: o.listed, papers: o.paperRows.map(paperJson), dbsCheckedOn: o.dbs_checked_on,
});

/** A hire's last day is the UK date of its return, otherwise of its latest departure. */
export const lastDayOf = async (db: Db, hire: HireRow): Promise<string> => {
  if (hire.return_instant) return ukDate(hire.return_instant);
  const vehicles = await rows<Pick<VehicleRow, "depart_instant">>(db, "SELECT depart_instant FROM vehicles WHERE hire_id=$1", [hire.id]);
  return ukDate(Math.max(hire.depart_instant, ...vehicles.map((v) => v.depart_instant)));
};
/** Why an operator is not `Clear` for a hire, the first that applies, or null. */
export const standingReason = (operator: OperatorView, hire: HireRow, lastDay: string): string | null => {
  if (!operator.listed) return "No longer listed";
  for (const kind of ["operatorLicence", "publicLiabilityCover"]) {
    const paper = operator.paperRows.find((p: PaperRow) => p.kind === kind);
    if (!paper) return `${paperName(kind)} is missing.`;
    if (paper.ends_on < lastDay) return `${paperName(kind)} ends ${longDate(paper.ends_on)}, before this hire's last day.`;
  }
  if (hire.occasion === "school") {
    if (!operator.dbs_checked_on) return "Driver DBS check is missing.";
    if (operator.dbs_checked_on < threeYearsBefore(lastDay)) return "Driver DBS check is older than three years on this hire's last day.";
  }
  return null;
};

const loadOperator = async (ctx: Ctx): Promise<OperatorView> => {
  const found = (await operatorsOf(pool, ctx.desk!.id)).find((o) => o.id === ctx.params.id);
  if (!found) throw notFound();
  return found;
};
const judgeBytes = (data: Buffer): string | null => {
  if (data.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  return null;
};
const refreshDirectory = async (deskId: string): Promise<void> => {
  const listed: Untrusted[] = [];
  let cursor: string | null = null;
  try {
    do {
      const page: Untrusted = await directoryPage(cursor);
      if (!Array.isArray(page?.operators)) throw new ProviderDown("directory");
      listed.push(...page.operators);
      cursor = page.nextCursor ?? null;
    } while (cursor);
  } catch (error) {
    if (error instanceof ProviderDown) throw unavailable("directoryUnavailable", "The directory could not be read. Your list has not changed.");
    throw error;
  }
  await transaction(async (tx) => {
    await tx.query("UPDATE operators SET listed=false WHERE desk_id=$1", [deskId]);
    for (const o of listed) {
      await tx.query(
        `INSERT INTO operators (desk_id,id,name,town,email,telephone,sizes,listed) VALUES ($1,$2,$3,$4,$5,$6,$7,true)
         ON CONFLICT (desk_id,id) DO UPDATE SET name=$3,town=$4,email=$5,telephone=$6,sizes=$7,listed=true`,
        [deskId, o.id, o.name, o.town, o.email, o.telephone, o.sizes],
      );
    }
  });
};

// ---- Bids.
const bidStatus = (ask: BidAskRow, hire: HireRow, now: number): "asked" | "open" | "withdrawn" | "closed" => {
  if (now > ask.closes_at || hire.awarded_at !== null) return "closed";
  if (ask.withdrawn) return "withdrawn";
  return ask.prices ? "open" : "asked";
};
export const awardedJson = async (db: Db, hire: HireRow): Promise<Record<string, unknown> | null> => {
  if (!hire.awarded_operator) return null;
  const operator = await one<Pick<OperatorRow, "name">>(db, "SELECT name FROM operators WHERE desk_id=$1 AND id=$2", [hire.desk_id, hire.awarded_operator]);
  return { operatorId: hire.awarded_operator, operatorName: operator?.name ?? hire.awarded_operator, at: instantText(hire.awarded_at) };
};
const alreadyAwarded = async (db: Db, hire: HireRow): Promise<ApiError> => {
  const a = await awardedJson(db, hire);
  return conflict("alreadyAwarded", `Already awarded to ${a?.operatorName} at ${ukTime(hire.awarded_at as number)}.`);
};
interface BidView { operatorId: string; operatorName: string; status: string; clear: boolean; reason: string | null; prices: string[]; total: string | null; receivedAt: string | null; closesAt: string | null; totalPennies: number | null; receivedSeconds: number | null }
export const bidRows = async (hire: HireRow, sort: string): Promise<BidView[]> => {
  const now = nowSeconds();
  const operators = await operatorsOf(pool, hire.desk_id);
  const asks = await rows<BidAskRow>(pool, "SELECT * FROM bid_asks WHERE hire_id=$1", [hire.id]);
  const lastDay = await lastDayOf(pool, hire);
  const list = asks.map((ask) => {
    const operator = operators.find((o) => o.id === ask.operator_id) as OperatorView;
    const live: number[] | null = ask.prices && !ask.withdrawn ? ask.prices : null;
    const reason = standingReason(operator, hire, lastDay);
    return {
      operatorId: ask.operator_id, operatorName: operator.name, status: bidStatus(ask, hire, now), clear: reason === null, reason,
      prices: live ? live.map(moneyText) : [], total: live ? moneyText(live.reduce((a, p) => a + p, 0)) : null,
      receivedAt: live ? instantText(ask.received_at) : null, closesAt: instantText(ask.closes_at),
      totalPennies: live ? live.reduce((a, p) => a + p, 0) : null, receivedSeconds: ask.received_at,
    };
  });
  const direction = sort === "priceHighest" ? -1 : 1;
  list.sort((a, b) => {
    if (a.totalPennies !== null && b.totalPennies !== null) return direction * (a.totalPennies - b.totalPennies) || (a.receivedSeconds as number) - (b.receivedSeconds as number);
    if (a.totalPennies !== null) return -1;
    if (b.totalPennies !== null) return 1;
    return a.operatorId < b.operatorId ? -1 : 1;
  });
  return list;
};
const bidRowJson = ({ operatorId, operatorName, status, clear, reason, prices, total, receivedAt, closesAt }: BidView): Record<string, unknown> =>
  ({ operatorId, operatorName, status, clear, reason, prices, total, receivedAt, closesAt });

export const hireSizes = (hire: HireRow): number[] => hire.plan_sizes ?? [];
const bidPageJson = async (ask: BidAskRow, hire: HireRow): Promise<Record<string, unknown>> => {
  const stops = await stopsOf(pool, hire.id);
  return {
    route: { stops: stops.map((s) => s.text) },
    dates: { departAt: localJson(hire.depart_date, hire.depart_time, hire.depart_repeated), returnAt: localJson(hire.return_date, hire.return_time, hire.return_repeated), departInstant: instantText(hire.depart_instant), returnInstant: instantText(hire.return_instant) },
    vehicles: hireSizes(hire).map((seats, i) => ({ index: i + 1, seats })),
    partySize: hire.party.people,
    closesAt: instantText(ask.closes_at),
    bid: ask.prices && !ask.withdrawn ? { prices: ask.prices.map(moneyText), receivedAt: instantText(ask.received_at) } : null,
  };
};
export const askByToken = async (db: Db, token: string, lock = false): Promise<{ ask: BidAskRow; hire: HireRow } | null> => {
  const ask = await one<BidAskRow>(db, `SELECT * FROM bid_asks WHERE token=$1${lock ? " FOR UPDATE" : ""}`, [token]);
  if (!ask) return null;
  return { ask, hire: await only<HireRow>(db, "SELECT * FROM hires WHERE id=$1", [ask.hire_id]) };
};
export const bidEnded = (ask: BidAskRow, hire: HireRow, now: number): boolean => now > ask.closes_at || hire.awarded_at !== null;
const closedCopy = (ask: BidAskRow, hire: HireRow): string => `Bids closed at ${ukTime(hire.awarded_at !== null && hire.awarded_at < ask.closes_at ? hire.awarded_at : ask.closes_at)}. Your price was not sent.`;
const bidsClosed = (ask: BidAskRow, hire: HireRow): ApiError => new ApiError(410, "bidsClosed", closedCopy(ask, hire));
const loadAsk = async (ctx: Ctx): Promise<{ ask: BidAskRow; hire: HireRow }> => {
  const found = await askByToken(pool, ctx.params.token);
  if (!found) throw notFound();
  return found;
};
const loadHire = (ctx: Ctx): Promise<HireRow> => requireHire(pool, ctx.desk!.id, ctx.params.id);
const routeLines = (stops: { text: string }[]): string => stops.map((s) => s.text).join("\n");

export const operatorRoutes: ApiRoute[] = [
  route({ method: "GET", path: "/api/operators", run: async ({ desk }) => ok({ operators: (await operatorsOf(pool, desk!.id)).map(operatorJson) }) }),
  route({
    method: "POST", path: "/api/operators/refresh", body: "json",
    run: async ({ desk }) => {
      await refreshDirectory(desk!.id);
      return ok({ operators: (await operatorsOf(pool, desk!.id)).map(operatorJson) });
    },
  }),
  route({
    method: "POST", path: "/api/operators/:id/papers", body: "multipart", limit: MULTIPART_LIMIT, load: loadOperator,
    run: async ({ form, files, desk, loaded }) => {
      if (!PAPER_NAMES[form.kind]) throw refused("Choose a paper.", "kind");
      if (!isRealDate(form.endsOn ?? "")) throw refused("Enter a date as DD/MM/YYYY.", "endsOn");
      const file = files.file;
      const judged = file ? judgeBytes(file.data) : null;
      if (!judged) throw refused("This file is not a PDF, JPEG or PNG.", "file");
      const key = `desks/${desk!.id}/operators/${loaded.id}/${form.kind}/${newId("PA")}`;
      try {
        await putObject(key, file.data, judged);
      } catch (error) {
        if (error instanceof ProviderDown) throw unavailable("fileStoreDown", FILE_STORE_DOWN);
        throw error;
      }
      const previous = loaded.paperRows.find((p: PaperRow) => p.kind === form.kind);
      const paper = await only<PaperRow>(pool,
        `INSERT INTO papers (desk_id,operator_id,kind,ends_on,stored,object_key,content_type) VALUES ($1,$2,$3,$4,true,$5,$6)
         ON CONFLICT (desk_id,operator_id,kind) DO UPDATE SET ends_on=$4,stored=true,object_key=$5,content_type=$6,expiry_mailed=false RETURNING *`,
        [desk!.id, loaded.id, form.kind, form.endsOn, key, judged]);
      if (previous?.object_key) await deleteObject(previous.object_key).catch(() => undefined);
      return ok(paperJson(paper), 201);
    },
  }),
  route({
    method: "GET", path: "/api/operators/:id/papers/:kind/file", load: loadOperator,
    run: async ({ params, loaded }) => {
      const paper = loaded.paperRows.find((p: PaperRow) => p.kind === params.kind);
      if (!paper?.stored) throw notFound();
      try {
        return { status: 200, raw: await getObject(paper.object_key as string), headers: { "Content-Type": paper.content_type as string } };
      } catch (error) {
        if (error instanceof ProviderDown) throw unavailable("fileStoreDown", FILE_STORE_DOWN);
        throw error;
      }
    },
  }),
  route({
    method: "PUT", path: "/api/operators/:id/dbs", body: "json", load: loadOperator,
    run: async ({ json, desk, loaded }) => {
      if (!isRealDate(json.checkedOn ?? "")) throw refused("Enter a date as DD/MM/YYYY.", "checkedOn");
      await pool.query("UPDATE operators SET dbs_checked_on=$3 WHERE desk_id=$1 AND id=$2", [desk!.id, loaded.id, json.checkedOn]);
      return ok(operatorJson({ ...loaded, dbs_checked_on: json.checkedOn }));
    },
  }),
  route({
    method: "GET", path: "/api/hires/:id/operators", load: loadHire,
    run: async ({ desk, loaded }) => {
      const lastDay = await lastDayOf(pool, loaded);
      return ok({
        operators: (await operatorsOf(pool, desk!.id)).map((o) => {
          const reason = standingReason(o, loaded, lastDay);
          return { id: o.id, name: o.name, clear: reason === null, reason };
        }),
      });
    },
  }),
  route({
    method: "POST", path: "/api/enquiries/:id/bids/ask", body: "json", load: loadHire,
    run: async ({ json, desk, loaded }) => {
      const ids: unknown[] = Array.isArray(json.operatorIds) ? json.operatorIds : [];
      const operators = await operatorsOf(pool, desk!.id);
      const chosen = ids.map((id) => {
        const found = operators.find((o) => o.id === id);
        if (!found) throw notFound();
        return found;
      });
      if (!chosen.length) throw refused("Choose at least one operator.", "operatorIds");
      if (!loaded.plan_sizes) throw conflict("noPlan", "Save a plan before asking operators.");
      if (loaded.awarded_at !== null) throw await alreadyAwarded(pool, loaded);
      const now = nowSeconds();
      const stops = await stopsOf(pool, loaded.id);
      const asks = [];
      for (const operator of chosen) {
        const made = await one<BidAskRow>(pool, "INSERT INTO bid_asks (token,desk_id,hire_id,operator_id,sent_at,closes_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (hire_id,operator_id) DO NOTHING RETURNING *",
          [newToken(), desk!.id, loaded.id, operator.id, now, now + config.bidWindow]);
        const ask = made ?? (await only<BidAskRow>(pool, "SELECT * FROM bid_asks WHERE hire_id=$1 AND operator_id=$2", [loaded.id, operator.id]));
        if (!ask.mailed) {
          await sendMail(operator.email, `Price request ${loaded.id}`,
            `Route:\n${routeLines(stops)}\n\nDates: ${longDate(loaded.depart_date)} ${loaded.depart_time}${loaded.return_date ? ` to ${longDate(loaded.return_date)} ${loaded.return_time}` : ""}\nVehicles: ${hireSizes(loaded).map((s) => `${s} seats`).join(", ")}\nParty size: ${loaded.party.people}\n\nPrice this hire: ${config.publicUrl}/b/${ask.token}\n`)
            .catch(() => { throw unavailable("mailDown", MAIL_DOWN); });
          await pool.query("UPDATE bid_asks SET mailed=true WHERE token=$1", [ask.token]);
        }
        asks.push({ operatorId: ask.operator_id, bidPath: `/b/${ask.token}`, sentAt: instantText(ask.sent_at), closesAt: instantText(ask.closes_at) });
      }
      return ok({ asks }, 201);
    },
  }),
  route({
    method: "GET", path: "/api/enquiries/:id/bids", load: loadHire,
    run: async ({ query, loaded }) => ok({ bids: (await bidRows(loaded, query.get("sort") ?? "priceLowest")).map(bidRowJson), awarded: await awardedJson(pool, loaded) }),
  }),
  route({
    method: "POST", path: "/api/enquiries/:id/award", body: "json", load: loadHire,
    run: async ({ json, desk, loaded }) => {
      const operators = await operatorsOf(pool, desk!.id);
      const operator = operators.find((o) => o.id === json.operatorId);
      if (typeof json.operatorId !== "string") throw refused("Choose an operator.", "operatorId");
      if (!operator) throw notFound();
      const { awarded, losers } = await transaction(async (tx) => {
        const hire = await requireHire(tx, desk!.id, loaded.id, true);
        if (hire.awarded_at !== null) throw await alreadyAwarded(tx, hire);
        const ask = await one<BidAskRow>(tx, "SELECT * FROM bid_asks WHERE hire_id=$1 AND operator_id=$2", [hire.id, operator.id]);
        if (!ask?.prices || ask.withdrawn || ask.prices.length !== hireSizes(hire).length) throw conflict("noBid", `${operator.name} has no price on this hire.`);
        const reason = standingReason(operator, hire, await lastDayOf(tx, hire));
        if (reason) throw conflict("operatorNotClear", reason);
        const now = nowSeconds();
        const rates = await rateInForce(tx, desk!.id, ukDate(now));
        for (const [position, seats] of hireSizes(hire).entries()) {
          const v = { seats, bought: ask.prices[position], margin_halves: rates.margin_halves, charges: 0 };
          await tx.query(
            "INSERT INTO vehicles (id,hire_id,position,seats,operator_id,bought,margin_halves,deposit,depart_date,depart_time,depart_repeated,depart_instant) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
            [newId("VH"), hire.id, position, seats, operator.id, v.bought, v.margin_halves, depositFor(seats, vehicleTotals(v).total, rates), hire.depart_date, hire.depart_time, hire.depart_repeated, hire.depart_instant],
          );
        }
        await tx.query("UPDATE hires SET awarded_operator=$2,awarded_at=$3,rate_table_id=$4 WHERE id=$1", [hire.id, operator.id, now, rates.id]);
        await createRuns(tx, desk!.id, hire.id);
        const others = (await rows<Pick<BidAskRow, "operator_id">>(tx, "SELECT operator_id FROM bid_asks WHERE hire_id=$1 AND operator_id<>$2", [hire.id, operator.id])).map((r) => r.operator_id);
        return { awarded: { operatorId: operator.id, operatorName: operator.name, at: instantText(now) }, losers: others };
      });
      for (const id of losers) {
        const loser = operators.find((o) => o.id === id) as OperatorView;
        await sendMail(loser.email, `Hire ${loaded.id} has closed`, `Hire ${loaded.id} has closed\n`).catch(() => undefined);
      }
      return ok({ awarded });
    },
  }),
  route({
    method: "GET", path: "/api/b/:token", access: "private",
    load: async (ctx) => {
      const found = await loadAsk(ctx);
      if (bidEnded(found.ask, found.hire, nowSeconds())) throw bidsClosed(found.ask, found.hire);
      return found;
    },
    run: async ({ loaded }) => ok(await bidPageJson(loaded.ask, loaded.hire)),
  }),
  route({
    method: "PUT", path: "/api/b/:token/bid", access: "private", body: "json",
    load: async (ctx) => {
      const found = await loadAsk(ctx);
      if (bidEnded(found.ask, found.hire, nowSeconds())) throw bidsClosed(found.ask, found.hire);
      return found;
    },
    run: async ({ json, params }) => {
      return transaction(async (tx) => {
        const { ask, hire } = (await askByToken(tx, params.token, true)) as { ask: BidAskRow; hire: HireRow };
        const now = nowSeconds();
        if (bidEnded(ask, hire, now)) throw bidsClosed(ask, hire);
        const typed: unknown[] = Array.isArray(json.prices) ? json.prices : [];
        const prices = typed.map(parseBidPrice);
        if (typed.length !== hireSizes(hire).length || prices.some((p) => p === null)) throw refused("Enter the price in pounds and pence.", "prices");
        await tx.query("UPDATE bid_asks SET prices=$2,received_at=$3,withdrawn=false WHERE token=$1", [ask.token, prices, now]);
        await moveEnquiryState(tx, hire.id, "priced");
        return ok({ bid: { prices: (prices as number[]).map(moneyText), receivedAt: instantText(now) } });
      });
    },
  }),
  route({
    method: "DELETE", path: "/api/b/:token/bid", access: "private",
    load: async (ctx) => {
      const found = await loadAsk(ctx);
      if (bidEnded(found.ask, found.hire, nowSeconds())) throw bidsClosed(found.ask, found.hire);
      return found;
    },
    run: async ({ params }) => transaction(async (tx) => {
      const { ask, hire } = (await askByToken(tx, params.token, true)) as { ask: BidAskRow; hire: HireRow };
      if (bidEnded(ask, hire, nowSeconds())) throw bidsClosed(ask, hire);
      if (!ask.prices || ask.withdrawn) throw conflict("noBid", "There is no price to withdraw.");
      await tx.query("UPDATE bid_asks SET withdrawn=true WHERE token=$1", [ask.token]);
      return noContent();
    }),
  }),
];
