import { compareIds } from '../../shared/domain.ts';
import { columnsDownstreamOfAsset, nearestDeprecatedUpstream, transitiveDownstreamAssets } from './deprecation.ts';
import type { Snapshot } from './snapshot.ts';

export interface NoticeDraft {
  ownerId: string;
  recipientName: string;
  recipientEmail: string;
  subject: string;
  body: string;
}

/** A display name is written as is, quoted, or as RFC 2047 encoded-words. */
export function encodeDisplayName(name: string): string {
  if (/^[A-Za-z0-9 ]*$/.test(name)) return name;
  if (/^[\x20-\x7e]*$/.test(name)) return `"${name.replace(/([\\"])/g, '\\$1')}"`;
  return `=?UTF-8?B?${Buffer.from(name, 'utf8').toString('base64')}?=`;
}

export function recipientHeader(name: string, email: string): string {
  return `${encodeDisplayName(name)} <${email}>`;
}

export function noticeSubject(deprecatedAssetId: string): string {
  return `Strata: ${deprecatedAssetId} was deprecated`;
}

export function noticeMessageId(noticeId: string): string {
  return `<notice-${noticeId}@strata.quarrystone.test>`;
}

/**
 * One notice per distinct owner of a transitive downstream asset, listing their affected
 * assets and columns and the nearest deprecated upstream, and never a sample value.
 */
export function buildNoticeDrafts(
  snapshot: Snapshot,
  deprecatedAssetId: string,
  actorName: string,
  reason: string,
): NoticeDraft[] {
  const downstreamColumns = columnsDownstreamOfAsset(snapshot, deprecatedAssetId);
  const affectedByOwner = new Map<string, string[]>();
  for (const assetId of transitiveDownstreamAssets(snapshot, deprecatedAssetId)) {
    const asset = snapshot.assets.get(assetId);
    if (!asset) continue;
    const list = affectedByOwner.get(asset.ownerId) ?? [];
    list.push(assetId);
    affectedByOwner.set(asset.ownerId, list);
  }

  const singleLineReason = reason.replace(/\r\n|\r|\n/g, ' ');
  const drafts: NoticeDraft[] = [];
  for (const ownerId of [...affectedByOwner.keys()].sort(compareIds)) {
    const owner = snapshot.users.get(ownerId);
    if (!owner) continue;
    const lines = [
      `${deprecatedAssetId} was deprecated by ${actorName}.`,
      `Reason: ${singleLineReason}`,
      '',
      'Your affected assets:',
    ];
    for (const assetId of (affectedByOwner.get(ownerId) as string[]).sort(compareIds)) {
      const columns = snapshot
        .assetColumns(assetId)
        .filter((column) => downstreamColumns.has(column.id))
        .map((column) => column.name)
        .sort(compareIds);
      lines.push(`- ${assetId} - nearest deprecated upstream: ${nearestDeprecatedUpstream(snapshot, assetId)}`);
      lines.push(`  Columns: ${columns.join(', ')}`);
    }
    drafts.push({
      ownerId,
      recipientName: owner.name,
      recipientEmail: owner.email,
      subject: noticeSubject(deprecatedAssetId),
      body: `${lines.join('\n')}\n`,
    });
  }
  return drafts;
}
