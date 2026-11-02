import type { Database } from './db';
import type { DbRow } from './querier';
import type { Tag, Transform } from '../shared/domain';
import type { TEdge } from '../shared/lineage';
import type { PointInTimeTarget } from './catalog';
import {
  SEED_ASSETS,
  SEED_COLUMNS,
  SEED_DEPRECATED,
  SEED_DIRECT_TAGS,
  SEED_EDGES,
  SEED_TERMS,
} from './seeddata';

interface AuditDbRow extends DbRow {
  seq: number;
  at: string;
  actor_id: string;
  actor_role: string;
  action: string;
  target_type: string;
  target_id: string;
  before: unknown;
  after: unknown;
}

/**
 * Point-in-time reads (DP-86): the catalog as of seq k is the fixed seed state
 * with audit rows 1..k applied in commit order. Descriptions, column types and
 * samples never change after registration, so registered assets take those
 * immutable fields from the current tables.
 */
export async function replayPointInTime(db: Database, k: number, target: PointInTimeTarget): Promise<void> {
  applySeed(target);
  if (k === 0) return;
  const rows = await db.query<AuditDbRow>(
    `SELECT seq, at, actor_id, actor_role, action, target_type, target_id, before, after
     FROM audit_log WHERE seq <= $1 ORDER BY seq ASC`,
    [k]
  );
  const registeredAssets = new Set<string>();
  for (const row of rows) {
    if (row.action === 'asset.register') registeredAssets.add(row.target_id);
  }
  if (registeredAssets.size > 0) {
    const immut = await loadImmutableFields(db, [...registeredAssets]);
    for (const row of rows) {
      if (row.action !== 'asset.register') continue;
      applyRegisteredAsset(target, row, immut);
    }
  }
  for (const row of rows) {
    if (row.action === 'asset.register') continue;
    applyAuditRow(target, row);
  }
}

interface ImmutableFields {
  descriptions: Map<string, string>;
  columnTypes: Map<string, string>;
  samples: Map<string, string[]>;
}

async function loadImmutableFields(db: Database, assetIds: string[]): Promise<ImmutableFields> {
  const descriptions = new Map<string, string>();
  const columnTypes = new Map<string, string>();
  const samples = new Map<string, string[]>();
  const assets = await db.query<{ id: string; description: string }>(
    `SELECT id, description FROM assets WHERE id = ANY($1)`,
    [assetIds]
  );
  for (const a of assets) descriptions.set(a.id, a.description);
  const cols = await db.query<{ id: string; data_type: string }>(
    `SELECT id, data_type FROM columns_ WHERE asset = ANY($1)`,
    [assetIds]
  );
  for (const c of cols) columnTypes.set(c.id, c.data_type);
  const smp = await db.query<{ column_id: string; values: string[] }>(
    `SELECT column_id, array_agg(value ORDER BY position) AS values FROM column_samples
     WHERE column_id = ANY($1) GROUP BY column_id`,
    [cols.map((c) => c.id)]
  );
  for (const s of smp) samples.set(s.column_id, s.values ?? []);
  return { descriptions, columnTypes, samples };
}

function applySeed(target: PointInTimeTarget): void {
  for (const a of SEED_ASSETS) {
    target.assets.set(a.id, {
      id: a.id,
      kind: a.kind,
      description: a.description,
      owner_id: a.owner,
      state: a.id === SEED_DEPRECATED ? 'deprecated' : 'draft',
      verified_at: null,
    });
    target.assetTerms.set(a.id, new Set(a.terms));
  }
  let position = 0;
  for (const c of SEED_COLUMNS) {
    const asset = c.id.slice(0, c.id.lastIndexOf('.'));
    const name = c.id.slice(c.id.lastIndexOf('.') + 1);
    target.columns.set(c.id, { id: c.id, asset, name, data_type: c.type, position: position++ });
    target.samples.set(c.id, [...c.samples]);
  }
  target.edges.length = 0;
  for (const e of SEED_EDGES) target.edges.push({ id: '', from: e.from, to: e.to, transform: e.transform });
  target.directTags.clear();
  for (const t of SEED_DIRECT_TAGS) {
    const set = target.directTags.get(t.column) ?? new Set<Tag>();
    set.add(t.tag as Tag);
    target.directTags.set(t.column, set);
  }
  target.suppressions.clear();
  for (const t of SEED_TERMS) target.terms.set(t.id, { id: t.id, name: t.name, definition: t.definition, revision: 1 });
  target.evidence.clear();
  target.deprecations.clear();
  if (target.assets.has(SEED_DEPRECATED)) {
    target.deprecations.set(SEED_DEPRECATED, {
      event_id: 'seed',
      reason: 'Replaced by the 2024 eligibility feed.',
      at: '',
      by: 'u-morgan',
    });
  }
}

