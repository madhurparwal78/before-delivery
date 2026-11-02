import type { CatalogData } from './catalog';
import type { Derived } from './derived';
import type { OutgoingNotice } from './mail';
import type { Tag } from '../shared/domain';

export interface NoticeContent {
  noticeId: string;
  ownerName: string;
  ownerEmail: string;
  asset: string;
  reason: string;
  actorName: string;
  affected: Array<{ asset: string; nearestUpstream: string; columns: string[] }>;
}

/**
 * One plain-text notice per distinct downstream owner (DP-63, DP-64): the
 * affected assets and their reached columns, never a sample value.
 */
export function composeNotice(content: NoticeContent): OutgoingNotice {
  const lines: string[] = [];
  lines.push(`${content.asset} was deprecated by ${content.actorName}.`);
  const flatReason = content.reason.replace(/\r\n|\r|\n/g, ' ');
  lines.push(`Reason: ${flatReason}`);
  lines.push('');
  lines.push(`Your affected assets:`);
  for (const a of content.affected) {
    lines.push(`- ${a.asset} - nearest deprecated upstream: ${a.nearestUpstream}`);
    lines.push(`  Columns: ${a.columns.join(', ')}`);
  }
  return {
    messageId: `<notice-${content.noticeId}@strata.quarrystone.test>`,
    toName: content.ownerName,
    toEmail: content.ownerEmail,
    subject: `Strata: ${content.asset} was deprecated`,
    body: lines.join('\r\n'),
  };
}

/** The per-owner affected assets of a deprecation, in asset id order, with their reached columns. */
export function noticeTargets(
  data: CatalogData,
  d: Derived,
  deprecatedAsset: string
): Map<string, Array<{ asset: string; nearestUpstream: string; columns: string[] }>> {
  const transitive = new Set<string>();
  const seen = new Set<string>([deprecatedAsset]);
  let frontier = [deprecatedAsset];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const a of frontier) {
      for (const ds of d.downstreamAssets.get(a) ?? []) {
        if (seen.has(ds)) continue;
        seen.add(ds);
        transitive.add(ds);
        next.push(ds);
      }
    }
    frontier = next;
  }
  const byOwner = new Map<string, Array<{ asset: string; nearestUpstream: string; columns: string[] }>>();
  for (const asset of [...transitive].sort()) {
    const owner = data.assets.get(asset)?.owner_id;
    if (!owner) continue;
    const nearest = d.deprecatedUpstream.get(asset);
    const columns = reachedColumns(data, d, deprecatedAsset, asset);
    const list = byOwner.get(owner) ?? [];
    list.push({ asset, nearestUpstream: nearest ?? deprecatedAsset, columns });
    byOwner.set(owner, list);
  }
  return byOwner;
}

function reachedColumns(data: CatalogData, d: Derived, fromAsset: string, toAsset: string): string[] {
  const fromCols = [...data.columns.values()].filter((c) => c.asset === fromAsset).map((c) => c.id);
  const toCols = [...data.columns.values()].filter((c) => c.asset === toAsset).map((c) => c.id);
  const targets = new Set(toCols);
  const reached: string[] = [];
  const seen = new Set<string>(fromCols);
  const queue = [...fromCols];
  let qi = 0;
  while (qi < queue.length) {
    const u = queue[qi++]!;
    for (const e of d.graph.out.get(u) ?? []) {
      const v = e.to;
      if (seen.has(v)) continue;
      seen.add(v);
      if (targets.has(v)) reached.push(v);
      queue.push(v);
    }
  }
  // The notice lists the reached column names, never a sample value.
  return reached.map((id) => id.slice(id.lastIndexOf('.') + 1)).sort();
}

export type { Tag };
