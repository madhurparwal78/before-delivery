import { today } from "./clock.js";
import { db } from "./db.js";
import { notFound, validation } from "./errors.js";
import { json, route } from "./http.js";
import { copyId, metaNumber } from "./meta.js";
import { searchState } from "./meili.js";
import { correctNotice, createDraft, draftViewById, listDrafts, previewCorrection, previewDraft, publishDraft, retryPrint, saveDraft } from "./notices.js";
import { loadBook } from "./pricing.js";
import { providers } from "./status.js";
import { draftFromSheet, getSheet, importSheet, listSheets, settleRow, sheetLink } from "./sheets.js";
import { registerBatch, renameDrink, renameSku, skuHistory } from "./catalogue_edit.js";
import { counts, loadNotices, withStates } from "./views.js";

const editor = { auth: "editor" } as const;
const editorJson = { auth: "editor", body: "json" } as const;

route("GET", "/api/editor/notices", editor, async () => {
  const book = await loadBook(db);
  const day = today();
  return json(200, {
    copyId: await copyId(), messagesQueued: !providers.svix, workQueued: !providers.broker, searchState: await searchState(),
    heldWork: await metaNumber("held_work"), counts: counts(book, day), drafts: await listDrafts(db, book),
    notices: withStates(await loadNotices(db), day),
  });
});

route("POST", "/api/editor/notices", editorJson, async (ctx) => json(201, await createDraft(ctx.body)));
route("PUT", "/api/editor/notices/:id", editorJson, async (ctx) => json(200, await saveDraft(ctx.params[0]!, ctx.body)));
route("POST", "/api/editor/notices/:id/preview", editorJson, async (ctx) => json(200, await previewDraft(ctx.params[0]!, ctx.body)));
route("POST", "/api/editor/notices/:id/publish", editorJson, async (ctx) => json(200, await publishDraft(ctx.params[0]!, ctx.body)));
route("POST", "/api/editor/notices/:number/corrections", editorJson, async (ctx) => json(201, await correctNotice(ctx.params[0]!, ctx.body)));
route("POST", "/api/editor/notices/:number/corrections/preview", editorJson, async (ctx) => json(200, await previewCorrection(ctx.params[0]!, ctx.body)));
route("POST", "/api/editor/notices/:number/versions/:version/print", editorJson, async (ctx) => {
  const version = Number(ctx.params[1]);
  if (!Number.isInteger(version)) throw notFound();
  await retryPrint(ctx.params[0]!, version);
  return json(202, { printState: "pending" });
});

route("PATCH", "/api/editor/drinks/:id", editorJson, async (ctx) => json(200, await renameDrink(ctx.params[0]!, ctx.body)));
route("PATCH", "/api/editor/skus/:code", editorJson, async (ctx) => json(200, await renameSku(ctx.params[0]!, ctx.body)));
route("GET", "/api/editor/skus/:code/history", editor, async (ctx) => json(200, { history: await skuHistory(ctx.params[0]!) }));
route("POST", "/api/editor/batches", editorJson, async (ctx) => json(201, await registerBatch(ctx.body)));

route("POST", "/api/editor/price-sheets", { auth: "editor", body: "upload" }, async (ctx) => {
  if (!ctx.upload) throw validation({ file: "Send the price sheet in the file field." });
  const { status, sheet } = await importSheet(ctx.upload);
  return json(status, { sheet });
});
route("GET", "/api/editor/price-sheets", editor, async () => json(200, { sheets: await listSheets() }));
route("GET", "/api/editor/price-sheets/:id", editor, async (ctx) => json(200, { sheet: await getSheet(ctx.params[0]!) }));
route("GET", "/api/editor/price-sheets/:id/link", editor, async (ctx) => json(200, await sheetLink(ctx.params[0]!)));
route("GET", "/api/editor/price-sheets/:id/download", editor, async (ctx) => ({ status: 302, headers: { location: (await sheetLink(ctx.params[0]!)).url } }));
route("POST", "/api/editor/price-sheets/:id/rows/:row/settle", editorJson, async (ctx) => {
  const row = Number(ctx.params[1]);
  if (!Number.isInteger(row)) throw notFound();
  return json(200, { sheet: await settleRow(ctx.params[0]!, row, ctx.body) });
});
route("POST", "/api/editor/price-sheets/:id/draft", editorJson, async (ctx) => {
  const id = await draftFromSheet(ctx.params[0]!, ctx.body);
  return json(201, await draftViewById(db, await loadBook(db), id));
});