function applyRegisteredAsset(target: PointInTimeTarget, row: AuditDbRow, immut: ImmutableFields): void {
  const id = row.target_id;
  const after = (row.after ?? {}) as Record<string, unknown>;
  const names = ((after.columns as string[]) ?? []);
  target.assets.set(id, {
    id,
    kind: String(after.kind ?? 'table'),
    description: immut.descriptions.get(id) ?? '',
    owner_id: String(after.owner_id ?? ''),
    state: 'draft',
    verified_at: null,
  });
  let pos = 0;
  for (const name of names) {
    const colId = `${id}.${name}`;
    target.columns.set(colId, {
      id: colId,
      asset: id,
      name,
      data_type: immut.columnTypes.get(colId) ?? '',
      position: pos++,
    });
    target.samples.set(colId, immut.samples.get(colId) ?? []);
  }
}

function applyAuditRow(target: PointInTimeTarget, row: AuditDbRow): void {
  const after = (row.after ?? {}) as Record<string, unknown>;
  const before = (row.before ?? {}) as Record<string, unknown>;
  switch (row.action) {
    case 'tag.add':
    case 'tag.withdraw': {
      const col = row.target_id;
      const tags = ((after.direct_tags as string[]) ?? []) as Tag[];
      if (!target.columns.has(col)) break;
      target.directTags.set(col, new Set(tags));
      break;
    }
    case 'tag.suppress': {
      const col = row.target_id;
      if (!target.columns.has(col)) break;
      const tags = ((after.suppressed_tags as string[]) ?? []) as Tag[];
      const per = target.suppressions.get(col) ?? new Map<Tag, { justification: string; at: string; by: string }>();
      for (const tag of tags) {
        if (!per.has(tag)) per.set(tag, { justification: String(after.justification ?? ''), at: row.at, by: row.actor_id });
      }
      target.suppressions.set(col, per);
      break;
    }
    case 'tag.unsuppress': {
      const col = row.target_id;
      const tags = ((after.suppressed_tags as string[]) ?? []) as Tag[];
      const per = target.suppressions.get(col);
      if (per) {
        for (const tag of [...per.keys()]) if (!tags.includes(tag)) per.delete(tag);
      }
      break;
    }
    case 'tag.bulk_add': {
      const per = ((after.direct_tags as Record<string, string[]>) ?? {});
      for (const [col, tags] of Object.entries(per)) {
        if (target.columns.has(col)) target.directTags.set(col, new Set(tags as Tag[]));
      }
      break;
    }
    case 'tag.bulk_undo': {
      const per = ((after.direct_tags as Record<string, string[]>) ?? {});
      for (const [col, tags] of Object.entries(per)) {
        if (target.columns.has(col)) target.directTags.set(col, new Set(tags as Tag[]));
      }
      break;
    }
    case 'certification.verify': {
      const asset = target.assets.get(row.target_id);
      if (asset) {
        asset.state = 'verified';
        asset.verified_at = row.at;
      }
      target.evidence.set(row.target_id, {
        evidence_id: '',
        filename: String(after.filename ?? ''),
        content_type: String(after.content_type ?? ''),
        size_bytes: Number(after.size_bytes ?? 0),
        sha256: String(after.evidence_sha256 ?? ''),
        uploaded_at: row.at,
        uploaded_by: row.actor_id,
      });
      break;
    }
    case 'certification.deprecate': {
      const asset = target.assets.get(row.target_id);
      if (asset) asset.state = 'deprecated';
      target.deprecations.set(row.target_id, {
        event_id: row.target_id,
        reason: String(after.reason ?? ''),
        at: row.at,
        by: row.actor_id,
      });
      break;
    }
    case 'certification.reinstate': {
      const asset = target.assets.get(row.target_id);
      if (asset) {
        asset.state = 'draft';
        asset.verified_at = null;
      }
      target.evidence.delete(row.target_id);
      target.deprecations.delete(row.target_id);
      break;
    }
    case 'lineage.add': {
      const edges = ((after.edges as Array<{ id: string; from: string; to: string; transform: string }>) ?? []);
      for (const e of edges) {
        if (!target.edges.some((x: TEdge) => x.from === e.from && x.to === e.to) && target.columns.has(e.from) && target.columns.has(e.to)) {
          target.edges.push({ id: e.id, from: e.from, to: e.to, transform: e.transform as Transform });
        }
      }
      break;
    }
    case 'lineage.remove': {
      const edge = before.edge as { id: string; from: string; to: string; transform: string } | null | undefined;
      if (edge) {
        const idx = target.edges.findIndex((x: TEdge) => x.id === edge.id);
        if (idx >= 0) target.edges.splice(idx, 1);
      }
      break;
    }
    case 'term.create': {
      target.terms.set(row.target_id, {
        id: row.target_id,
        name: String(after.name ?? ''),
        definition: String(after.definition ?? ''),
        revision: Number(after.revision ?? 1),
      });
      break;
    }
    case 'term.update': {
      const term = target.terms.get(row.target_id);
      if (term) {
        if (after.name !== undefined) term.name = String(after.name);
        if (after.definition !== undefined) term.definition = String(after.definition);
        term.revision = Number(after.revision ?? term.revision);
      }
      break;
    }
    case 'term.link':
    case 'term.unlink': {
      const terms = ((after.terms as string[]) ?? []);
      if (target.assets.has(row.target_id)) target.assetTerms.set(row.target_id, new Set(terms));
      break;
    }
    default:
      break;
  }
}
