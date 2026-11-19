// Reset and seed: the demo dataset at first boot and the grading routes (brief: Grading routes, Seed body).
import { config } from "./config.ts";
import { applySchema, pool, transaction, type Tx } from "./db.ts";
import { DATA_TABLES } from "./schema.ts";
import { ApiError, seedConflict } from "./errors.ts";
import { hashPassword, newToken } from "./auth.ts";
import { conditionText } from "./conditions.ts";
import { deadlineFor, warningAt } from "./deadlines.ts";
import { drawPng, drawSvg } from "./images.ts";
import { StorageUnavailable, deleteObject, derivativeKey, listKeys, masterKey, putObject } from "./storage.ts";
import demoSeed from "./demo-seed.json" with { type: "json" };
import { grantWindow } from "./grants.ts";
import {
  APPLICATION_VALUES,
  ASSET_CLASSES,
  ASSET_STATES,
  AUDIENCES,
  CONDITION_KINDS,
  GRANT_STATUSES,
  REQUEST_STATES,
  ROLES,
  VERSION_STATES,
  type AssetClass,
  type ConditionKind,
  type Role,
} from "../shared/domain.ts";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Obj = { [key: string]: Json };

const KEY = /^[a-z0-9_-]+$/;

/** Walks the seed body and throws 422 `seed_invalid` with `<JSON path>: <problem>` at the first fault. */
class Check {
  private readonly keys = new Map<string, Set<string>>();

  fail(path: string, problem: string): never {
    throw new ApiError(422, "seed_invalid", `${path}: ${problem}`);
  }

  object(value: Json | undefined, path: string): Obj {
    if (value === null || typeof value !== "object" || Array.isArray(value)) this.fail(path, "must be an object");
    return value as Obj;
  }

  array(value: Json | undefined, path: string, optional = false): Json[] {
    if (value === undefined && optional) return [];
    if (!Array.isArray(value)) this.fail(path, "must be an array");
    return value;
  }

  string(value: Json | undefined, path: string): string {
    if (typeof value !== "string" || value === "") this.fail(path, "must be a non-empty string");
    return value;
  }

  nullableString(value: Json | undefined, path: string): string | null {
    return value === null || value === undefined ? null : this.string(value, path);
  }

  int(value: Json | undefined, path: string): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) this.fail(path, "must be a non-negative integer");
    return value;
  }

  bool(value: Json | undefined, path: string): boolean {
    if (typeof value !== "boolean") this.fail(path, "must be true or false");
    return value;
  }

  oneOf<T extends string>(value: Json | undefined, allowed: readonly T[], path: string): T {
    if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) this.fail(path, `must be one of ${allowed.join(", ")}`);
    return value as T;
  }

  strings(value: Json | undefined, path: string, allowed?: readonly string[]): string[] {
    return this.array(value, path).map((item, i) => (allowed ? this.oneOf(item, allowed, `${path}[${i}]`) : this.string(item, `${path}[${i}]`)));
  }

  date(value: Json | undefined, path: string): string {
    const text = this.string(value, path);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text))) this.fail(path, "must be a date as YYYY-MM-DD");
    return text;
  }

  instant(value: Json | undefined, path: string): string {
    const text = this.string(value, path);
    if (Number.isNaN(Date.parse(text))) this.fail(path, "must be an ISO date-time");
    return text;
  }

  /** Declares a unique key of a collection and returns it. */
  key(item: Obj, path: string, scope: string, field = "key"): string {
    const key = this.string(item[field], `${path}.${field}`);
    if (!KEY.test(key)) this.fail(`${path}.${field}`, "must be lowercase letters, digits, - or _");
    const seen = this.keys.get(scope) ?? new Set<string>();
    if (seen.has(key)) this.fail(`${path}.${field}`, `duplicate key ${key}`);
    seen.add(key);
    this.keys.set(scope, seen);
    return key;
  }

  ref(value: Json | undefined, scope: string, path: string): string {
    const key = this.string(value, path);
    if (!this.keys.get(scope)?.has(key)) this.fail(path, `unknown ${scope} ${key}`);
    return key;
  }

  nullableRef(value: Json | undefined, scope: string, path: string): string | null {
    return value === null || value === undefined ? null : this.ref(value, scope, path);
  }
}

