import type { BoardQueue, BoardQueueEntry, Grant, VestingType } from "../../../shared/types.js";
import { formatDate } from "../../../shared/format.js";
import { db, type QueryParam, type Transaction } from "../../db.js";
import { addMonthsClamped, compareYmd, formatYmd, parseYmd, serverDate } from "../../domain/dates.js";
import { formatPrice, parseDecimal } from "../../domain/money.js";
import { config } from "../../config.js";
import { nextGrantId } from "../../ids.js";
import { writeWithEvents } from "../../live/events.js";
import { buildGrant, grantContext, GRANT_COLUMNS, loadGrantRowForUpdate, type GrantRow } from "../../model/grants.js";
import { boardSize, loadPerson, quorumFor, type PersonRow } from "../../model/people.js";
import { loadRegisterTotals } from "../../model/register.js";
import { loadValuations } from "../../model/valuations.js";
import { grantAgreementText, recordPendingDocument, sealDocument } from "../../services/documents.js";
import { VaultUnavailableError } from "../../services/vault.js";
import { grantAudience } from "../../flows/audiences.js";
import { expireOffer } from "../../flows/offers.js";
import { withLock } from "../../flows/exercise.js";
import { emitCapTable, writeLedgerEntry } from "../../flows/ledger.js";
import { conflict, forbidden, notFound, unavailable, validation } from "../errors.js";
import { field, isPresent, readCount, readDate, readPrice, readText } from "../fields.js";
import { json, requirePerson, requireRole, type Handler } from "../context.js";
import { route, type Route } from "../router.js";

async function requireCurrentValuation(tx: Transaction, now: Date): Promise<bigint> {
  const valuations = await loadValuations(tx, serverDate(now));
  if (valuations.currentId === null || valuations.fmvPerShare === null) {
    const message =
      valuations.lapsedExpiresOn === null
        ? "Record a valuation before issuing grants."
        : `The current valuation lapsed on ${formatDate(valuations.lapsedExpiresOn)}. Record a new valuation before issuing grants.`;
    throw conflict("valuation_lapsed", message);
  }
  return valuations.fmvPerShare;
}

async function grantFor(id: string, person: PersonRow): Promise<GrantRow> {
  const row = await db.queryOne<GrantRow>(`select ${GRANT_COLUMNS} from grants where id = $1`, [id]);
  if (row === null) throw notFound();
  if (person.role !== "founder_admin" && row.holder_id !== person.id) throw notFound();
  return row;
}

export async function grantResponse(row: GrantRow, now: Date): Promise<Grant> {
  const context = await grantContext(db, now);
  return buildGrant(row, context);
}

async function draftFields(
  tx: Transaction,
  body: unknown,
  now: Date,
): Promise<DraftPatch> {
  const fields: Record<string, string> = {};
  const patch: DraftPatch = {};

  const holderValue = field(body, "holder_id");
  if (isPresent(holderValue)) {
    const holderId = readText(holderValue);
    const holder = holderId === null ? null : await loadPerson(tx, holderId);
    if (holderId === null) fields["holder_id"] = "Choose an option holder.";
    else if (holder === null) throw notFound();
    else if (holder.role !== "option_holder") fields["holder_id"] = "Choose an option holder.";
    else patch.holder_id = holder.id;
  } else if (holderValue === null) patch.holder_id = null;

  const optionsValue = field(body, "options");
  if (isPresent(optionsValue)) {
    const options = readCount(optionsValue);
    if (options === null) fields["options"] = "Enter a whole number of options from 1 upward.";
    else patch.options = options;
  } else if (optionsValue === null) patch.options = null;

  const strikeValue = field(body, "strike");
  if (isPresent(strikeValue)) {
    const strike = readPrice(strikeValue);
    if (strike === null) fields["strike"] = "Enter a price above $0.0000 with up to four decimals.";
    else patch.strike = formatPrice(strike);
  } else if (strikeValue === null) patch.strike = null;

  const typeValue = field(body, "vesting_type");
  if (isPresent(typeValue)) {
    const vestingType = readText(typeValue);
    if (vestingType !== "standard" && vestingType !== "monthly") fields["vesting_type"] = "Choose a vesting type.";
    else patch.vesting_type = vestingType;
  } else if (typeValue === null) patch.vesting_type = null;

  const startValue = field(body, "vesting_start");
  if (isPresent(startValue)) {
    const start = readDate(startValue);
    if (start === null || !withinVestingRange(start, now)) fields["vesting_start"] = "Enter the vesting start as YYYY-MM-DD.";
    else patch.vesting_start = start;
  } else if (startValue === null) patch.vesting_start = null;

  if (Object.keys(fields).length > 0) throw validation(fields);
  return patch;
}

