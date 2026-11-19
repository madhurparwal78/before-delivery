import { readFile } from "node:fs/promises";
import { ZONE_NAMES, type Zone } from "../shared/api.js";
import { formatPounds } from "../shared/money.js";
import { config } from "./config.js";
import { one, pool, rows, tx, type Db } from "./db.js";
import { recordNotice } from "./notices.js";
import { fees } from "./rules.js";
import { describe } from "./http.js";
import { call } from "./status.js";
import { getObject, putConfirmed } from "./storage.js";

// Statements and settlement sheets: the app's own HTML rendered by Gotenberg, stored in the bucket, and
// shown as ready only after both succeed (brief: Services › Gotenberg, Statements and settlement readiness).

const FONT = readFile(new URL("../../../public/fonts/jost-latin-wght-normal.woff2", import.meta.url));

export async function queueStatement(db: Db, pledgeId: string, campaignId: string): Promise<void> {
  await db.query(
    "INSERT INTO documents (id, kind, pledge_id, campaign_id, status, object_key, created_at) VALUES ($1, 'statement', $2, $3, 'pending', $4, $5) ON CONFLICT (id) DO NOTHING",
    [`statement:${pledgeId}`, pledgeId, campaignId, `statements/${pledgeId}.pdf`, new Date()],
  );
}

