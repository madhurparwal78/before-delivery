/**
 * The conservation dossier: its HTML, its render and its storage. It is made
 * from the piece's latest signed-off estimate and carries no amounts, no
 * unsigned note and no labour rate.
 */
import type { App } from '../app.ts';
import { F } from '../../shared/feedback.ts';
import { c, PIN_KIND_COPY, TOWN_NAMES } from '../../shared/clientCopy.ts';
import { directionOf, type Language } from '../../shared/language.ts';
import { escapeHtml, noteToHtml } from '../domain/markup.ts';
import { instantText, type Town } from '../domain/time.ts';
import { storageKeys, StorageUnavailable } from '../services/storage.ts';
import { RenderUnavailable, type RenderAsset } from '../services/render.ts';
import type { Row } from '../present.ts';

export const DOSSIER_SECTIONS = [
  { number: '01', heading: 'The piece', hash: 'the-piece' },
  { number: '02', heading: 'Condition', hash: 'condition' },
  { number: '03', heading: 'Materials', hash: 'materials' },
  { number: '04', heading: 'Photographs', hash: 'photographs' },
  { number: '05', heading: 'Care card', hash: 'care-card' },
  { number: '06', heading: 'History', hash: 'history' },
] as const;

export interface DossierHistoryEntry {
  at: string;
  who: string;
  what: string;
}

interface DossierContent {
  pieceTitle: string;
  stampNumber: string | null;
  maker: string | null;
  year: string | null;
  clientName: string;
  town: Town;
  language: Language;
  materialName: string | null;
  materialCode: string | null;
  lot: string | null;
  hides: number | null;
  metres: string | null;
  signedPins: { number: number; kind: string; note: string; x: string; y: string }[];
  photographs: { side: 'before' | 'after'; fileName: string }[];
  history: DossierHistoryEntry[];
}

function dossierHtml(content: DossierContent): string {
  const lang = content.language;
  const dir = directionOf(lang);
  const pinRows = content.signedPins
    .map(
      (pin) =>
        `<tr><td>${pin.number}</td><td>${escapeHtml(c(PIN_KIND_COPY[pin.kind] ?? 'C43', lang))}</td>` +
        `<td>${escapeHtml(`${pin.x}, ${pin.y}`)}</td><td>${noteToHtml(pin.note)}</td></tr>`,
    )
    .join('');

  const materialBlock = content.materialCode
    ? `<dl>
         <dt>${escapeHtml(c('C34', lang))}</dt><dd>${escapeHtml(`${content.materialName} ${content.materialCode}`)}</dd>
         <dt>${escapeHtml(c('C33', lang))}</dt><dd>${escapeHtml(content.lot ?? '')}</dd>
         ${content.hides !== null ? `<dt>Hides</dt><dd>${content.hides}</dd>` : ''}
         ${content.metres !== null ? `<dt>Metres</dt><dd>${escapeHtml(content.metres)} m</dd>` : ''}
       </dl>`
    : `<p>${escapeHtml(c('C40', lang))}</p>`;

  const photographs = content.photographs
    .map(
      (p) =>
        `<figure><img src="${escapeHtml(p.fileName)}" alt="${escapeHtml(
          c(p.side === 'before' ? 'C30' : 'C31', lang),
        )}"><figcaption>${escapeHtml(c(p.side === 'before' ? 'C27' : 'C28', lang))}</figcaption></figure>`,
    )
    .join('');

  const historyRows = content.history
    .map(
      (h) =>
        `<tr><td>${escapeHtml(h.at)}</td><td>${escapeHtml(h.who)}</td><td>${escapeHtml(h.what)}</td></tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head><meta charset="utf-8"><title>${escapeHtml(content.pieceTitle)}</title>
<style>
  @page { size: A4; margin: 0; }
  body { font-family: Jost, system-ui, sans-serif; color: #17181a; font-size: 11pt; margin: 0; }
  h1 { font-size: 22pt; margin: 0 0 4mm; }
  h2 { font-size: 13pt; margin: 8mm 0 2mm; border-bottom: 1px solid #c9ccd1; padding-bottom: 1mm; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: start; padding: 1.5mm 2mm; border-bottom: 1px solid #e3e5e8; vertical-align: top; }
  dl { display: grid; grid-template-columns: 40mm 1fr; gap: 1mm 3mm; margin: 0; }
  dt { color: #5c6066; }
  figure { margin: 0 0 4mm; }
  img { width: 80mm; height: auto; background: #f1f2f4; }
  .pair { display: flex; gap: 6mm; flex-wrap: wrap; }
  .stamp { font-variant-numeric: tabular-nums; letter-spacing: 0.08em; }
</style></head>
<body>
  <h1>${escapeHtml(content.pieceTitle)}</h1>
  <section><h2>01 The piece</h2>
    <dl>
      <dt>Stamp number</dt><dd class="stamp">${escapeHtml(content.stampNumber ?? '')}</dd>
      <dt>Maker</dt><dd>${escapeHtml(content.maker ?? '')}</dd>
      <dt>Year</dt><dd>${escapeHtml(content.year ?? '')}</dd>
      <dt>Client</dt><dd>${escapeHtml(content.clientName)}</dd>
      <dt>Town</dt><dd>${escapeHtml(TOWN_NAMES[content.town]?.[lang] ?? content.town)}</dd>
    </dl>
  </section>
  <section><h2>02 ${escapeHtml(c('C42', lang))}</h2>
    ${
      pinRows
        ? `<table><thead><tr><th>#</th><th>${escapeHtml(
            c('C42', lang),
          )}</th><th>x, y</th><th>Note</th></tr></thead><tbody>${pinRows}</tbody></table>`
        : `<p>${escapeHtml(c('C51', lang))}</p>`
    }
  </section>
  <section><h2>03 ${escapeHtml(c('C34', lang))}</h2>${materialBlock}</section>
  <section><h2>04 ${escapeHtml(c('C03', lang))}</h2>
    ${photographs ? `<div class="pair">${photographs}</div>` : `<p>${escapeHtml(c('C50', lang))}</p>`}
  </section>
  <section><h2>05 ${escapeHtml(c('K1', lang))}</h2><p>${escapeHtml(c('K2', lang))}</p></section>
  <section><h2>06 History</h2>
    <table><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead><tbody>${historyRows}</tbody></table>
  </section>
</body></html>`;
}