function withinVestingRange(start: string, now: Date): boolean {
  const today = parseYmd(serverDate(now));
  if (today === null) return false;
  const latest = formatYmd(addMonthsClamped(today, 12));
  return compareYmd(start, "2015-01-01") >= 0 && compareYmd(start, latest) <= 0;
}

const listGrants: Handler = async (context) => {
  const person = requirePerson(context);
  if (person.role === "investor" || person.role === "board_member") throw forbidden();
  const rows =
    person.role === "founder_admin"
      ? await db.query<GrantRow>(`select ${GRANT_COLUMNS} from grants order by seq`)
      : await db.query<GrantRow>(`select ${GRANT_COLUMNS} from grants where holder_id = $1 order by seq`, [person.id]);
  const grantsContext = await grantContext(db, context.now);
  return json({ grants: rows.map((row) => buildGrant(row, grantsContext)) });
};

const createGrant: Handler = async (context) => {
  requireRole(context, "founder_admin");
  return writeWithEvents(async (tx, emit) => {
    await requireCurrentValuation(tx, context.now);
    const id = await nextGrantId(tx);
    const rows = await tx.query<GrantRow>(
      `insert into grants (id, state) values ($1, 'draft') returning ${GRANT_COLUMNS}`,
      [id],
    );
    const created = rows[0];
    if (created === undefined) throw new Error("the grant draft was not written");
    const patch = await draftFields(tx, context.body, context.now);
    const updated = await applyPatch(tx, id, patch, created.draft_version);
    await emit("grant_changed", { grant_id: id, state: "draft", reason: "created" }, grantAudience(null));
    return json(await grantResponse(updated, context.now), 201);
  });
};

type DraftPatch = Partial<Pick<GrantRow, "holder_id" | "options" | "strike" | "vesting_type" | "vesting_start">>;

async function applyPatch(tx: Transaction, id: string, patch: DraftPatch, version: number): Promise<GrantRow> {
  const assignments: string[] = ["draft_version = $2"];
  const params: QueryParam[] = [id, version];
  for (const column of ["holder_id", "options", "strike", "vesting_type", "vesting_start"] as const) {
    if (!(column in patch)) continue;
    params.push(patch[column] ?? null);
    assignments.push(`${column} = $${params.length}`);
  }
  const rows = await tx.query<GrantRow>(
    `update grants set ${assignments.join(", ")} where id = $1 returning ${GRANT_COLUMNS}`,
    params,
  );
  const row = rows[0];
  if (row === undefined) throw new Error("the grant draft was not written");
  return row;
}

const readGrant: Handler = async (context) => {
  const person = requirePerson(context);
  if (person.role === "investor" || person.role === "board_member") throw notFound();
  const row = await grantFor(context.params["id"] ?? "", person);
  return json(await grantResponse(row, context.now));
};

const patchGrant: Handler = async (context) => {
  requireRole(context, "founder_admin");
  const id = context.params["id"] ?? "";
  return writeWithEvents(async (tx, emit) => {
    const row = await loadGrantRowForUpdate(tx, id);
    if (row === null) throw notFound();
    if (row.state !== "draft") throw conflict("grant_not_draft", "This grant is no longer a draft.");
    const versionValue = field(context.body, "draft_version");
    if (isPresent(versionValue)) {
      const version = readCount(versionValue);
      if (version === null) throw validation({ draft_version: "Enter the draft version as a whole number." });
      if (version !== row.draft_version) {
        throw conflict("draft_outdated", "This draft changed in another tab. The latest version is shown.", {
          grant: await grantResponse(row, context.now),
        });
      }
    }
    const patch = await draftFields(tx, context.body, context.now);
    const updated = await applyPatch(tx, id, patch, row.draft_version + 1);
    await emit(
      "grant_changed",
      { grant_id: id, state: "draft", reason: "draft_saved", draft_version: updated.draft_version },
      grantAudience(null),
    );
    return json(await grantResponse(updated, context.now));
  });
};

const deleteGrant: Handler = async (context) => {
  requireRole(context, "founder_admin");
  const id = context.params["id"] ?? "";
  return writeWithEvents(async (tx, emit) => {
    const row = await loadGrantRowForUpdate(tx, id);
    if (row === null) throw notFound();
    if (row.state !== "draft") throw conflict("grant_not_draft", "This grant is no longer a draft.");
    await tx.query("delete from grants where id = $1", [id]);
    await emit("grant_changed", { grant_id: id, state: "deleted", reason: "deleted" }, grantAudience(null));
    return { status: 204 };
  });
};

