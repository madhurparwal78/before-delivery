import { randomUUID } from "node:crypto";
import { loadSamples, loadSnapshot } from "../catalog.ts";
import { pool, readSnapshot, type Tx } from "../db.ts";
import { conflict, FieldErrors, forbidden, inPrecedence, invalid, notFound } from "../errors.ts";
import type { Route } from "../http.ts";
import { may } from "../permissions.ts";
import { normaliseTermName, termNameKey } from "../terms.ts";
import { byName, byString, withinLength } from "../text.ts";
import { assetDetail } from "../views.ts";
import { commitWrite } from "../write.ts";

interface TermRow {
  id: string;
  name: string;
  definition: string;
  revision: number;
}

async function termBody(tx: Tx, term: TermRow) {
  const { rows } = await tx.query("select asset_id as id from term_links where term_id = $1 and to_seq is null", [term.id]);
  return { ...term, assets: rows.map((r: { id: string }) => ({ id: r.id })).sort((a, b) => byString(a.id, b.id)) };
}

async function liveTerm(tx: Tx | typeof pool, id: string): Promise<TermRow | undefined> {
  const { rows } = await tx.query(
    "select term_id as id, name, definition, revision from term_revisions where term_id = $1 and to_seq is null", [id],
  );
  return rows[0];
}

async function nameTakenBy(tx: Tx, name: string, except: string | null): Promise<string | null> {
  const { rows } = await tx.query(
    "select name from term_revisions where name_key = $1 and to_seq is null and term_id <> coalesce($2, '')",
    [termNameKey(name), except],
  );
  return rows[0]?.name ?? null;
}

function termFields(body: Record<string, unknown>, errors: FieldErrors, partial: boolean): { name?: string; definition?: string } {
  const out: { name?: string; definition?: string } = {};
  if (!partial || "name" in body) {
    const name = typeof body.name === "string" ? normaliseTermName(body.name) : "";
    if (!withinLength(name, 1, 80)) errors.add("name", "Use 1 to 80 characters.");
    out.name = name;
  }
  if (!partial || "definition" in body) {
    if (!withinLength(body.definition, 1, 1000)) errors.add("definition", "Use 1 to 1,000 characters.");
    out.definition = body.definition as string;
  }
  return out;
}

async function requireAsset(id: string): Promise<void> {
  if (!(await pool.query("select 1 from assets where id = $1", [id])).rowCount) throw notFound();
}

async function linkedAssetDetail(tx: Tx, assetId: string, role: Parameters<typeof assetDetail>[3]) {
  const snapshot = await loadSnapshot(tx, null);
  return assetDetail(snapshot, assetId, await loadSamples(tx, snapshot.assetColumns.get(assetId) ?? []), role);
}

async function linkedTermIds(tx: Tx, assetId: string): Promise<string[]> {
  const { rows } = await tx.query("select term_id from term_links where asset_id = $1 and to_seq is null", [assetId]);
  return rows.map((r: { term_id: string }) => r.term_id).sort(byString);
}