async function readDossierContent(
  app: App,
  pieceId: string,
  estimateId: string | null,
  history: DossierHistoryEntry[],
): Promise<{ content: DossierContent; assets: RenderAsset[] }> {
  const piece = await app.db.one<Row>(
    `SELECT p.*, c.name AS client_name, c.town, c.language
       FROM pieces p JOIN clients c ON c.id = p.client_id WHERE p.id = $1`,
    [pieceId],
  );
  if (!piece) throw new Error('piece gone');

  const pins = await app.db.query<Row>(
    `SELECT number, kind, note, x, y FROM pins WHERE piece_id = $1 AND signed = true
      ORDER BY (y)::numeric, (x)::numeric`,
    [pieceId],
  );

  const estimate = estimateId
    ? await app.db.one<Row>(`SELECT * FROM estimates WHERE id = $1`, [estimateId])
    : null;
  const material = estimate?.material_code
    ? await app.db.one<Row>(`SELECT name FROM materials WHERE desk_id = $1 AND code = $2`, [
        piece.desk_id,
        estimate.material_code,
      ])
    : null;

  const assets: RenderAsset[] = [];
  const photographs: DossierContent['photographs'] = [];
  for (const side of ['before', 'after'] as const) {
    const row = await app.db.one<Row>(
      `SELECT sha256 FROM photographs WHERE piece_id = $1 AND side = $2 AND state = 'stored'
        ORDER BY number DESC LIMIT 1`,
      [pieceId, side],
    );
    if (!row) continue;
    const bytes = await app.storage.get(
      storageKeys.photograph(String(piece.desk_id), pieceId, String(row.sha256)),
    );
    if (!bytes) continue;
    const fileName = `${side}.png`;
    assets.push({ name: fileName, bytes, contentType: 'image/png' });
    photographs.push({ side, fileName });
  }

  return {
    content: {
      pieceTitle: String(piece.title),
      stampNumber: piece.stamp_number === null ? null : String(piece.stamp_number),
      maker: piece.maker === null ? null : String(piece.maker),
      year: piece.year === null ? null : String(piece.year),
      clientName: String(piece.client_name),
      town: String(piece.town) as Town,
      language: String(piece.language) as Language,
      materialName: material ? String(material.name) : null,
      materialCode: estimate?.material_code ? String(estimate.material_code) : null,
      lot: estimate?.lot ? String(estimate.lot) : null,
      hides:
        estimate?.hides === null || estimate?.hides === undefined ? null : Number(estimate.hides),
      metres: estimate?.metres ? String(estimate.metres) : null,
      signedPins: pins.map((p) => ({
        number: Number(p.number),
        kind: String(p.kind),
        note: String(p.note),
        x: String(p.x),
        y: String(p.y),
      })),
      photographs,
      history,
    },
    assets,
  };
}

export async function deskName(app: App, deskId: string): Promise<string> {
  const row = await app.db.one<Row>(`SELECT name FROM desks WHERE id = $1`, [deskId]);
  return row ? String(row.name) : '';
}

/**
 * Renders the dossier and stores it. Either failure moves the state to `failed`
 * with its own copy and leaves no object behind.
 */
export async function renderAndStore(
  app: App,
  dossierId: string,
  deskId: string,
  pieceId: string,
  estimateId: string | null,
): Promise<void> {
  const who = await deskName(app, deskId);
  const history = await app.db.query<Row>(
    `SELECT at, who, what FROM dossier_history WHERE dossier_id = $1 ORDER BY id`,
    [dossierId],
  );
  const { content, assets } = await readDossierContent(
    app,
    pieceId,
    estimateId,
    history.map((h) => ({
      at: instantText(new Date(h.at as string).getTime()),
      who: String(h.who),
      what: String(h.what),
    })),
  );

  await app.db.query(`UPDATE dossiers SET state = 'rendering', message = NULL WHERE id = $1`, [
    dossierId,
  ]);

  let pdf: Uint8Array;
  try {
    pdf = await app.render.htmlToPdf(dossierHtml(content), assets);
  } catch (error) {
    if (!(error instanceof RenderUnavailable)) throw error;
    await app.db.query(`UPDATE dossiers SET state = 'failed', message = $2 WHERE id = $1`, [
      dossierId,
      F.renderDown,
    ]);
    return;
  }
  await app.db.query(
    `INSERT INTO dossier_history (dossier_id, who, what) VALUES ($1, $2, 'rendered')`,
    [dossierId, who],
  );

  try {
    await app.storage.put(storageKeys.dossier(deskId, pieceId, dossierId), pdf, 'application/pdf');
  } catch (error) {
    if (!(error instanceof StorageUnavailable)) throw error;
    await app.db.query(`UPDATE dossiers SET state = 'failed', message = $2 WHERE id = $1`, [
      dossierId,
      F.storeDown,
    ]);
    return;
  }

  await app.db.query(`UPDATE dossiers SET state = 'stored', message = NULL WHERE id = $1`, [
    dossierId,
  ]);
  await app.db.query(
    `INSERT INTO dossier_history (dossier_id, who, what) VALUES ($1, $2, 'stored')`,
    [dossierId, who],
  );
}