const submitGrant: Handler = async (context) => {
  requireRole(context, "founder_admin");
  const id = context.params["id"] ?? "";
  return writeWithEvents(async (tx, emit) => {
    const row = await loadGrantRowForUpdate(tx, id);
    if (row === null) throw notFound();
    if (row.state !== "draft") throw conflict("grant_not_draft", "This grant is no longer a draft.");
    const fmv = await requireCurrentValuation(tx, context.now);
    const totals = await loadRegisterTotals(tx);
    if (totals.pool.available <= 0) throw conflict("pool_exhausted", "The option pool has nothing available.");

    const fields: Record<string, string> = {};
    if (row.holder_id === null) fields["holder_id"] = "Choose an option holder.";
    if (row.options === null || row.options < 1 || row.options > totals.pool.available) {
      fields["options"] = `Enter a whole number of options from 1 to ${totals.pool.available}.`;
    }
    const strike = row.strike === null ? null : parseDecimal(row.strike, 4);
    if (strike === null || strike < fmv) {
      fields["strike"] = `Strike must be at least the current fair market value of $${formatPrice(fmv)}.`;
    }
    if (row.vesting_type === null) fields["vesting_type"] = "Choose a vesting type.";
    if (row.vesting_start === null) fields["vesting_start"] = "Enter the vesting start as YYYY-MM-DD.";
    if (Object.keys(fields).length > 0) throw validation(fields);

    await tx.query("delete from grant_votes where grant_id = $1", [id]);
    const rows = await tx.query<GrantRow>(
      `update grants set state = 'board_queue' where id = $1 returning ${GRANT_COLUMNS}`,
      [id],
    );
    const updated = rows[0];
    if (updated === undefined) throw new Error("the grant was not written");
    await emit(
      "grant_changed",
      { grant_id: id, state: "board_queue", reason: "submitted", holder_id: row.holder_id, options: row.options },
      grantAudience(row.holder_id, true),
    );
    await emitCapTable(emit);
    return json(await grantResponse(updated, context.now));
  });
};

const offerGrant: Handler = async (context) => {
  requireRole(context, "founder_admin");
  const id = context.params["id"] ?? "";
  return writeWithEvents(async (tx, emit) => {
    const row = await loadGrantRowForUpdate(tx, id);
    if (row === null) throw notFound();
    if (row.state !== "approved") throw conflict("grant_not_approved", "This grant has not been approved by the board.");
    const fmv = await requireCurrentValuation(tx, context.now);
    const strike = row.strike === null ? null : parseDecimal(row.strike, 4);
    if (strike === null || strike < fmv) {
      throw conflict("strike_below_fmv", `Strike must be at least the current fair market value of $${formatPrice(fmv)}.`);
    }
    const expiresAt = new Date(context.now.getTime() + config.offerWindowSeconds * 1000);
    const warningAt = new Date(expiresAt.getTime() - config.offerWarningSeconds * 1000);
    const rows = await tx.query<GrantRow>(
      `update grants set state = 'offered', offered_at = $2, offer_expires_at = $3, offer_warning_at = $4,
                         warning_sent = false
        where id = $1 returning ${GRANT_COLUMNS}`,
      [id, context.now, expiresAt, warningAt],
    );
    const updated = rows[0];
    if (updated === undefined) throw new Error("the grant was not written");
    await emit(
      "grant_changed",
      {
        grant_id: id,
        state: "offered",
        reason: "offered",
        holder_id: row.holder_id,
        options: row.options,
        offer_expires_at: expiresAt.toISOString(),
      },
      grantAudience(row.holder_id, true),
    );
    return json(await grantResponse(updated, context.now));
  });
};

