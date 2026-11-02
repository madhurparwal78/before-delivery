import { randomUUID } from "node:crypto";
import { assetDownstream, downstreamAssets, type Snapshot } from "./catalog.ts";
import { config } from "./config.ts";
import { pool, type Tx } from "./db.ts";
import { sendMessage } from "./smtp.ts";
import { byString } from "./text.ts";

/** The owner's exact stored name as an RFC 5322 display name (DP-64). */
function displayName(name: string): string {
  if (/^[A-Za-z0-9 ]+$/.test(name)) return name;
  if (/^[\x00-\x7f]*$/.test(name)) return `"${name.replace(/(["\\])/g, "\\$1")}"`;
  const words: string[] = [];
  let chunk = "";
  for (const ch of name) {
    if (Buffer.byteLength(chunk + ch) > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w).toString("base64")}?=`).join(" ");
}

function rfc5322Date(date: Date): string {
  return date.toUTCString().replace("GMT", "+0000");
}

export interface Owner {
  id: string;
  name: string;
  email: string;
}

/**
 * Queues one notice per distinct owner of a transitive downstream asset, in the deprecation's
 * transaction. `snapshot` is the catalog with the deprecation applied.
 */
export async function queueNotices(
  tx: Tx,
  snapshot: Snapshot,
  deprecatedAsset: string,
  eventId: string,
  actorName: string,
  reason: string,
  owners: Map<string, Owner>,
): Promise<number> {
  const affected = [...downstreamAssets(assetDownstream(snapshot), deprecatedAsset).keys()].sort(byString);
  const sourceColumns = snapshot.assetColumns.get(deprecatedAsset) ?? [];
  const reachedColumns = new Set<string>();
  const stack = [...sourceColumns];
  const seen = new Set(stack);
  while (stack.length) {
    for (const e of snapshot.adj.out.get(stack.pop()!) ?? []) {
      if (seen.has(e.to)) continue;
      seen.add(e.to);
      reachedColumns.add(e.to);
      stack.push(e.to);
    }
  }
  const byOwner = new Map<string, string[]>();
  for (const asset of affected) {
    const owner = snapshot.assets.get(asset)!.owner.id;
    (byOwner.get(owner) ?? byOwner.set(owner, []).get(owner)!).push(asset);
  }
  for (const [ownerId, assets] of byOwner) {
    const owner = owners.get(ownerId)!;
    const lines = [
      `${deprecatedAsset} was deprecated by ${actorName}.`,
      `Reason: ${reason.replace(/\r\n|\r|\n/g, " ")}`,
      "",
      "Your affected assets:",
    ];
    for (const asset of assets) {
      const columns = (snapshot.assetColumns.get(asset) ?? [])
        .filter((c) => reachedColumns.has(c))
        .map((c) => snapshot.columns.get(c)!.name)
        .sort(byString);
      lines.push(`- ${asset} - nearest deprecated upstream: ${snapshot.deprecatedUpstream.get(asset)}`);
      lines.push(`  Columns: ${columns.join(", ")}`);
    }
    await tx.query(
      `insert into notices(id, event_id, asset_id, owner_id, to_header, subject, body, state)
       values ($1, $2, $3, $4, $5, $6, $7, 'queued')`,
      [randomUUID(), eventId, deprecatedAsset, ownerId, `${displayName(owner.name)} <${owner.email}>`,
        `Strata: ${deprecatedAsset} was deprecated`, lines.join("\r\n")],
    );
  }
  return byOwner.size;
}

export async function queuedCount(tx: Tx | typeof pool = pool): Promise<number> {
  const { rows } = await tx.query("select count(*)::int as n from notices where state = 'queued'");
  return rows[0].n;
}

/** Reinstatement cancels this asset's unsent notices that are not under an unexpired claim (DP-65). */
export async function cancelNotices(tx: Tx, assetId: string): Promise<number> {
  const { rowCount } = await tx.query(
    `update notices set state = 'cancelled'
     where asset_id = $1 and state = 'queued' and (claimed_until is null or claimed_until < now())`,
    [assetId],
  );
  return rowCount ?? 0;
}

interface Claimed {
  id: string;
  to_header: string;
  subject: string;
  body: string;
}

/** Claims queued notices under a 30-second lease and sends each once (DP-68). */
export async function sendQueuedNotices(): Promise<void> {
  const { rows } = await pool.query(
    `update notices set claimed_until = now() + interval '30 seconds'
     where id in (select id from notices where state = 'queued' and (claimed_until is null or claimed_until < now())
                  order by created_at limit 20 for update skip locked)
     returning id, to_header, subject, body`,
  );
  for (const notice of rows as Claimed[]) {
    const to = /<([^>]+)>$/.exec(notice.to_header)![1];
    const message = [
      `From: ${config.mailFrom}`,
      `To: ${notice.to_header}`,
      `Subject: ${notice.subject}`,
      `Message-ID: <notice-${notice.id}@strata.quarrystone.test>`,
      `Date: ${rfc5322Date(new Date())}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      notice.body,
    ].join("\r\n");
    try {
      await sendMessage(to, message);
      await pool.query("update notices set state = 'sent', claimed_until = null where id = $1", [notice.id]);
    } catch {
      await pool.query("update notices set claimed_until = null where id = $1 and state = 'queued'", [notice.id]);
    }
  }
}
