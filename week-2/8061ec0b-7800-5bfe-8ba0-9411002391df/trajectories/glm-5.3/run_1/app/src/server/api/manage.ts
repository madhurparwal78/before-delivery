// Owner management endpoints: price lists, fleet intake, students, the
// parent's family surface, and reservations.
import type { ApiRequest, JsonResponseBody } from "../http/server.js";
import type { RouteRegistrar } from "./routes.js";
import { ApiError } from "../errors.js";
import {
  allPriceLists,
  priceListById,
  priceListInForceOn,
  validateNewPriceList,
  priceListStanding,
} from "../domain/priceLists.js";
import { serializePriceList } from "../serialize.js";
import { familyTotals } from "../domain/family.js";
import { nextDeliveryDay, schoolById } from "../domain/delivery.js";
import {
  INSTRUMENT_NAMES,
  SIZES_BY_TYPE,
  instrumentLabel,
  type InstrumentType,
  type Size,
} from "../../shared/domain.js";
import { requireUser, storeToday, withSweep } from "./helpers.js";
import { appendHistory } from "../domain/contractState.js";
import { serializeContract } from "../serialize.js";
import { randomToken } from "../auth.js";
import type { PoolClient } from "pg";

export function registerManageRoutes(reg: RouteRegistrar): void {
  reg.add("GET", "/api/price-lists/current", async (req: ApiRequest) => {
    await requireUser(reg.db, req.sessionToken);
    let on = req.query.get("on");
    if (on === null) {
      on = storeToday(reg.clock);
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(on)) {
      throw ApiError.validation({ on: "Use a date as YYYY-MM-DD." });
    }
    const result = await reg.db.withTransaction(async (client) => {
      const list = await priceListInForceOn(client, on!);
      if (!list) return null;
      return { price_list: serializePriceList(list) };
    });
    if (!result) throw ApiError.notFound("No price list is in force on that date.");
    return { status: 200, body: result } as JsonResponseBody;
  });

  reg.add("GET", "/api/price-lists", async (req: ApiRequest) => {
    await requireUser(reg.db, req.sessionToken, ["owner"]);
    const price_lists = await reg.db.withTransaction(async (client) => {
      const lists = await allPriceLists(client);
      const today = storeToday(reg.clock);
      const inForce = await priceListInForceOn(client, today);
      return lists.map((list) => ({
        ...serializePriceList(list),
        standing: priceListStanding(list, today, inForce?.id ?? null),
      }));
    });
    return { status: 200, body: { price_lists } } as JsonResponseBody;
  });

  reg.add("POST", "/api/price-lists", async (req: ApiRequest) => {
    await requireUser(reg.db, req.sessionToken, ["owner"]);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const today = storeToday(reg.clock);
    const effectiveDate = typeof body.effective_date === "string" ? body.effective_date : null;
    const taxRateBp = parseNumber(body.tax_rate_bp);
    const itemsInput = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : [];
    const tiersInput = Array.isArray(body.tiers) ? (body.tiers as Record<string, unknown>[]) : [];
    const parsedItems = (["flute", "clarinet", "trumpet", "violin", "cello"] as InstrumentType[]).map((type) => {
      const found = itemsInput.find((i) => i.instrument_type === type) ?? {};
      return {
        instrument_type: type,
        base_rent_cents: parseNumber(found.base_rent_cents),
        waiver_cents: parseNumber(found.waiver_cents),
        purchase_price_cents: parseNumber(found.purchase_price_cents),
      };
    });
    const parsedTiers = tiersInput.map((t) => ({
      from_month: parseNumber(t.from_month),
      to_month: parseNumber(t.to_month),
      percent: parseNumber(t.percent),
      name: typeof t.name === "string" ? t.name : null,
    }));
    const validation = validateNewPriceList(
      { effective_date: effectiveDate, tax_rate_bp: taxRateBp, items: parsedItems, tiers: parsedTiers },
      today
    );
    if (!validation.ok) {
      throw ApiError.validation(validation.fields);
    }
    const list = await reg.db.withTransaction(async (client) => {
      const id = `PL-${new Date().getUTCFullYear()}-${randomToken(3).toUpperCase()}`;
      const created = reg.clock.now();
      const tiers = parsedTiers.map((t) => ({
        from_month: t.from_month!,
        to_month: t.to_month,
        percent: t.percent!,
        name: t.name!.trim(),
      }));
      await client.query(
        `INSERT INTO price_lists (id, effective_date, tax_rate_bp, items, tiers, created_at, withdrawn_at)
         VALUES ($1,$2,$3,$4,$5,$6,NULL)`,
        [id, effectiveDate!, taxRateBp!, JSON.stringify(parsedItems), JSON.stringify(tiers), created]
      );
      const inserted = await priceListById(client, id);
      return inserted!;
    });
    return { status: 201, body: { price_list: serializePriceList(list) } } as JsonResponseBody;
  });

  reg.add("POST", "/api/price-lists/{id}/withdraw", async (req: ApiRequest) => {
    await requireUser(reg.db, req.sessionToken, ["owner"]);
    const today = storeToday(reg.clock);
    const result = await reg.db.withTransaction(async (client) => {
      const list = await priceListById(client, req.params.id);
      if (!list) return null;
      if (list.withdrawn_at) {
        throw ApiError.conflict("price_list_withdrawn", `${req.params.id} was already withdrawn.`);
      }
      if (list.effective_date <= today) {
        throw ApiError.conflict("price_list_in_force", `${req.params.id} is already in force and can't be withdrawn.`);
      }
      await client.query(
        "UPDATE price_lists SET withdrawn_at = $2 WHERE id = $1",
        [req.params.id, reg.clock.now()]
      );
      const fresh = await priceListById(client, req.params.id);
      return { price_list: serializePriceList(fresh!) };
    });
    if (!result) throw ApiError.notFound("That price list does not exist.");
    return { status: 200, body: result } as JsonResponseBody;
  });

  reg.add("GET", "/api/instruments", async (req: ApiRequest) => {
    await requireUser(reg.db, req.sessionToken, ["owner", "tech"]);
    const instruments = await withSweep(reg.db, reg.clock, async (client) => {
      const rows = await client.query<Record<string, unknown>>(
        `SELECT i.*, s.name AS school_name FROM instruments i
          LEFT JOIN contracts c ON c.id = i.current_contract_id
          LEFT JOIN schools s ON s.id = c.school_id
          ORDER BY i.serial ASC`
      );
      return rows.rows.map((r, idx) => ({
        index: idx + 1,
        serial: r.serial as string,
        instrument_type: r.instrument_type as string,
        size: r.size as string,
        model: r.model as string,
        label: instrumentLabel(r.instrument_type as never, r.size as never),
        status: r.status as string,
        contract_id: (r.current_contract_id as string | null) ?? null,
        school_name: (r.school_name as string | null) ?? null,
      }));
    });
    return { status: 200, body: { instruments } } as JsonResponseBody;
  });

  reg.add("POST", "/api/instruments", async (req: ApiRequest) => {
    await requireUser(reg.db, req.sessionToken, ["owner"]);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const fields: Record<string, string> = {};
    const serial = typeof body.serial === "string" ? body.serial.trim() : null;
    const instrumentType = typeof body.instrument_type === "string" ? body.instrument_type : null;
    const size = typeof body.size === "string" ? body.size : null;
    const model = typeof body.model === "string" ? body.model.trim() : null;
    if (serial === null || !/^[A-Z0-9-]{3,20}$/.test(serial)) {
      fields.serial = "Use 3 to 20 capital letters, digits and hyphens.";
    }
    if (instrumentType === null || !(instrumentType in INSTRUMENT_NAMES)) {
      fields.instrument_type = "Choose flute, clarinet, trumpet, violin or cello.";
    }
    if (
      instrumentType !== null && instrumentType in INSTRUMENT_NAMES
        ? size === null || !SIZES_BY_TYPE[instrumentType as InstrumentType].includes(size as Size)
        : size === null
    ) {
      fields.size = "Choose a size made for that instrument.";
    }
    if (model === null || model.length < 1 || model.length > 80) {
      fields.model = "Use 1 to 80 characters.";
    }
    if (Object.keys(fields).length > 0) {
      throw ApiError.validation(fields);
    }
    const result = await reg.db.withTransaction(async (client) => {
      const existing = await client.query("SELECT id FROM instruments WHERE serial = $1", [serial]);
      if (existing.rows.length > 0) {
        throw ApiError.conflict("serial_taken", `Serial ${serial} is already in the fleet.`);
      }
      const id = `I-${randomToken(8)}`;
      await client.query(
        `INSERT INTO instruments (id, serial, instrument_type, size, model, status, current_contract_id)
         VALUES ($1,$2,$3,$4,$5,'available',NULL)`,
        [id, serial, instrumentType, size, model]
      );
      return {
        instrument: {
          index: null as unknown as number,
          serial,
          instrument_type: instrumentType,
          size,
          model,
          label: instrumentLabel(instrumentType as never, size as never),
          status: "available",
          contract_id: null,
          school_name: null,
        },
      };
    });
    return { status: 201, body: result } as JsonResponseBody;
  });

  reg.add("GET", "/api/families", async (req: ApiRequest) => {
    await requireUser(reg.db, req.sessionToken, ["owner"]);
    const families = await reg.db.withTransaction(async (client) => {
      const rows = await client.query<Record<string, unknown>>("SELECT * FROM families ORDER BY id");
      const out = [];
      for (const family of rows.rows) {
        const students = await client.query<Record<string, unknown>>(
          "SELECT id, name, grade, school_id FROM students WHERE family_id = $1 ORDER BY name",
          [family.id]
        );
        out.push({
          id: family.id as string,
          parent_name: family.parent_name as string,
          email: family.email as string,
          phone: family.phone as string,
          address: family.address as string,
          students: students.rows.map((s) => ({
            id: s.id as string,
            name: s.name as string,
            grade: Number(s.grade),
            school_id: s.school_id as string,
          })),
        });
      }
      return out;
    });
    return { status: 200, body: { families } } as JsonResponseBody;
  });

  reg.add("POST", "/api/students", async (req: ApiRequest) => {
    await requireUser(reg.db, req.sessionToken, ["owner"]);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const fields: Record<string, string> = {};
    const familyId = typeof body.family_id === "string" ? body.family_id : null;
    const schoolId = typeof body.school_id === "string" ? body.school_id : null;
    const name = typeof body.name === "string" ? body.name.trim() : null;
    const grade = parseNumber(body.grade);
    if (Object.keys(fields).length === 0) {
      if (name === null || name.length < 1 || name.length > 80) {
        fields.name = "Use 1 to 80 characters.";
      }
      if (grade === null || !Number.isInteger(grade) || grade < 0 || grade > 12) {
        fields.grade = "Choose a whole grade from 0 to 12.";
      }
    }
    const result = await reg.db.withTransaction(async (client) => {
      const family = familyId ? await client.query("SELECT id FROM families WHERE id = $1", [familyId]) : { rows: [] };
      if (family.rows.length === 0) {
        fields.family_id = "Choose one of the families.";
      }
      const school = schoolId ? await client.query("SELECT id FROM schools WHERE id = $1", [schoolId]) : { rows: [] };
      if (school.rows.length === 0) {
        fields.school_id = "Choose one of the schools.";
      }
      if (name === null || name.length < 1 || name.length > 80) {
        fields.name = "Use 1 to 80 characters.";
      }
      if (grade === null || !Number.isInteger(grade) || grade < 0 || grade > 12) {
        fields.grade = "Choose a whole grade from 0 to 12.";
      }
      if (Object.keys(fields).length > 0) {
        throw ApiError.validation(fields);
      }
      const id = `S-${randomToken(6).toUpperCase()}`;
      await client.query(
        "INSERT INTO students (id, name, grade, school_id, family_id) VALUES ($1,$2,$3,$4,$5)",
        [id, name, grade, schoolId, familyId]
      );
      return {
        student: {
          id,
          name,
          grade,
          school_id: schoolId,
          family_id: familyId,
        },
      };
    });
    return { status: 201, body: result } as JsonResponseBody;
  });

  reg.add("GET", "/api/family", async (req: ApiRequest) => {
    const user = await requireUser(reg.db, req.sessionToken, ["parent"]);
    const result = await withSweep(reg.db, reg.clock, async (client) => {
      const familyRows = await client.query<Record<string, unknown>>(
        "SELECT * FROM families WHERE id = $1",
        [user.family_id]
      );
      const family = familyRows.rows[0];
      const totals = await familyTotals(client, user.family_id!);
      const studentRows = await client.query<Record<string, unknown>>(
        `SELECT s.*, sc.name AS school_name FROM students s
           JOIN schools sc ON sc.id = s.school_id
          WHERE s.family_id = $1 ORDER BY s.name`,
        [user.family_id]
      );
      const students = [];
      for (const student of studentRows.rows) {
        const contracts = await client.query<Record<string, unknown>>(
          `SELECT c.id, c.status, c.delivery_date, i.serial, i.instrument_type, i.size,
                  (SELECT COALESCE(SUM(le.amount_cents), 0) FROM ledger_entries le WHERE le.contract_id = c.id) AS equity,
                  s2.name AS student_name
             FROM contracts c
             JOIN instruments i ON i.id = c.instrument_id
             JOIN students s2 ON s2.id = c.student_id
            WHERE c.student_id = $1 AND c.status <> 'expired'
            ORDER BY c.created_seq DESC`,
          [student.id]
        );
        students.push({
          id: student.id as string,
          name: student.name as string,
          grade: Number(student.grade),
          school: {
            id: student.school_id as string,
            name: student.school_name as string,
          },
          contracts: contracts.rows.map((c) => ({
            id: c.id as string,
            status: c.status as string,
            student_name: c.student_name as string,
            instrument_label: instrumentLabel(c.instrument_type as never, c.size as never),
            serial: c.serial as string,
            equity_cents: Number(c.equity),
            delivery_date: c.delivery_date as string,
          })),
        });
      }
      return {
        family: {
          id: family.id as string,
          parent_name: family.parent_name as string,
          email: family.email as string,
        },
        totals,
        students,
      };
    });
    return { status: 200, body: result } as JsonResponseBody;
  });

  reg.add("POST", "/api/reservations", async (req: ApiRequest) => {
    const user = await requireUser(reg.db, req.sessionToken, ["parent"]);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const studentId = typeof body.student_id === "string" ? body.student_id : null;
    const instrumentType = typeof body.instrument_type === "string" ? body.instrument_type : null;
    const size = typeof body.size === "string" ? body.size : null;
    const waiver = body.waiver === true;
    const result = await withSweep(reg.db, reg.clock, async (client) => {
      // 1. The student must belong to the caller's family.
      const student = studentId
        ? await client.query<Record<string, unknown>>("SELECT * FROM students WHERE id = $1", [studentId])
        : null;
      if (!student || student.rows.length === 0 || student.rows[0].family_id !== user.family_id) {
        throw ApiError.notFound("That student does not exist.");
      }
      // 2. The student must have no open contract.
      const openContract = await client.query(
        `SELECT id FROM contracts
          WHERE student_id = $1 AND status IN ('reserved','agreement_sent','signed','active')`,
        [studentId]
      );
      if (openContract.rows.length > 0) {
        throw ApiError.conflict("student_has_instrument", "That student already has an instrument on contract.");
      }
      // 3. Type, size and waiver must be valid.
      const fields: Record<string, string> = {};
      if (instrumentType === null || !(instrumentType in INSTRUMENT_NAMES)) {
        fields.instrument_type = "Choose an instrument.";
      }
      if (
        instrumentType !== null && instrumentType in INSTRUMENT_NAMES
          ? size === null || !SIZES_BY_TYPE[instrumentType as InstrumentType].includes(size as Size)
          : size === null
      ) {
        fields.size = "Choose a size made for that instrument.";
      }
      if (typeof body.waiver !== "boolean") {
        fields.waiver = "Choose whether to add the maintenance and damage waiver.";
      }
      if (Object.keys(fields).length > 0) {
        throw ApiError.validation(fields);
      }
      // 4. Availability, with alternatives on failure.
      const unit = await claimAvailableInstrument(client, instrumentType as InstrumentType, size as Size);
      if (!unit) {
        const alternatives = await availableAlternatives(client, instrumentType as InstrumentType);
        throw ApiError.conflict("unavailable", "No longer available", { alternatives });
      }
      const now = reg.clock.now();
      const numericIdRows = await client.query<{ nextval: string }>("SELECT nextval('contract_id_seq') AS nextval");
      const numericId = Number(numericIdRows.rows[0].nextval);
      const contractId = `C-${numericId}`;
      const school = await schoolById(client, student.rows[0].school_id as string);
      const delivery = nextDeliveryDay(school!, now);
      const holdExpires = new Date(now.getTime() + reg.config.reservationHoldSeconds * 1000);
      await client.query(
        `INSERT INTO contracts (id, numeric_id, student_id, family_id, school_id, instrument_id, waiver, status,
          price_list_id, delivery_date, hold_expires_at, created_at, created_seq)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'reserved',NULL,$8,$9,$10,$11)`,
        [
          contractId,
          numericId,
          studentId,
          user.family_id,
          student.rows[0].school_id,
          unit.id,
          waiver,
          delivery.date,
          holdExpires,
          now,
          numericId,
        ]
      );
      await client.query(
        "UPDATE instruments SET status = 'on_contract', current_contract_id = $1 WHERE id = $2",
        [contractId, unit.id]
      );
      await appendHistory(client, contractId, null, "reserved", now, "parent", user.name);
      const contract = await loadContractWithInstrument(client, contractId);
      return {
        contract: await serializeContract(client, contract, storeToday(reg.clock), 0),
      };
    });
    return { status: 201, body: result } as JsonResponseBody;
  });
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

async function claimAvailableInstrument(
  client: PoolClient,
  type: InstrumentType,
  size: Size
): Promise<{ id: string; serial: string } | null> {
  const rows = await client.query<{ id: string; serial: string }>(
    `UPDATE instruments SET status = 'on_contract'
      WHERE id IN (
        SELECT id FROM instruments
         WHERE instrument_type = $1 AND size = $2 AND status = 'available'
         ORDER BY serial ASC
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, serial`,
    [type, size]
  );
  return rows.rows.length > 0 ? rows.rows[0] : null;
}

async function availableAlternatives(
  client: PoolClient,
  type: InstrumentType
): Promise<{ instrument_type: string; size: string; available: number }[]> {
  const rows = await client.query<Record<string, unknown>>(
    "SELECT size, COUNT(*) AS n FROM instruments WHERE instrument_type = $1 AND status = 'available' GROUP BY size",
    [type]
  );
  const counts = new Map<string, number>();
  for (const row of rows.rows) counts.set(row.size as string, Number(row.n));
  return SIZES_BY_TYPE[type]
    .filter((size) => (counts.get(size) ?? 0) > 0)
    .map((size) => ({ instrument_type: type, size, available: counts.get(size)! }));
}

async function loadContractWithInstrument(
  client: PoolClient,
  id: string
): Promise<Record<string, unknown>> {
  const rows = await client.query<Record<string, unknown>>(
    `SELECT c.*, i.serial, i.instrument_type, i.size, i.model
       FROM contracts c JOIN instruments i ON i.id = c.instrument_id
      WHERE c.id = $1`,
    [id]
  );
  return rows.rows[0];
}