export async function queueSettlement(db: Db, campaignId: string): Promise<void> {
  await db.query(
    "INSERT INTO documents (id, kind, campaign_id, status, object_key, created_at) VALUES ($1, 'settlement', $2, 'pending', $3, $4) ON CONFLICT (id) DO NOTHING",
    [`settlement:${campaignId}`, campaignId, `settlements/${campaignId}.pdf`, new Date()],
  );
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(title)}</title><style>
@font-face{font-family:Jost;src:url(jost.woff2) format("woff2");font-weight:100 900}
@page{size:A4;margin:18mm}
body{font-family:Jost,sans-serif;color:#0C4E4F;background:#EEF4F1;font-size:12pt;margin:0}
h1{font-size:22pt;margin:0 0 4pt;letter-spacing:.01em}
h2{font-size:14pt;margin:16pt 0 6pt}
p{margin:2pt 0}
table{border-collapse:collapse;width:100%;margin-top:8pt}
td,th{text-align:left;padding:4pt 6pt;border-bottom:1.5pt solid #0C4E4F;font-variant-numeric:tabular-nums}
td.n,th.n{text-align:right}
.mark{display:inline-block;width:10pt;height:10pt;border-radius:50%;background:#0C4E4F;margin-right:6pt}
img{max-width:100%;max-height:120mm;display:block;margin:10pt 0}
</style></head><body>${body}</body></html>`;
}

interface StatementFacts {
  id: string;
  campaign_id: string;
  amount: number;
  reward: number;
  shipping: number;
  add_on: number;
  zone: Zone;
  backer_name: string;
  title: string;
  tier_title: string;
  cover_key: string | null;
  cover_type: string | null;
}

function coverName(type: string | null): string {
  return `cover.${type === "image/jpeg" ? "jpg" : type === "image/webp" ? "webp" : "png"}`;
}

function statementHtml(f: StatementFacts, hasCover: boolean): string {
  const fee = fees(f.amount);
  const row = (label: string, pence: number) => `<tr><td>${escape(label)}</td><td class="n">${formatPounds(pence)}</td></tr>`;
  return page("Dotgain backer statement", `
<h1><span class="mark"></span>Dotgain backer statement</h1>
<p><strong>${escape(f.title)}</strong></p>
<p>${escape(f.backer_name)}</p>
<p>Pledge ${escape(f.id)}</p>
<p>${escape(f.tier_title)}</p>
${hasCover ? `<img src="${coverName(f.cover_type)}" alt="Cover of ${escape(f.title)}">` : ""}
<table>
${row("Reward", f.reward)}
${row(`Shipping (${ZONE_NAMES[f.zone]})`, f.shipping)}
${row("Add-on", f.add_on)}
${row("Total charged", f.amount)}
${row("Platform fee (5%)", fee.platform_fee)}
${row("Processing (3% + 20p)", fee.processing_fee)}
${row("To the creator", fee.to_creator)}
</table>`);
}

interface SettlementFacts {
  title: string;
  lines: { pledge_id: string; amount: number }[];
  dropped: number;
}

function settlementHtml(f: SettlementFacts): string {
  const lines = f.lines.map((l) => ({ ...l, ...fees(l.amount) }));
  const sum = (pick: (l: (typeof lines)[number]) => number) => lines.reduce((total, l) => total + pick(l), 0);
  const total = (label: string, value: string) => `<tr><td>${escape(label)}</td><td class="n">${value}</td></tr>`;
  return page("Dotgain settlement sheet", `
<h1><span class="mark"></span>Dotgain settlement sheet</h1>
<p><strong>${escape(f.title)}</strong></p>
<h2>Captured pledges</h2>
<table><tr><th>Pledge</th><th class="n">Amount</th><th class="n">Platform</th><th class="n">Processing</th><th class="n">To creator</th></tr>
${lines.map((l) => `<tr><td>${escape(l.pledge_id)}</td><td class="n">${formatPounds(l.amount)}</td><td class="n">${formatPounds(l.platform_fee)}</td><td class="n">${formatPounds(l.processing_fee)}</td><td class="n">${formatPounds(l.to_creator)}</td></tr>`).join("\n")}
</table>
<h2>Totals</h2>
<table>
${total("Gross", formatPounds(sum((l) => l.amount)))}
${total("Platform fees", formatPounds(sum((l) => l.platform_fee)))}
${total("Processing fees", formatPounds(sum((l) => l.processing_fee)))}
${total("Net to creator", formatPounds(sum((l) => l.to_creator)))}
${total("Captured pledges", String(lines.length))}
${total("Dropped pledges", String(f.dropped))}
</table>`);
}

async function render(html: string, cover: { data: Buffer; type: string } | null): Promise<Buffer> {
  const form = new FormData();
  form.append("files", new Blob([html], { type: "text/html" }), "index.html");
  form.append("files", new Blob([new Uint8Array(await FONT)], { type: "font/woff2" }), "jost.woff2");
  if (cover) form.append("files", new Blob([new Uint8Array(cover.data)], { type: cover.type }), coverName(cover.type));
  form.append("printBackground", "true");
  const response = await call("documents", `${config.gotenbergUrl}/forms/chromium/convert/html`, { method: "POST", body: form }, 60_000);
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new Error(`gotenberg answered ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

interface PendingDocument {
  id: string;
  kind: "statement" | "settlement";
  pledge_id: string | null;
  campaign_id: string;
  object_key: string;
}

async function produce(doc: PendingDocument): Promise<void> {
  if (doc.kind === "statement") {
    const f = await one<StatementFacts>(pool, `
      SELECT p.id, p.campaign_id, p.amount, p.reward, p.shipping, p.add_on, p.zone, b.name AS backer_name, c.title,
             t.title AS tier_title, m.object_key AS cover_key, m.content_type AS cover_type
      FROM pledges p JOIN people b ON b.id = p.backer_id JOIN campaigns c ON c.id = p.campaign_id
      JOIN tiers t ON t.id = p.tier_id
      LEFT JOIN media m ON m.campaign_id = c.id AND m.kind = 'cover' AND m.status = 'stored'
      WHERE p.id = $1`, [doc.pledge_id]);
    if (!f) return;
    const cover = f.cover_key && f.cover_type ? { data: await getObject(f.cover_key), type: f.cover_type } : null;
    const pdf = await render(statementHtml(f, cover !== null), cover);
    await putConfirmed(doc.object_key, pdf, "application/pdf");
    await pool.query("UPDATE documents SET status = 'ready', ready_at = $2 WHERE id = $1", [doc.id, new Date()]);
    return;
  }
  const campaign = await one<{ title: string; creator_email: string }>(pool,
    "SELECT c.title, p.email AS creator_email FROM campaigns c JOIN people p ON p.id = c.creator_id WHERE c.id = $1", [doc.campaign_id]);
  if (!campaign) return;
  const lines = await rows<{ pledge_id: string; amount: number }>(pool,
    "SELECT id AS pledge_id, amount FROM pledges WHERE campaign_id = $1 AND state = 'captured' ORDER BY created_at", [doc.campaign_id]);
  const dropped = await one<{ n: number }>(pool, "SELECT count(*)::bigint AS n FROM pledges WHERE campaign_id = $1 AND state = 'dropped'", [doc.campaign_id]);
  const pdf = await render(settlementHtml({ title: campaign.title, lines, dropped: dropped?.n ?? 0 }), null);
  await putConfirmed(doc.object_key, pdf, "application/pdf");
  await tx(async (db) => {
    await db.query("UPDATE documents SET status = 'ready', ready_at = $2 WHERE id = $1", [doc.id, new Date()]);
    const net = lines.reduce((total, l) => total + fees(l.amount).to_creator, 0);
    await recordNotice(db, doc.campaign_id, "settlement_ready", campaign.creator_email, { title: campaign.title, amount: net });
  });
}

let lastFailure = 0;
let running = false;

async function renderPending(): Promise<void> {
  if (running || Date.now() - lastFailure < 10_000) return;
  running = true;
  try {
    const pending = await rows<PendingDocument>(pool,
      "SELECT id, kind, pledge_id, campaign_id, object_key FROM documents WHERE status = 'pending' ORDER BY created_at LIMIT 20");
    for (const doc of pending) {
      try {
        await produce(doc);
      } catch (error) {
        lastFailure = Date.now();
        console.error(`document ${doc.id}: ${describe(error)}`);
        return;
      }
    }
  } finally {
    running = false;
  }
}

export function startRenderer(): void {
  setInterval(() => void renderPending().catch((error: unknown) => console.error(`renderer: ${describe(error)}`)), 1000);
}

export async function probe(): Promise<void> {
  const response = await call("documents", `${config.gotenbergUrl}/health`, {}, 5000);
  await response.body?.cancel();
}