interface SeedVariant { key: string; label: string; derivatives: SeedDerivative[] }
interface SeedDerivative { fileName: string; format: "png" | "svg"; width: number; height: number }
interface SeedStage { kind: "brand" | "legal"; assignee: string | null; decision: string | null; decidedAt: string | null; comment: string | null }
interface SeedCondition { kind: ConditionKind; value: string | null; addedBy: string | null }

const label = (key: string): string => key.replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase());

/** Validates the body and returns it in a typed shape. */
function parse(body: Json): Parsed {
  const c = new Check();
  const root = c.object(body, "$");
  const orgs = c.array(root.organisations, "organisations").map((raw, i) => {
    const path = `organisations[${i}]`;
    const o = c.object(raw, path);
    const key = c.key(o, path, "organisation");
    const engagement = o.engagement === undefined || o.engagement === null ? null : c.object(o.engagement, `${path}.engagement`);
    return {
      key,
      name: c.string(o.name, `${path}.name`),
      kind: c.oneOf(o.kind, ["brand", "agency", "press"], `${path}.kind`),
      territory: c.string(o.territory, `${path}.territory`),
      engagement: engagement && {
        startsOn: c.date(engagement.startsOn, `${path}.engagement.startsOn`),
        endsOn: c.date(engagement.endsOn, `${path}.engagement.endsOn`),
        territories: c.strings(engagement.territories, `${path}.engagement.territories`),
      },
    };
  });
  const principals = c.array(root.principals, "principals").map((raw, i) => {
    const path = `principals[${i}]`;
    const o = c.object(raw, path);
    const key = c.key(o, path, "principal");
    return {
      key,
      email: c.string(o.email, `${path}.email`),
      displayName: c.string(o.displayName, `${path}.displayName`),
      role: c.oneOf<Role>(o.role, ROLES, `${path}.role`),
      password: c.string(o.password, `${path}.password`),
      organisation: c.ref(o.organisation, "organisation", `${path}.organisation`),
    };
  });
  const groups = c.array(root.groups, "groups", true).map((raw, i) => {
    const path = `groups[${i}]`;
    const o = c.object(raw, path);
    const key = c.key(o, path, "group");
    return { key, name: c.string(o.name, `${path}.name`), members: c.array(o.members, `${path}.members`).map((m, j) => c.ref(m, "principal", `${path}.members[${j}]`)) };
  });
  const licences = c.array(root.licences, "licences").map((raw, i) => {
    const path = `licences[${i}]`;
    const o = c.object(raw, path);
    const key = c.key(o, path, "licence");
    return {
      key,
      name: c.string(o.name, `${path}.name`),
      permitted: c.strings(o.permittedApplications, `${path}.permittedApplications`, APPLICATION_VALUES),
      prohibited: c.strings(o.prohibitedApplications, `${path}.prohibitedApplications`, APPLICATION_VALUES),
      audiences: c.strings(o.audiences, `${path}.audiences`, AUDIENCES),
      territories: c.strings(o.territories, `${path}.territories`),
      excluded: c.strings(o.excludedTerritories, `${path}.excludedTerritories`),
      days: c.int(o.defaultDurationDays, `${path}.defaultDurationDays`),
      modification: c.bool(o.modificationPermitted, `${path}.modificationPermitted`),
      attribution: c.bool(o.attributionRequired, `${path}.attributionRequired`),
    };
  });
  const rawAssets = c.array(root.assets, "assets");
  rawAssets.forEach((raw, i) => c.key(c.object(raw, `assets[${i}]`), `assets[${i}]`, "asset"));
  const derivatives = (value: Json | undefined, path: string): SeedDerivative[] =>
    c.array(value, path, true).map((raw, j) => {
      const d = c.object(raw, `${path}[${j}]`);
      return {
        fileName: c.string(d.fileName, `${path}[${j}].fileName`),
        format: c.oneOf(d.format, ["png", "svg"], `${path}[${j}].format`),
        width: c.int(d.width, `${path}[${j}].width`),
        height: c.int(d.height, `${path}[${j}].height`),
      };
    });
  const assets = rawAssets.map((raw, i) => {
    const path = `assets[${i}]`;
    const o = raw as Obj;
    const variantKeys = new Set<string>();
    return {
      key: o.key as string,
      name: c.string(o.name, `${path}.name`),
      class: c.oneOf<AssetClass>(o.class, ASSET_CLASSES, `${path}.class`),
      state: c.oneOf(o.state, ASSET_STATES, `${path}.state`),
      licence: c.ref(o.licence, "licence", `${path}.licence`),
      successor: c.nullableRef(o.successor, "asset", `${path}.successor`),
      derivatives: derivatives(o.derivatives, `${path}.derivatives`),
      variants: c.array(o.variants, `${path}.variants`, true).map((rv, j): SeedVariant => {
        const v = c.object(rv, `${path}.variants[${j}]`);
        const vkey = c.string(v.key, `${path}.variants[${j}].key`);
        if (!KEY.test(vkey) || variantKeys.has(vkey)) c.fail(`${path}.variants[${j}].key`, "must be a unique key of lowercase letters, digits, - or _");
        variantKeys.add(vkey);
        return { key: vkey, label: label(vkey), derivatives: derivatives(v.derivatives, `${path}.variants[${j}].derivatives`) };
      }),
    };
  });
  const requests = c.array(root.requests, "requests", true).map((raw, i) => {
    const path = `requests[${i}]`;
    const o = c.object(raw, path);
    const key = c.key(o, path, "request");
    const asset = c.ref(o.asset, "asset", `${path}.asset`);
    const variant = c.nullableString(o.variant, `${path}.variant`);
    const owner = assets.find((a) => a.key === asset)!;
    if (variant && !owner.variants.some((v) => v.key === variant)) c.fail(`${path}.variant`, `unknown variant ${variant}`);
    const application = c.oneOf(o.applicationClass, APPLICATION_VALUES, `${path}.applicationClass`);
    return {
      key,
      requester: c.ref(o.requester, "principal", `${path}.requester`),
      asset,
      variant,
      application,
      territories: c.strings(o.territories, `${path}.territories`),
      startsOn: c.date(o.campaignStartsOn, `${path}.campaignStartsOn`),
      endsOn: c.date(o.campaignEndsOn, `${path}.campaignEndsOn`),
      citedRules: c.strings(o.citedRules, `${path}.citedRules`),
      note: typeof o.note === "string" ? o.note : "",
      state: c.oneOf(o.state, REQUEST_STATES, `${path}.state`),
      submittedAt: o.submittedAt === null || o.submittedAt === undefined ? null : c.instant(o.submittedAt, `${path}.submittedAt`),
      escalation: c.nullableString(o.escalation, `${path}.escalation`),
      conditions: c.array(o.conditions, `${path}.conditions`, true).map((rc, j): SeedCondition => {
        const cond = c.object(rc, `${path}.conditions[${j}]`);
        return {
          kind: c.oneOf(cond.kind, CONDITION_KINDS, `${path}.conditions[${j}].kind`),
          value: c.nullableString(cond.value, `${path}.conditions[${j}].value`),
          addedBy: c.nullableRef(cond.addedBy, "principal", `${path}.conditions[${j}].addedBy`),
        };
      }),
      stages: c.array(o.stages, `${path}.stages`, true).map((rs, j): SeedStage => {
        const s = c.object(rs, `${path}.stages[${j}]`);
        return {
          kind: c.oneOf(s.kind, ["brand", "legal"], `${path}.stages[${j}].kind`),
          assignee: c.nullableRef(s.assignee, "principal", `${path}.stages[${j}].assignee`),
          decision: s.decision === null || s.decision === undefined ? null : c.oneOf(s.decision, ["approve", "reject", "request_changes"], `${path}.stages[${j}].decision`),
          decidedAt: s.decidedAt === null || s.decidedAt === undefined ? null : c.instant(s.decidedAt, `${path}.stages[${j}].decidedAt`),
          comment: c.nullableString(s.comment, `${path}.stages[${j}].comment`),
        };
      }),
    };
  });
  const grants = c.array(root.grants, "grants", true).map((raw, i) => {
    const path = `grants[${i}]`;
    const o = c.object(raw, path);
    const key = c.key(o, path, "grant");
    const holder = c.object(o.holder, `${path}.holder`);
    const asset = c.ref(o.asset, "asset", `${path}.asset`);
    const variant = c.nullableString(o.variant, `${path}.variant`);
    if (variant && !assets.find((a) => a.key === asset)!.variants.some((v) => v.key === variant)) c.fail(`${path}.variant`, `unknown variant ${variant}`);
    return {
      key,
      holder: holder.principal !== undefined
        ? { type: "principal" as const, key: c.ref(holder.principal, "principal", `${path}.holder.principal`) }
        : { type: "group" as const, key: c.ref(holder.group, "group", `${path}.holder.group`) },
      asset,
      variant,
      request: c.nullableRef(o.request, "request", `${path}.request`),
      notBefore: o.notBefore === null || o.notBefore === undefined ? null : c.date(o.notBefore, `${path}.notBefore`),
      notAfter: c.date(o.notAfter, `${path}.notAfter`),
      status: c.oneOf(o.status, GRANT_STATUSES, `${path}.status`),
      conditions: c.array(o.conditions, `${path}.conditions`, true).map((rc, j): SeedCondition => {
        const cond = c.object(rc, `${path}.conditions[${j}]`);
        return { kind: c.oneOf(cond.kind, CONDITION_KINDS, `${path}.conditions[${j}].kind`), value: c.nullableString(cond.value, `${path}.conditions[${j}].value`), addedBy: null };
      }),
    };
  });
  const chapters = c.array(root.chapters, "chapters").map((raw, i) => {
    const path = `chapters[${i}]`;
    const o = c.object(raw, path);
    const slug = c.key(o, path, "chapter", "slug");
    return {
      slug,
      title: c.string(o.title, `${path}.title`),
      versions: c.array(o.versions, `${path}.versions`).map((rv, j) => {
        const v = c.object(rv, `${path}.versions[${j}]`);
        const vp = `${path}.versions[${j}]`;
        return {
          number: c.int(v.number, `${vp}.number`),
          state: c.oneOf(v.state, VERSION_STATES, `${vp}.state`),
          author: c.nullableRef(v.author, "principal", `${vp}.author`),
          publishedAt: v.publishedAt === null || v.publishedAt === undefined ? null : c.instant(v.publishedAt, `${vp}.publishedAt`),
          intro: c.string(v.intro, `${vp}.intro`),
          statements: c.array(v.statements, `${vp}.statements`).map((rs, k) => {
            const s = c.object(rs, `${vp}.statements[${k}]`);
            return { identifier: c.string(s.identifier, `${vp}.statements[${k}].identifier`), text: c.string(s.text, `${vp}.statements[${k}].text`) };
          }),
          assets: c.array(v.assets, `${vp}.assets`, true).map((a, k) => c.ref(a, "asset", `${vp}.assets[${k}]`)),
          withdrawn: c.array(v.withdrawn, `${vp}.withdrawn`, true).map((rw, k) => {
            const w = c.object(rw, `${vp}.withdrawn[${k}]`);
            return { identifier: c.string(w.identifier, `${vp}.withdrawn[${k}].identifier`), replacedBy: c.string(w.replacedBy, `${vp}.withdrawn[${k}].replacedBy`) };
          }),
        };
      }),
    };
  });
  const audit = c.array(root.audit, "audit", true).map((raw, i) => {
    const path = `audit[${i}]`;
    const o = c.object(raw, path);
    const actor = c.string(o.actor, `${path}.actor`);
    if (actor !== "system") c.ref(actor, "principal", `${path}.actor`);
    return {
      actor,
      action: c.string(o.action, `${path}.action`),
      resourceType: c.string(o.resourceType, `${path}.resourceType`),
      resourceId: c.string(o.resourceId, `${path}.resourceId`),
      request: c.nullableRef(o.request, "request", `${path}.request`),
      before: (o.before ?? null) as Record<string, Json> | null,
      after: (o.after ?? null) as Record<string, Json> | null,
      outcome: o.outcome === "denied" ? ("denied" as const) : ("success" as const),
      occurredAt: o.occurredAt === undefined || o.occurredAt === null ? null : c.instant(o.occurredAt, `${path}.occurredAt`),
    };
  });
  return { orgs, principals, groups, licences, assets, requests, grants, chapters, audit };
}

