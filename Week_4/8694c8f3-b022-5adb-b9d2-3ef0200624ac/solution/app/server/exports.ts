import { createHash, randomUUID } from "node:crypto";
import { recordActivity } from "./activity.ts";
import { CAN_EDIT, isUuid, requireMember, requireRole, roleIn } from "./access.ts";
import { assetKey, registerReadyAsset, sniff } from "./assets.ts";
import { exportManifest, readWorkingSet } from "./bundles.ts";
import type { Database } from "./db.ts";
import { rows } from "./db.ts";
import { insertDocument, insertShaderVersion, loadDocument } from "./documents.ts";
import { notFound, storageUnavailable, validation, writeJson } from "./errors.ts";
import type { Router } from "./http.ts";
import { requireUser } from "./http.ts";
import type { ImportedAsset } from "./importer.ts";
import { buildImportedDocument } from "./importer.ts";
import type { Storage } from "./storage.ts";
import { StorageDown } from "./storage.ts";
import type { ZipEntry } from "./zip.ts";
import { readZip, writeZip } from "./zip.ts";
import { isRecord } from "../shared/schema.ts";
import type { AssetKind } from "../shared/types.ts";

const NOT_EXPORT = "Not an Afterglass export";

const exportKey = (setId: string, exportId: string): string => `sets/${setId}/exports/${exportId}.zip`;

export class Exports {
  private readonly db: Database;
  private readonly storage: Storage;

  constructor(db: Database, storage: Storage) {
    this.db = db;
    this.storage = storage;
  }

