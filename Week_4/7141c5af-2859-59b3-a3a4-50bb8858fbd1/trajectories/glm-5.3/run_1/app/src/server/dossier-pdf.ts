import { q1, q } from "./db.js";
import { renderPdf } from "./providers/gotenberg.js";
import { clientCopy, type ClientLang } from "./client-copy.js";
import { renderNoteText } from "./markup.js";
import { fmtDateByLang, townZone, isoZ } from "./time.js";
import { renderNoteHtml } from "./markup.js";

/** Build the dossier HTML and render it through Gotenberg; the answer is the PDF bytes. */
export async function renderDossierPdf(deskId: string, pieceId: string): Promise<Buffer | null> {
  const piece = await q1<{ id: string; title: string; maker: string | null; year: string | null; stamp_number: string | null; client_id: string | null }>(
    "SELECT id, title, maker, year, stamp_number, client_id FROM pieces WHERE id=$1 AND desk_id=$2", [pieceId, deskId]
  );
  if (!piece) return null;
  const client = piece.client_id ? await q1<{ name: string; town: string; language: string }>("SELECT name, town, language FROM clients WHERE id=$1", [piece.client_id]) : null;
  const lang = (client?.language ?? "en") as ClientLang;
  const copy = clientCopy[lang];
  const estimate = await q1<{ material_code: string | null; lot: string | null; state: string }>(
    "SELECT material_code, lot, state FROM estimates WHERE piece_id=$1 AND state='signedOff' ORDER BY version DESC LIMIT 1", [pieceId]
  );
  const material = estimate?.material_code
    ? await q1<{ code: string; name: string }>("SELECT code, name FROM materials WHERE desk_id=$1 AND code=$2", [deskId, estimate.material_code])
    : null;
  const pins = await q<{ number: number; kind: string; note: string; signed: boolean; x: string; y: string }>(
    "SELECT number, kind, note, signed, x, y FROM pins WHERE piece_id=$1 ORDER BY y, x", [pieceId]
  );
  const photos = await q<{ id: string; side: string; sha256: string }>(
    "SELECT id, side, sha256 FROM photographs WHERE piece_id=$1 AND state='stored' ORDER BY number", [pieceId]
  );
  const { s3 } = await import("./providers/s3.js");
  const photoImages: string[] = [];
  for (const photo of photos) {
    if (photoImages.length >= 4) break;
    const bytes = await s3.get(`photographs/${deskId}/${pieceId}/${photo.sha256}`);
    if (bytes) photoImages.push(`data:image/png;base64,${bytes.toString("base64")}`);
  }
  const kindName: Record<string, string> = { tear: copy.C43, crack: copy.C44, stain: copy.C45, looseJoint: copy.C46, woodworm: copy.C47 };
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const dueDate = client ? await q1<{ due_date: string | null }>("SELECT due_date::text AS due_date FROM pieces WHERE id=$1", [pieceId]) : null;
  void dueDate;
  void fmtDateByLang;
  void townZone;
  void isoZ;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font-family: sans-serif; color: #222; margin: 32px; }
    h1 { font-size: 22px; } h2 { font-size: 16px; margin-top: 24px; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #ddd; font-size: 12px; }
    .photos { display: flex; gap: 12px; } .photos img { width: 240px; height: 180px; object-fit: cover; }
    .card { border: 1px solid #ddd; padding: 12px; margin-top: 8px; }
  </style></head><body>
  <h1>${esc(piece.title)}</h1>
  <p>${esc(piece.maker ?? "")} ${esc(piece.year ?? "")} — ${esc(piece.stamp_number ?? "")}</p>
  <h2>${esc(lang === "en" ? "02 Condition" : lang === "it" ? "02 Stato" : lang === "ja" ? "02 状態" : "02 الحالة")}</h2>
  <table><thead><tr><th>#</th><th>${esc(lang === "en" ? "Kind" : lang === "it" ? "Tipo" : lang === "ja" ? "種類" : "النوع")}</th><th>${esc(lang === "en" ? "Note" : lang === "it" ? "Note" : lang === "ja" ? "メモ" : "ملاحظات")}</th></tr></thead><tbody>
  ${pins.filter((p) => p.signed).map((p) => `<tr><td>${p.number}</td><td>${esc(kindName[p.kind] ?? p.kind)}</td><td>${renderNoteHtml(p.note)}</td></tr>`).join("")}
  </tbody></table>
  <h2>${esc(lang === "en" ? "03 Materials" : lang === "it" ? "03 Materiali" : lang === "ja" ? "03 素材" : "03 المواد")}</h2>
  <p>${material ? `${esc(material.name)} ${esc(material.code)} — ${esc(copy.C33)}: ${esc(estimate?.lot ?? "")}` : esc(copy.C40)}</p>
  <h2>${esc(lang === "en" ? "04 Photographs" : lang === "it" ? "04 Foto" : lang === "ja" ? "04 写真" : "04 الصور")}</h2>
  <div class="photos">${photoImages.map((src) => `<img src="${src}">`).join("")}</div>
  <h2>${esc(copy.K1)}</h2>
  <div class="card">${esc(copy.K2)}</div>
  </body></html>`;
  void renderNoteText;
  return renderPdf(html);
}
