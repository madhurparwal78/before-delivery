import { openCollection, requireWriter } from "../access.js";
import { db, transaction } from "../db.js";
import { asDocument, isDocumentId } from "../engine/document.js";
import { fail } from "../errors.js";
import { route } from "../http.js";
import { deleteDocument, insertDocuments, prepareDocument, readDocument, replaceDocument } from "../store.js";

/** Documents: insert, read, edit with versions, delete. */

const base = "/api/projects/:pid/collections/:cid";

async function existing(collectionId: string, id: string) {
  const stored = isDocumentId(id) ? await readDocument(db, collectionId, id) : null;
  return stored ?? fail("not_found");
}

route("POST", `${base}/documents`, async (ctx) => {
  const { role, collection } = await openCollection(ctx);
  requireWriter(role);
  const input = asDocument(ctx.object()["document"], "document");
  const document = await transaction(async (client) => {
    const prepared = prepareDocument(input, collection);
    await insertDocuments(client, collection.id, [prepared]);
    return prepared;
  });
  return { status: 201, body: { document, version: 1 } };
});

route("GET", `${base}/documents/:did`, async (ctx) => {
  const { collection } = await openCollection(ctx);
  const stored = await existing(collection.id, ctx.params["did"] as string);
  return { status: 200, body: { document: stored.document, version: stored.version } };
});

route("PUT", `${base}/documents/:did`, async (ctx) => {
  const { role, collection } = await openCollection(ctx);
  const id = ctx.params["did"] as string;
  await existing(collection.id, id);
  requireWriter(role);
  const body = ctx.object();
  const version = body["version"];
  if (typeof version !== "number" || !Number.isInteger(version)) fail("invalid_field", { field: "version" });
  const input = asDocument(body["document"], "document");
  const stored = await transaction((client) =>
    replaceDocument(client, collection.id, id, version, () => {
      if (input["_id"] !== undefined && input["_id"] !== id) fail("id_mismatch");
      return prepareDocument({ ...input, _id: id }, collection);
    }),
  );
  return { status: 200, body: { document: stored.document, version: stored.version } };
});

route("DELETE", `${base}/documents/:did`, async (ctx) => {
  const { role, collection } = await openCollection(ctx);
  const id = ctx.params["did"] as string;
  await existing(collection.id, id);
  requireWriter(role);
  await transaction((client) => deleteDocument(client, collection.id, id));
  return { status: 204 };
});