export const termRoutes: Route[] = [
  {
    method: "GET",
    pattern: "/api/terms",
    async handler() {
      return readSnapshot(async (tx) => {
        const { rows } = await tx.query("select term_id as id, name, definition, revision from term_revisions where to_seq is null");
        const links = await tx.query("select term_id, asset_id from term_links where to_seq is null order by asset_id");
        const byTerm = new Map<string, { id: string }[]>();
        for (const l of links.rows as { term_id: string; asset_id: string }[]) {
          (byTerm.get(l.term_id) ?? byTerm.set(l.term_id, []).get(l.term_id)!).push({ id: l.asset_id });
        }
        const terms = (rows as TermRow[]).sort(byName).map((t) => ({ ...t, assets: byTerm.get(t.id) ?? [] }));
        return { status: 200, body: { terms } };
      });
    },
  },
  {
    method: "POST",
    pattern: "/api/terms",
    async handler(ctx) {
      const body = ctx.json();
      const term = await commitWrite(ctx.actor, may.curate, async ({ tx, seq }) => {
        const errors = new FieldErrors();
        const fields = termFields(body, errors, false);
        await inPrecedence({
          async state() {
            const taken = fields.name ? await nameTakenBy(tx, fields.name, null) : null;
            if (taken !== null) throw conflict("term_exists", `A term named ${taken} already exists.`);
          },
          validation() {
            errors.throwIfAny();
          },
        });
        const id = `t-${randomUUID()}`;
        await tx.query("insert into terms(id) values ($1)", [id]);
        await tx.query(
          "insert into term_revisions(term_id, name, name_key, definition, revision, from_seq) values ($1, $2, $3, $4, 1, $5)",
          [id, fields.name, termNameKey(fields.name!), fields.definition, seq],
        );
        return {
          audit: { action: "term.create", targetType: "term", targetId: id, before: null, after: { name: fields.name!, definition: fields.definition!, revision: 1 } },
          result: await termBody(tx, { id, name: fields.name!, definition: fields.definition!, revision: 1 }),
        };
      });
      return { status: 201, body: { term } };
    },
  },
  {
    method: "PATCH",
    pattern: "/api/terms/:id",
    async handler(ctx) {
      const id = ctx.params.id;
      await inPrecedence({
        async existence() {
          if (!(await liveTerm(pool, id))) throw notFound();
        },
      });
      const body = ctx.json();
      const term = await commitWrite(ctx.actor, may.curate, async ({ tx, seq }) => {
        const current = (await liveTerm(tx, id))!;
        const revision = body.revision;
        const validRevision = typeof revision === "number" && Number.isInteger(revision) && revision >= 1;
        const errors = new FieldErrors();
        if (!validRevision) errors.add("revision", "Send the revision you edited.");
        const fields = termFields(body, errors, true);
        await inPrecedence({
          async state() {
            if (validRevision && revision !== current.revision) {
              throw conflict("term_stale", "This term changed since you opened it. Reload and try again.");
            }
            const taken = fields.name ? await nameTakenBy(tx, fields.name, id) : null;
            if (taken !== null) throw conflict("term_exists", `A term named ${taken} already exists.`);
          },
          validation() {
            errors.throwIfAny();
          },
        });
        const next: TermRow = { id, name: fields.name ?? current.name, definition: fields.definition ?? current.definition, revision: current.revision + 1 };
        await tx.query("update term_revisions set to_seq = $2 where term_id = $1 and to_seq is null", [id, seq]);
        await tx.query(
          "insert into term_revisions(term_id, name, name_key, definition, revision, from_seq) values ($1, $2, $3, $4, $5, $6)",
          [id, next.name, termNameKey(next.name), next.definition, next.revision, seq],
        );
        const before: Record<string, string | number> = {};
        const after: Record<string, string | number> = {};
        for (const key of ["name", "definition"] as const) {
          if (next[key] !== current[key]) {
            before[key] = current[key];
            after[key] = next[key];
          }
        }
        before.revision = current.revision;
        after.revision = next.revision;
        return { audit: { action: "term.update", targetType: "term", targetId: id, before, after }, result: await termBody(tx, next) };
      });
      return { status: 200, body: { term } };
    },
  },
  {
    method: "POST",
    pattern: "/api/assets/:id/terms",
    async handler(ctx) {
      const assetId = ctx.params.id;
      await inPrecedence({
        async existence() {
          await requireAsset(assetId);
        },
      });
      const termId = ctx.json().term_id;
      const detail = await commitWrite(ctx.actor, may.curate, async ({ tx, seq, actor }) => {
        const found = typeof termId === "string" ? await liveTerm(tx, termId) : undefined;
        const before = await linkedTermIds(tx, assetId);
        await inPrecedence({
          state() {
            if (found && before.includes(found.id)) throw conflict("term_linked", `${found.name} is already linked.`);
          },
          validation() {
            if (!found) throw invalid({ term_id: "Unknown term." });
          },
        });
        const term = found!;
        await tx.query("insert into term_links(asset_id, term_id, from_seq) values ($1, $2, $3)", [assetId, term.id, seq]);
        return {
          audit: { action: "term.link", targetType: "asset", targetId: assetId, before: { terms: before }, after: { terms: [...before, term.id].sort(byString) } },
          result: await linkedAssetDetail(tx, assetId, actor.role),
        };
      });
      return { status: 200, body: detail };
    },
  },
  {
    method: "DELETE",
    pattern: "/api/assets/:id/terms/:term",
    async handler(ctx) {
      const { id: assetId, term: termId } = ctx.params;
      await inPrecedence({
        async existence() {
          await requireAsset(assetId);
          if (!(await pool.query("select 1 from term_links where asset_id = $1 and term_id = $2 and to_seq is null", [assetId, termId])).rowCount) {
            throw notFound();
          }
        },
        permission() {
          if (!may.curate(ctx.actor.role)) throw forbidden();
        },
      });
      const detail = await commitWrite(ctx.actor, may.curate, async ({ tx, seq, actor }) => {
        const before = await linkedTermIds(tx, assetId);
        await inPrecedence({
          existence() {
            if (!before.includes(termId)) throw notFound();
          },
        });
        await tx.query("update term_links set to_seq = $3 where asset_id = $1 and term_id = $2 and to_seq is null", [assetId, termId, seq]);
        return {
          audit: { action: "term.unlink", targetType: "asset", targetId: assetId, before: { terms: before }, after: { terms: before.filter((t) => t !== termId) } },
          result: await linkedAssetDetail(tx, assetId, actor.role),
        };
      });
      return { status: 200, body: detail };
    },
  },
];