  private async guardStorage<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof StorageDown) throw storageUnavailable();
      throw error;
    }
  }

  register(router: Router): void {
    router.add("POST", "/api/sets/:id/exports", {}, async (ctx) => {
      const membership = await requireMember(this.db, ctx);
      requireRole(membership, CAN_EDIT);
      const user = requireUser(ctx);
      const workingSet = await readWorkingSet(this.db, membership.setId, membership.role);
      const manifest = exportManifest(workingSet);
      const entries: ZipEntry[] = [{ name: "set.json", bytes: Buffer.from(JSON.stringify(manifest), "utf8") }];
      const exportId = randomUUID();
      const bytes = await this.guardStorage(async () => {
        for (const asset of workingSet.assets.filter((candidate) => candidate.status === "ready")) {
          const stored = await this.storage.get(assetKey(membership.setId, asset.id));
          if (!stored) throw new StorageDown("asset object is missing");
          entries.push({ name: `assets/${asset.id}`, bytes: stored });
        }
        const zip = writeZip(entries);
        await this.storage.putConfirmed(exportKey(membership.setId, exportId), zip, "application/zip");
        return zip;
      });
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      await this.db.transaction(async (tx) => {
        await tx.query("INSERT INTO exports (id, set_id, sha256, size, created_by) VALUES ($1,$2,$3,$4,$5)", [exportId, membership.setId, sha256, bytes.length, user.id]);
        await recordActivity(tx, membership.setId, user.id, "set.export", exportId, `Exported ${workingSet.doc.set.name}`);
      });
      writeJson(ctx.res, 201, { export: { id: exportId, sha256, size: bytes.length, download_url: `/api/exports/${exportId}/download` } });
    });

    router.add("GET", "/api/exports/:exportId/download", {}, async (ctx) => {
      const user = requireUser(ctx);
      const exportId = ctx.params["exportId"] ?? "";
      const [found] = isUuid(exportId)
        ? await rows<{ set_id: string; sha256: string; name: string }>(this.db, 
          "SELECT e.set_id, e.sha256, s.name FROM exports e JOIN sets s ON s.id = e.set_id WHERE e.id = $1", [exportId])
        : [];
      if (!found || !(await roleIn(this.db, found.set_id, user.id))) throw notFound();
      const bytes = await this.guardStorage(async () => {
        const stored = await this.storage.get(exportKey(found.set_id, exportId));
        if (!stored) throw notFound();
        return stored;
      });
      const slug = found.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      ctx.res.writeHead(200, {
        "content-type": "application/zip", "content-length": bytes.length, "X-Content-SHA256": found.sha256,
        "content-disposition": `attachment; filename="${slug}.afterglass.zip"`,
      });
      ctx.res.end(bytes);
    });

    router.add("POST", "/api/sets/import", { body: "import" }, async (ctx) => {
      const user = requireUser(ctx);
      const upload = ctx.form?.file;
      if (!upload) throw validation({ file: NOT_EXPORT });
      const importId = randomUUID();
      await this.guardStorage(() => this.storage.putConfirmed(`imports/${importId}.zip`, upload.bytes, "application/zip"));
      const entries = readZip(upload.bytes);
      const manifestEntry = entries?.find((entry) => entry.name === "set.json");
      let manifest: unknown = null;
      try {
        manifest = manifestEntry ? JSON.parse(manifestEntry.bytes.toString("utf8")) : null;
      } catch {
        manifest = null;
      }
      if (!entries || !isRecord(manifest) || manifest["format"] !== "afterglass-export/1") throw validation({ file: NOT_EXPORT });
      const files = new Map(entries.map((entry) => [entry.name, entry.bytes]));
      const assets: ImportedAsset[] = [];
      const payloads = new Map<string, { bytes: Buffer; contentType: string; sha256: string }>();
      for (const raw of Array.isArray(manifest["assets"]) ? manifest["assets"] : []) {
        const kind: AssetKind | null = isRecord(raw) && raw["kind"] === "model" ? "model" : isRecord(raw) && raw["kind"] === "texture" ? "texture" : null;
        const oldId = isRecord(raw) && typeof raw["id"] === "string" ? raw["id"] : "";
        const bytes = files.get(`assets/${oldId}`);
        const contentType = kind && bytes ? sniff(kind, bytes) : null;
        if (!isRecord(raw) || !kind || !bytes || !contentType) throw validation({ file: NOT_EXPORT });
        const asset = { oldId, newId: randomUUID(), name: typeof raw["name"] === "string" ? raw["name"].slice(0, 80) : "asset", kind };
        assets.push(asset);
        payloads.set(asset.newId, { bytes, contentType, sha256: createHash("sha256").update(bytes).digest("hex") });
      }
      const original = isRecord(manifest["set"]) && typeof manifest["set"]["name"] === "string" ? manifest["set"]["name"] : "";
      const built = buildImportedDocument(manifest, `${original} (imported)`, assets);
      if (!built || original.length < 1 || built.doc.set.name.length > 80) throw validation({ file: NOT_EXPORT });
      const { doc } = built;
      const stored: string[] = [];
      try {
        await this.guardStorage(async () => {
          for (const asset of assets) {
            const payload = payloads.get(asset.newId);
            if (!payload) continue;
            await this.storage.putConfirmed(assetKey(doc.set.id, asset.newId), payload.bytes, payload.contentType);
            stored.push(assetKey(doc.set.id, asset.newId));
          }
        });
        await this.db.transaction(async (tx) => {
          await insertDocument(tx, doc, user.id);
          for (const asset of assets) {
            const payload = payloads.get(asset.newId);
            if (!payload) continue;
            await registerReadyAsset(tx, { id: asset.newId, setId: doc.set.id, name: asset.name, kind: asset.kind, ...payload });
          }
          for (const version of built.shaderVersions) {
            await insertShaderVersion(tx, { layerId: version.layerId, setId: doc.set.id, number: version.number, source: version.source, authorId: user.id, restoredFrom: version.restoredFrom });
          }
          await recordActivity(tx, doc.set.id, user.id, "set.import", importId, `Imported ${original}`);
        });
      } catch (error) {
        await Promise.all(stored.map((key) => this.storage.remove(key).catch(() => undefined)));
        throw error;
      }
      writeJson(ctx.res, 201, await loadDocument(this.db, doc.set.id, "owner"));
    });
  }
}