const acceptGrant: Handler = async (context) => {
  const person = requirePerson(context);
  const id = context.params["id"] ?? "";
  return withLock(`grant:${id}`, async () => {
    const prepared = await writeWithEvents(async (tx, emit) => {
      const row = await loadGrantRowForUpdate(tx, id);
      if (row === null) throw notFound();
      if (row.holder_id !== person.id && person.role !== "founder_admin") throw notFound();
      if (row.holder_id !== person.id) throw forbidden();
      if (row.state !== "offered") throw conflict("grant_not_offered", "This grant is not on offer.");
      if (row.offer_expires_at !== null && context.now.getTime() >= row.offer_expires_at.getTime()) {
        await expireOffer(tx, emit, row);
        throw conflict("offer_expired", `The offer for grant ${id} has expired.`);
      }
      if (row.options === null || row.strike === null || row.vesting_type === null || row.vesting_start === null) {
        throw conflict("grant_not_offered", "This grant is not on offer.");
      }
      const document = await recordPendingDocument(tx, row.agreement_document_id, {
        kind: "grant_agreement",
        title: `Grant agreement ${row.id}`,
        ownerId: person.id,
        vaultKey: `grant-agreements/${row.id}.txt`,
        grantId: row.id,
        body: grantAgreementText({
          grantId: row.id,
          holderName: person.name,
          options: row.options,
          strike: row.strike,
          vestingType: row.vesting_type,
          vestingStart: row.vesting_start,
          signedAt: context.now.toISOString(),
        }),
      });
      await tx.query("update grants set agreement_status = 'pending', agreement_document_id = $2 where id = $1", [
        row.id,
        document.id,
      ]);
      return { row, document };
    });

    try {
      return await writeWithEvents(async (tx, emit) => {
        await sealDocument(tx, prepared.document);
        const rows = await tx.query<GrantRow>(
          `update grants set state = 'accepted', accepted_at = $2, agreement_status = 'sealed'
            where id = $1 returning ${GRANT_COLUMNS}`,
          [id, context.now],
        );
        const updated = rows[0];
        if (updated === undefined) throw new Error("the grant was not written");
        await writeLedgerEntry(tx, {
          at: context.now,
          holderId: person.id,
          kind: "grant_accepted",
          optionsDelta: prepared.row.options ?? 0,
          reference: id,
        });
        await emit(
          "grant_changed",
          { grant_id: id, state: "accepted", reason: "accepted", holder_id: person.id, options: prepared.row.options },
          grantAudience(person.id, true),
        );
        await emitCapTable(emit);
        return json(await grantResponse(updated, context.now));
      });
    } catch (error) {
      if (!(error instanceof VaultUnavailableError)) throw error;
      const row = await db.queryOne<GrantRow>(`select ${GRANT_COLUMNS} from grants where id = $1`, [id]);
      if (row === null) throw notFound();
      throw unavailable(
        "vault_unavailable",
        `The document vault can't be reached. Your signature is pending and grant ${id} is not yet accepted.`,
        { grant: await grantResponse(row, context.now) },
      );
    }
  });
};

const declineGrant: Handler = async (context) => {
  const person = requirePerson(context);
  const id = context.params["id"] ?? "";
  return writeWithEvents(async (tx, emit) => {
    const row = await loadGrantRowForUpdate(tx, id);
    if (row === null) throw notFound();
    if (row.holder_id !== person.id && person.role !== "founder_admin") throw notFound();
    if (row.holder_id !== person.id) throw forbidden();
    if (row.state !== "offered") throw conflict("grant_not_offered", "This grant is not on offer.");
    if (row.offer_expires_at !== null && context.now.getTime() >= row.offer_expires_at.getTime()) {
      await expireOffer(tx, emit, row);
      throw conflict("offer_expired", `The offer for grant ${id} has expired.`);
    }
    await tx.query("delete from grant_votes where grant_id = $1", [id]);
    const rows = await tx.query<GrantRow>(
      `update grants set state = 'board_queue', offered_at = null, offer_expires_at = null,
                         offer_warning_at = null, warning_sent = false
        where id = $1 returning ${GRANT_COLUMNS}`,
      [id],
    );
    const updated = rows[0];
    if (updated === undefined) throw new Error("the grant was not written");
    await emit(
      "grant_changed",
      { grant_id: id, state: "board_queue", reason: "declined", holder_id: person.id, options: row.options },
      grantAudience(person.id, true),
    );
    return json(await grantResponse(updated, context.now));
  });
};

interface QueueRow extends GrantRow {
  holder_name: string | null;
  approvals: number;
  declines: number;
  my_vote: "approve" | "decline" | null;
}