interface Parsed {
  orgs: { key: string; name: string; kind: string; territory: string; engagement: { startsOn: string; endsOn: string; territories: string[] } | null }[];
  principals: { key: string; email: string; displayName: string; role: Role; password: string; organisation: string }[];
  groups: { key: string; name: string; members: string[] }[];
  licences: { key: string; name: string; permitted: string[]; prohibited: string[]; audiences: string[]; territories: string[]; excluded: string[]; days: number; modification: boolean; attribution: boolean }[];
  assets: { key: string; name: string; class: AssetClass; state: string; licence: string; successor: string | null; derivatives: SeedDerivative[]; variants: SeedVariant[] }[];
  requests: { key: string; requester: string; asset: string; variant: string | null; application: string; territories: string[]; startsOn: string; endsOn: string; citedRules: string[]; note: string; state: string; submittedAt: string | null; escalation: string | null; conditions: SeedCondition[]; stages: SeedStage[] }[];
  grants: { key: string; holder: { type: "principal" | "group"; key: string }; asset: string; variant: string | null; request: string | null; notBefore: string | null; notAfter: string; status: string; conditions: SeedCondition[] }[];
  chapters: { slug: string; title: string; versions: { number: number; state: string; author: string | null; publishedAt: string | null; intro: string; statements: { identifier: string; text: string }[]; assets: string[]; withdrawn: { identifier: string; replacedBy: string }[] }[] }[];
  audit: { actor: string; action: string; resourceType: string; resourceId: string; request: string | null; before: Record<string, Json> | null; after: Record<string, Json> | null; outcome: "success" | "denied"; occurredAt: string | null }[];
}

