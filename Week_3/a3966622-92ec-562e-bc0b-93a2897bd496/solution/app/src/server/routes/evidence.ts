// Evidence: ladder photos and vessel pilot cards, checked against their declared type before
// anything reaches the store, stored and served byte for byte with their SHA-256.
import { createHash, randomBytes } from "node:crypto";
import { mayReadMove, readableMove, readableReport, readableVessel, requireCrew, requireRole } from "../access.js";
import type { App } from "../app.js";
import { fileLadderReport, reportView } from "../domain/ladder.js";
import { contentMismatch, forbidden, invalid, notFound, payloadTooLarge, storageUnavailable, unsupportedType } from "../errors.js";
import { created, ok, readBody, type Reply, type Router, type SignedIn } from "../http.js";
import { keyed } from "../idempotency.js";
import { ProviderError } from "../providers/providerError.js";
import type { PhotoRecord } from "../store.js";
import { objectBody } from "../validate.js";

const PHOTO_LIMIT = 5_000_000;
const CARD_LIMIT = 10_000_000;

const SIGNATURES: Record<string, (data: Buffer) => boolean> = {
  "image/jpeg": (d) => d.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])),
  "image/png": (d) => d.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (d) => d.subarray(0, 4).toString("latin1") === "RIFF" && d.subarray(8, 12).toString("latin1") === "WEBP",
  "application/pdf": (d) => d.subarray(0, 5).toString("latin1") === "%PDF-",
};

/** Reads an upload in the published order: 413, 415 for the declared type, 422 empty, 415 content mismatch. */
async function upload(request: SignedIn, types: string[], limit: number): Promise<{ data: Buffer; type: string }> {
  if (Number(request.raw.headers["content-length"] ?? 0) > limit) throw payloadTooLarge();
  const type = (request.raw.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!types.includes(type)) throw unsupportedType();
  const data = await readBody(request.raw, limit);
  if (data.length === 0) throw invalid({ body: "The file is empty" });
  if (!SIGNATURES[type]?.(data)) throw contentMismatch();
  return { data, type };
}

const sha256 = (data: Buffer): string => createHash("sha256").update(data).digest("hex");

export function evidenceRoutes(router: Router, app: App): void {
  const { store } = app;

  /** Writes to the store; nothing is recorded unless the store confirmed the write. */
  const stored = async (key: string, data: Buffer, type: string): Promise<void> => {
    try {
      await app.objects.put(key, data, type);
    } catch (error) {
      if (error instanceof ProviderError) throw storageUnavailable();
      throw error;
    }
  };

  const download = async (key: string, checksum: string, type: string, filename: string): Promise<Reply> => {
    try {
      const data = await app.objects.get(key);
      return {
        status: 200,
        bytes: data,
        headers: {
          "Content-Type": type,
          "X-Checksum-Sha256": checksum,
          "Content-Disposition": `inline; filename="${filename}"`,
          "Cache-Control": "private, no-store",
        },
      };
    } catch (error) {
      if (error instanceof ProviderError) throw storageUnavailable();
      throw error;
    }
  };

  router.add(
    "POST",
    "/api/moves/:ref/photos",
    async (request) => {
      const move = readableMove(store, request.user, request.params.ref ?? "");
      requireCrew(request.user, move);
      const { data, type } = await upload(request, ["image/jpeg", "image/png", "image/webp"], PHOTO_LIMIT);
      const id = `PH-${randomBytes(8).toString("hex")}`;
      const key = `ladder-photos/${id}`;
      const checksum = sha256(data);
      await stored(key, data, type);
      store.photos.put({ id, move_ref: move.ref, uploader_id: request.user.id, sha256: checksum, size_bytes: data.length, content_type: type, key });
      return created({ photo_id: id, sha256: checksum, size_bytes: data.length, key });
    },
    true,
  );

  /** The uploader, or once claimed, anyone who may read a report claiming it. */
  const readablePhoto = (request: SignedIn, id: string): PhotoRecord => {
    const photo = store.photos.get(id);
    if (!photo) throw notFound();
    if (photo.uploader_id === request.user.id) return photo;
    const move = store.moves.get(photo.move_ref);
    const claimed = store.ladderReports.by("move_ref", photo.move_ref).some((r) => r.photo_ids.includes(id));
    if (!move || !claimed || !mayReadMove(request.user, move)) throw notFound();
    return photo;
  };

  router.add("GET", "/api/photos/:id/content", (request) => {
    const photo = readablePhoto(request, request.params.id ?? "");
    const extension = photo.content_type.split("/")[1] ?? "bin";
    return download(photo.key, photo.sha256, photo.content_type, `${photo.id}.${extension}`);
  });

  router.add("POST", "/api/moves/:ref/ladder-reports", (request) => {
    const move = readableMove(store, request.user, request.params.ref ?? "");
    const ids = objectBody(request.body).photo_ids ?? [];
    const photos = (Array.isArray(ids) ? ids : []).map((id) => {
      const photo = typeof id === "string" ? store.photos.get(id) : null;
      if (!photo || photo.move_ref !== move.ref) throw notFound();
      return photo;
    });
    requireCrew(request.user, move);
    return keyed(store, request, () => {
      const current = store.moves.get(move.ref) ?? move;
      return created(reportView(app, fileLadderReport(app, request.user, current, photos, request.body, Date.now())));
    });
  });

  router.add("GET", "/api/ladder-reports/:id", ({ user, params }) => ok(reportView(app, readableReport(store, user, params.id ?? ""))));

  router.add(
    "POST",
    "/api/vessels/:id/pilot-cards",
    async (request) => {
      const vessel = readableVessel(store, request.user, request.params.id ?? "");
      requireRole(request.user, "agent", "dispatcher");
      const { data, type } = await upload(request, ["application/pdf"], CARD_LIMIT);
      const seq = store.next("pilot-card");
      const id = `PC-${randomBytes(8).toString("hex")}`;
      const key = `pilot-cards/${vessel.id}/${id}.pdf`;
      const checksum = sha256(data);
      await stored(key, data, type);
      store.pilotCards.put({ id, seq, vessel_id: vessel.id, sha256: checksum, size_bytes: data.length, key });
      return created({ card_id: id, sha256: checksum, size_bytes: data.length, key });
    },
    true,
  );

  router.add("GET", "/api/vessels/:id/pilot-cards/:card/content", (request) => {
    const { user } = request;
    const vessel = readableVessel(store, user, request.params.id ?? "");
    const card = store.pilotCards.get(request.params.card ?? "");
    if (!card || card.vessel_id !== vessel.id) throw notFound();
    const assigned =
      user.role === "pilot" &&
      store.moves.all().some((m) => m.vessel.id === vessel.id && m.pilot_id === user.id);
    if (!(user.role === "agent" || user.role === "dispatcher" || assigned)) throw forbidden();
    return download(card.key, card.sha256, "application/pdf", `${vessel.name} pilot card.pdf`);
  });
}