async function queueFor(tx: Transaction, personId: string): Promise<BoardQueue> {
  const rows = await tx.query<QueueRow>(
    `select ${GRANT_COLUMNS.split(",")
      .map((column) => `g.${column.trim()}`)
      .join(", ")},
            p.name as holder_name,
            (select count(*)::int from grant_votes v where v.grant_id = g.id and v.vote = 'approve') as approvals,
            (select count(*)::int from grant_votes v where v.grant_id = g.id and v.vote = 'decline') as declines,
            (select v.vote from grant_votes v where v.grant_id = g.id and v.person_id = $1) as my_vote
       from grants g left join people p on p.id = g.holder_id
      where g.state = 'board_queue'
      order by g.seq`,
    [personId],
  );
  const members = await boardSize(tx);
  const grants: BoardQueueEntry[] = rows.map((row) => ({
    id: row.id,
    holder_name: row.holder_name ?? "",
    options: row.options ?? 0,
    strike: row.strike ?? "0.0000",
    vesting_type: (row.vesting_type ?? "standard") as VestingType,
    vesting_start: row.vesting_start ?? "",
    approvals: row.approvals,
    declines: row.declines,
    my_vote: row.my_vote,
  }));
  return { quorum: quorumFor(members), board_size: members, grants };
}

const boardQueue: Handler = async (context) => {
  const person = requireRole(context, "board_member", "founder_admin");
  return json(await queueFor(db, person.id));
};

const castVote: Handler = async (context) => {
  const person = requireRole(context, "board_member");
  const id = context.params["id"] ?? "";
  const vote = readText(field(context.body, "vote"));
  return writeWithEvents(async (tx, emit) => {
    const row = await loadGrantRowForUpdate(tx, id);
    if (row === null) throw notFound();
    if (row.state !== "board_queue") throw conflict("grant_not_in_queue", "This grant is not waiting for a vote.");
    const existing = await tx.queryOne<{ vote: string }>(
      "select vote from grant_votes where grant_id = $1 and person_id = $2",
      [id, person.id],
    );
    if (existing !== null) throw conflict("already_voted", `You have already voted on ${id}.`);
    if (vote !== "approve" && vote !== "decline") throw validation({ vote: "Choose approve or decline." });
    await tx.query("insert into grant_votes (grant_id, person_id, vote) values ($1, $2, $3)", [id, person.id, vote]);

    const members = await boardSize(tx);
    const quorum = quorumFor(members);
    const counts = await tx.queryOne<{ approvals: number; declines: number }>(
      `select count(*) filter (where vote = 'approve')::int as approvals,
              count(*) filter (where vote = 'decline')::int as declines
         from grant_votes where grant_id = $1`,
      [id],
    );
    const approvals = counts === null ? 0 : counts.approvals;
    const declines = counts === null ? 0 : counts.declines;
    let state: string = row.state;
    if (approvals >= quorum) {
      state = "approved";
      await tx.query("update grants set state = 'approved' where id = $1", [id]);
      await emit(
        "grant_changed",
        { grant_id: id, state, reason: "approved", holder_id: row.holder_id, options: row.options },
        grantAudience(row.holder_id, true),
      );
    } else if (declines >= quorum) {
      state = "draft";
      await tx.query("update grants set state = 'draft' where id = $1", [id]);
      await tx.query("delete from grant_votes where grant_id = $1", [id]);
      await emit(
        "grant_changed",
        { grant_id: id, state, reason: "returned_to_draft", holder_id: row.holder_id, options: row.options },
        grantAudience(row.holder_id, true),
      );
      await emitCapTable(emit);
    } else {
      await emit(
        "grant_changed",
        { grant_id: id, state, reason: "voted", approvals, declines, quorum, holder_id: row.holder_id },
        grantAudience(row.holder_id, true),
      );
    }
    return json({
      id,
      holder_name: row.holder_id === null ? "" : (await loadPerson(tx, row.holder_id))?.name ?? "",
      options: row.options ?? 0,
      strike: row.strike ?? "0.0000",
      vesting_type: row.vesting_type ?? "standard",
      vesting_start: row.vesting_start ?? "",
      approvals,
      declines,
      my_vote: vote,
      state,
    });
  });
};

export const grantRoutes: Route[] = [
  route("GET", "/api/grants", listGrants),
  route("POST", "/api/grants", createGrant),
  route("GET", "/api/grants/:id", readGrant),
  route("PATCH", "/api/grants/:id", patchGrant),
  route("DELETE", "/api/grants/:id", deleteGrant),
  route("POST", "/api/grants/:id/submit", submitGrant),
  route("POST", "/api/grants/:id/offer", offerGrant),
  route("POST", "/api/grants/:id/accept", acceptGrant),
  route("POST", "/api/grants/:id/decline", declineGrant),
  route("GET", "/api/board/queue", boardQueue),
  route("POST", "/api/board/queue/:id/votes", castVote),
];

