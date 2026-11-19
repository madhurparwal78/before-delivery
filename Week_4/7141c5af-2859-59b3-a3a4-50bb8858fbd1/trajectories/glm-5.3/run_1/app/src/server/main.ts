import express, { type Request, type Response, type NextFunction } from "express";
import { q, q1, applySchema, seedIfEmpty, pool, todayTurin } from "./db.js";
import { HttpError, err, sendError, asyncHandler } from "./http.js";
import { accessRouter } from "./api/access.js";
import { clientsRouter, piecesRouter } from "./api/clients-pieces.js";
import { pinsRouter, photosRouter } from "./api/pins-photos.js";
import { layoutRouter } from "./api/layout.js";
import { materialsRouter, holdsRouter } from "./api/materials.js";
import { estimatesRouter, ratesRouter } from "./api/estimates.js";
import { searchRouter, enquiriesRouter } from "./api/search-enquiries.js";
import { clientPageRouter as clientPageApiRouter, tokenRouter } from "./api/client-page.js";
import { benchRouter } from "./api/bench.js";
import { collectionsRouter } from "./api/collections.js";
import { workbookRouter } from "./api/workbook.js";
import { dossierRouter, renderAndStore } from "./api/dossier.js";
import { assertOrigin, readJsonBody, JSON_LIMIT } from "./request.js";
import { requireSession } from "./session.js";
import { apiMessages } from "./copy.js";
import { s3 } from "./providers/s3.js";
import { meili } from "./providers/meili.js";
import { rebuildIndex, flushPending } from "./sync.js";
import { toCsv } from "./csv.js";
import { config } from "./config.js";
import { sweep } from "./jobs.js";
import { renderPages } from "./pages/index.js";
import { clientPageRouter as clientPageSsrRouter } from "./pages/client-page.js";
import { deskRouter } from "./pages/desk.js";
import { printMinor } from "./decimal.js";

const app = express();
app.disable("x-powered-by");
app.use(express.raw({ type: "multipart/form-data", limit: "12mb" }));
app.use(express.raw({ type: "application/json", limit: "3mb" }));

// Unknown API route: 404 JSON (mounted last for /api).
const api = express.Router();

api.get("/health", (req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// Access
api.use(accessRouter);

// Clients
api.use("/clients", clientsRouter);

// Pieces and nested resources; one router each for clean isolation checks.
api.use("/pieces", piecesRouter);
api.use("/pieces/:pieceId/pins", pinsRouter);
api.use("/pieces/:pieceId/photographs", photosRouter);
api.use("/pieces/:pieceId/layout", layoutRouter);
api.use("/pieces/:pieceId/holds", holdsRouter);
api.use("/pieces/:pieceId/estimates", estimatesRouter);
api.use("/pieces/:pieceId/client-page", clientPageApiRouter);
api.use("/pieces/:pieceId/collections", collectionsRouter);
api.use("/pieces/:pieceId/dossier", dossierRouter);

// Materials, stock
api.use("/materials", materialsRouter);
api.use("/bench-jobs", benchRouter);
api.use("/rates", ratesRouter);
api.use("/search", searchRouter);
api.use("/enquiries", enquiriesRouter);
api.use("/client-pages", tokenRouter);
api.use("/workbook", workbookRouter);

api.get("/materials-list.csv", asyncHandler(async (req: Request, res: Response) => {
  const session = await requireSession(req);
  const rows = await q<{ title: string; client_name: string | null; material: string | null; code: string | null; lot: string | null; hides: number | null; notes: string | null; state: string }>(
    `SELECT p.title, c.name AS client_name, m.name AS material, e.material_code AS code, e.lot, e.hides, p.notes, p.state
     FROM pieces p
     LEFT JOIN clients c ON c.id = p.client_id
     LEFT JOIN LATERAL (
       SELECT material_code, lot, hides FROM estimates
       WHERE piece_id = p.id AND state IN ('open','signedOff')
       ORDER BY version DESC LIMIT 1
     ) e ON true
     LEFT JOIN materials m ON m.desk_id = p.desk_id AND m.code = e.material_code
     WHERE p.desk_id = $1 AND p.state <> 'archived'
     ORDER BY p.title`,
    [session.deskId]
  );
  const table: string[][] = [["piece", "client", "material", "code", "lot", "hides", "notes"]];
  for (const r of rows) {
    table.push([
      r.title,
      r.client_name ?? "",
      r.material ?? "",
      r.code ?? "",
      r.lot ?? "",
      r.hides === null ? "" : String(r.hides),
      r.notes ?? "",
    ]);
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.send(toCsv(table));
}));

// 405 with Allow for wrong methods on piece resources.
api.all("/pieces/:id", (req: Request, res: Response) => {
  const allowed = ["GET", "PATCH"];
  if (!allowed.includes(req.method)) {
    res.status(405).set("Allow", "GET, PATCH").json({ error: { code: "wrongMethod", message: "Method not allowed" } });
    return;
  }
  throw err.unknownRoute();
});

api.use((req: Request, res: Response) => {
  res.status(404).json({ error: { code: "unknownRoute", message: "Page not found" } });
});

app.use("/api", (req: Request, res: Response, next: NextFunction) => {
  // Content type check comes after unknown-resource? No: unknown route first, then this router.
  next();
});
app.use("/api", api);

// Server-rendered pages
app.use("/", clientPageSsrRouter);
app.use("/", deskRouter);
app.use("/", renderPages);

// Error handling
app.use((e: unknown, req: Request, res: Response, next: NextFunction) => {
  void next;
  if (e instanceof HttpError) {
    sendError(res, e);
    return;
  }
  if (res.headersSent) return;
  res.status(500).json({ error: { code: "unavailable", message: "That request could not be read." } });
});

// Body size guard before the JSON parser would buffer endlessly (the raw parser above is unlimited; enforce here).
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.headers["content-type"]?.startsWith("application/json")) {
    const len = Number(req.headers["content-length"] ?? 0);
    if (len > JSON_LIMIT) {
      sendError(res, err.tooLarge(apiMessages.fieldLong(JSON_LIMIT)));
      return;
    }
  }
  next();
});

export async function start(): Promise<void> {
  await applySchema();
  await seedIfEmpty();
  await s3.ensureBucket().catch(() => undefined);
  const healthy = await meili.healthy();
  if (healthy) {
    await meili.ensureIndex().catch(() => undefined);
    await rebuildIndex().catch(() => undefined);
  }
  void flushPending().catch(() => undefined);
  // Advance any seed dossier waiting on an earlier outage.
  const dossiers = await q<{ id: string; piece_id: string; state: string }>("SELECT id, piece_id, state FROM dossiers WHERE state='waiting'");
  for (const d of dossiers) {
    const deskId = await q1<{ desk_id: string }>("SELECT desk_id FROM dossiers WHERE id=$1", [d.id]);
    if (deskId) await renderAndStore(deskId.desk_id, d.piece_id, d.id).catch(() => undefined);
  }
  sweep();
  const port = config.port;
  app.listen(port, "0.0.0.0", () => {
    console.log(`Semenza Desk listening on ${port}`);
  });
}

void readJsonBody;
void assertOrigin;
void printMinor;
void todayTurin;
void pool;

void start().catch((e) => {
  console.error(e);
  process.exit(1);
});

export default app;