const FIELD_RGB: Record<AssetClass, [number, number, number]> = {
  mark: [0x7f, 0xd3, 0xd0],
  spot_icon: [0xa9, 0xd9, 0x9a],
  pictogram: [0xa9, 0xd9, 0x9a],
  ui_icon: [0xc6, 0xb2, 0xf0],
  illustration: [0xf7, 0xc2, 0x66],
  photograph: [0xf2, 0xa0, 0x8c],
};
const rgbHex = ([r, g, b]: [number, number, number]): string => `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;

const SEED_LOCK = 7_301_004;

interface ObjectWrite { key: string; bytes: Buffer; contentType: string }

async function inChunks<T>(items: T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(work));
}

interface SeedResult {
  now: string;
  cookieName: string;
  ids: Record<string, Record<string, string>>;
  sessions: Record<string, string>;
}

/** Inserts the seed in one transaction, then writes its objects. The caller has checked that no principal exists. */
export async function loadSeed(body: unknown): Promise<SeedResult> {
  const seed = parse(body as Json);
  const hashes = new Map<string, Promise<string>>();
  for (const p of seed.principals) hashes.set(p.key, hashPassword(p.password));
  const writes: ObjectWrite[] = [];
  const ids: SeedResult["ids"] = {
    organisations: {}, principals: {}, groups: {}, licences: {}, assets: {}, variants: {}, derivatives: {}, requests: {}, grants: {}, versions: {},
  };
  const sessions: Record<string, string> = {};

  const now = await transaction(async (tx) => {
    // Two seeds at once must not both pass the "no principal yet" check made before parsing.
    await tx.q("SELECT pg_advisory_xact_lock($1)", [SEED_LOCK]);
    if (await principalsExist(tx)) throw seedConflict();
    const now = tx.now;
    const today = now;
    const orgId = (key: string): string => ids.organisations[key];
    for (const o of seed.orgs) {
      ids.organisations[o.key] = `org_${o.key}`;
      await tx.q(
        `INSERT INTO organisations (id, name, kind, territory, engagement_starts_on, engagement_ends_on, engagement_territories)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [`org_${o.key}`, o.name, o.kind, o.territory, o.engagement?.startsOn ?? null, o.engagement?.endsOn ?? null, o.engagement?.territories ?? null],
      );
    }
    for (const p of seed.principals) {
      ids.principals[p.key] = `usr_${p.key}`;
      await tx.q(`INSERT INTO principals (id, email, display_name, role, organisation_id, password_hash) VALUES ($1,$2,$3,$4,$5,$6)`, [
        `usr_${p.key}`, p.email, p.displayName, p.role, orgId(p.organisation), await hashes.get(p.key)!,
      ]);
      const token = newToken();
      sessions[p.key] = token;
      await tx.q("INSERT INTO sessions (token, principal_id) VALUES ($1,$2)", [token, `usr_${p.key}`]);
    }
    for (const g of seed.groups) {
      ids.groups[g.key] = `grp_${g.key}`;
      await tx.q("INSERT INTO groups (id, name) VALUES ($1,$2)", [`grp_${g.key}`, g.name]);
      for (const m of g.members) await tx.q("INSERT INTO group_members (group_id, principal_id) VALUES ($1,$2)", [`grp_${g.key}`, ids.principals[m]]);
    }
    for (const l of seed.licences) {
      ids.licences[l.key] = `lic_${l.key}`;
      await tx.q(`INSERT INTO licences VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [
        `lic_${l.key}`, l.name, l.permitted, l.prohibited, l.audiences, l.territories, l.excluded, l.days, l.modification, l.attribution,
      ]);
    }
    for (const a of seed.assets) ids.assets[a.key] = `ast_${a.key}`;
    for (const [position, a] of seed.assets.entries()) {
      const id = `ast_${a.key}`;
      await tx.q(`INSERT INTO assets (id, name, class, state, licence_id, successor_id, position) VALUES ($1,$2,$3,$4,$5,NULL,$6)`, [
        id, a.name, a.class, a.state, ids.licences[a.licence], position,
      ]);
      let n = 0;
      const field = FIELD_RGB[a.class];
      const insertDerivative = async (variantId: string | null, variantKey: string | null, d: SeedDerivative): Promise<void> => {
        n += 1;
        const bytes = d.format === "svg" ? drawSvg(d.width, d.height, rgbHex(field)) : drawPng(d.width, d.height, field);
        const derivativeId = `drv_${a.key}_${n}`;
        ids.derivatives[`${a.key}/${d.fileName}`] = derivativeId;
        await tx.q(`INSERT INTO derivatives (id, asset_id, variant_id, file_name, format, width, height, byte_size, position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
          derivativeId, id, variantId, d.fileName, d.format, d.width, d.height, bytes.length, n,
        ]);
        writes.push({ key: derivativeKey(id, variantKey, d.fileName), bytes, contentType: d.format === "svg" ? "image/svg+xml" : "image/png" });
      };
      for (const d of a.derivatives) await insertDerivative(null, null, d);
      for (const [vPosition, v] of a.variants.entries()) {
        const variantId = `var_${a.key}_${v.key}`;
        ids.variants[`${a.key}/${v.key}`] = variantId;
        await tx.q("INSERT INTO variants (id, asset_id, key, label, position) VALUES ($1,$2,$3,$4,$5)", [variantId, id, v.key, v.label, vPosition]);
        for (const d of v.derivatives) await insertDerivative(variantId, v.key, d);
      }
      await tx.q("INSERT INTO counters (name, value) VALUES ($1,$2)", [`derivative:${id}`, n]);
      writes.push({ key: masterKey(id, `${a.key}-master.svg`), bytes: drawSvg(1200, 1200, rgbHex(field)), contentType: "image/svg+xml" });
    }
    for (const a of seed.assets) {
      if (a.successor) await tx.q("UPDATE assets SET successor_id = $1 WHERE id = $2", [ids.assets[a.successor], ids.assets[a.key]]);
    }

    for (const [position, ch] of seed.chapters.entries()) {
      await tx.q("INSERT INTO chapters (slug, title, position) VALUES ($1,$2,$3)", [ch.slug, ch.title, position]);
      for (const v of ch.versions) {
        const id = `ver_${ch.slug}_${v.number}`;
        ids.versions[`${ch.slug}/${v.number}`] = id;
        await tx.q(
          `INSERT INTO chapter_versions (id, slug, number, state, author_id, revision, intro, statements, asset_ids, withdrawn, published_at)
           VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8,$9,$10)`,
          [id, ch.slug, v.number, v.state, v.author ? ids.principals[v.author] : null, v.intro, JSON.stringify(v.statements),
            v.assets.map((k) => ids.assets[k]), JSON.stringify(v.withdrawn), v.publishedAt],
        );
      }
    }
    const published = new Map(seed.chapters.map((ch) => [ch.slug, ch.versions.find((v) => v.state === "published")?.number ?? 0]));

    const conditionIds = new Map<string, SeedCondition[]>();
    for (const r of seed.requests) {
      const id = `REQ-${String(await tx.next("request")).padStart(4, "0")}`;
      ids.requests[r.key] = id;
      const open = r.stages.find((s) => s.decision === null);
      const holder = r.state === "under_review" && open?.assignee ? open.assignee : r.requester;
      const live = r.state === "under_review" && r.submittedAt !== null;
      const ruleVersions = Object.fromEntries(r.citedRules.map((rule) => [rule, published.get(rule.split(".")[0]) ?? 0]));
      await tx.q(
        `INSERT INTO requests (id, requester_id, asset_id, variant_id, application_class, territories, campaign_starts_on, campaign_ends_on,
           cited_rules, note, state, submitted_at, deadline, escalation, holder_id, rule_versions, requester_grants, warned, breached, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'[]',$17,$18,$19)`,
        [id, ids.principals[r.requester], ids.assets[r.asset], r.variant ? ids.variants[`${r.asset}/${r.variant}`] : null, r.application,
          r.territories, r.startsOn, r.endsOn, r.citedRules, r.note, r.state, r.submittedAt,
          r.submittedAt ? deadlineFor(r.submittedAt, r.application) : null, r.escalation, ids.principals[holder],
          JSON.stringify(ruleVersions),
          live && warningAt(r.submittedAt!, r.application) <= today, live && deadlineFor(r.submittedAt!, r.application) <= today,
          r.submittedAt ?? now],
      );
      for (const [i, s] of r.stages.entries()) {
        await tx.q(
          `INSERT INTO request_stages (request_id, n, kind, assignee_id, decision, decided_by, decided_at, comment) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id, i + 1, s.kind, s.assignee ? ids.principals[s.assignee] : null, s.decision, s.decision && s.assignee ? ids.principals[s.assignee] : null, s.decidedAt, s.comment],
        );
      }
      conditionIds.set(r.key, r.conditions);
      for (const [i, cond] of r.conditions.entries()) {
        const conditionId = `CON-${String(await tx.next("condition")).padStart(4, "0")}`;
        await tx.q(`INSERT INTO conditions (id, request_id, kind, value, text, added_by, position) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
          conditionId, id, cond.kind, cond.value, conditionText(cond.kind, cond.value), cond.addedBy ? ids.principals[cond.addedBy] : "system", i + 1,
        ]);
      }
    }
    for (const g of seed.grants) {
      const id = `GR-${String(await tx.next("grant")).padStart(4, "0")}`;
      ids.grants[g.key] = id;
      const request = g.request ? seed.requests.find((r) => r.key === g.request)! : null;
      const owner = seed.assets.find((a) => a.key === g.asset)!;
      const licence = seed.licences.find((l) => l.key === owner.licence)!;
      const requesterOrg = request ? seed.orgs.find((o) => o.key === seed.principals.find((p) => p.key === request.requester)!.organisation)! : null;
      const window = request
        ? grantWindow({
            approvalDate: g.notBefore ?? request.startsOn,
            campaignEndsOn: request.endsOn,
            defaultDurationDays: licence.days,
            expiryOverrides: request.conditions.filter((c) => c.kind === "expiry_override").map((c) => c.value!),
            engagementEndsOn: requesterOrg?.engagement?.endsOn ?? null,
          })
        : null;
      const cap = window && window.notAfter === g.notAfter ? window.cap : null;
      await tx.q(
        `INSERT INTO grants (id, holder_type, holder_id, asset_id, variant_id, request_id, not_before, not_after, status, cap)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, g.holder.type, g.holder.type === "principal" ? ids.principals[g.holder.key] : ids.groups[g.holder.key], ids.assets[g.asset],
          g.variant ? ids.variants[`${g.asset}/${g.variant}`] : null, g.request ? ids.requests[g.request] : null, g.notBefore, g.notAfter, g.status, cap],
      );
      const conditions = request ? conditionIds.get(request.key)! : g.conditions;
      for (const [i, cond] of conditions.entries()) {
        await tx.q("INSERT INTO grant_conditions (grant_id, position, kind, text) VALUES ($1,$2,$3,$4)", [id, i + 1, cond.kind, conditionText(cond.kind, cond.value)]);
      }
    }
    for (const entry of seed.audit) {
      const actorId = entry.actor === "system" ? "system" : ids.principals[entry.actor];
      const role = entry.actor === "system" ? "system" : seed.principals.find((p) => p.key === entry.actor)!.role;
      tx.audit({
        actorId, actorRole: role as Role | "system", action: entry.action as never, resourceType: entry.resourceType, resourceId: entry.resourceId,
        requestId: entry.request ? ids.requests[entry.request] : null, before: entry.before, after: entry.after, outcome: entry.outcome,
        occurredAt: entry.occurredAt ?? undefined,
      });
    }
    return now;
  });

  try {
    await inChunks(writes, 6, (w) => putObject(w.key, w.bytes, w.contentType));
  } catch (error) {
    if (!(error instanceof StorageUnavailable)) throw error;
    console.warn("seed: storage is unreachable, objects were not written");
  }
  return { now, cookieName: config.sessionCookieName, ids, sessions };
}

/** Empties every table and the bucket, and sets the app clock to APP_START_AT (brief: Grading routes). */
export async function resetAll(): Promise<string> {
  // Every transaction starts by reading the app clock, so taking the clock table first (holding nothing else)
  // makes in-flight work finish and later work queue behind the reset instead of deadlocking with the truncate.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE app_clock IN ACCESS EXCLUSIVE MODE");
    await client.query(`TRUNCATE ${DATA_TABLES.join(", ")} RESTART IDENTITY CASCADE`);
    await client.query("INSERT INTO app_clock (id, now) VALUES (1, $1)", [config.appStartAt]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  try {
    await inChunks(await listKeys(), 8, deleteObject);
  } catch (error) {
    if (!(error instanceof StorageUnavailable)) throw error;
  }
  return config.appStartAt;
}

/** Boot: schema, clock, and the demo dataset when the database has no principal. */
export async function prepareDatabase(): Promise<void> {
  await applySchema();
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(7301003)");
    await client.query("INSERT INTO app_clock (id, now) VALUES (1, $1) ON CONFLICT DO NOTHING", [config.appStartAt]);
    const empty = Number((await client.query("SELECT count(*) AS n FROM principals")).rows[0].n) === 0;
    if (empty) await loadSeed(demoSeed);
  } finally {
    await client.query("SELECT pg_advisory_unlock(7301003)");
    client.release();
  }
}

export async function principalsExist(tx: Tx): Promise<boolean> {
  return Number((await tx.one<{ n: number }>("SELECT count(*) AS n FROM principals"))!.n) > 0;
}
