import { validationError } from "./errors.js";
import { route, type Reply, type Route } from "./http.js";
import { shrinkPhoto } from "./images.js";
import { SHRINK_WIDTHS } from "./pixels.js";
import { readDailyPull } from "./pull.js";
import { appendStop, createReel, findReel, listReels, readReel, reorderStops } from "./reels.js";
import {
  captureReference, changeSwatch, editReference, findReference, listLibrary, listTrash,
  readPhoto, restoreReference, searchLibrary, toReference, trashReference,
} from "./references.js";
import { currentStatus } from "./services.js";
import { readSettings, saveHomeZone, saveUnit } from "./settings.js";
import { listSheets, readSheet, readSheetPdf, requestSheet, retrySheet } from "./sheets.js";

const ok = (json: unknown, status = 200): Reply => ({ status, json });

/** The capture's text fields and photo bytes; a request without a multipart body has neither. */
async function formFields(form: FormData | null): Promise<{ fields: Record<string, string>; photo: Buffer | null }> {
  const fields: Record<string, string> = {};
  let photo: Buffer | null = null;
  for (const [name, value] of form?.entries() ?? []) {
    if (name === "photo" && typeof value !== "string") photo = Buffer.from(await value.arrayBuffer());
    else if (typeof value === "string") fields[name] = value;
  }
  return { fields, photo };
}

const filtersOf = (search: URLSearchParams) => ({
  colour_family: search.get("colour_family") || undefined,
  material: search.get("material") || undefined,
  finish: search.get("finish") || undefined,
});

export const routes: Route[] = [
  route("GET", "/api/status", "none", async () => ok(currentStatus())),

  route(
    "POST",
    "/api/references",
    "multipart",
    async ({ form }) => ok(await captureReference(await formFields(form)), 201),
    {
      content: async ({ form }) => {
        const { fields, photo } = await formFields(form);
        return [photo ?? "", ...Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => `${name}=${value}`)];
      },
    },
  ),
  route("GET", "/api/references", "none", async ({ search }) => ok(await listLibrary(filtersOf(search)))),
  route("GET", "/api/references/:id", "none", async ({ params }) => ok(toReference(await findReference(params.id)))),
  route("PATCH", "/api/references/:id", "json", async ({ params, json }) => ok(await editReference(params.id, json))),
  route("DELETE", "/api/references/:id", "none", async ({ params }) => ok(await trashReference(params.id))),
  route("POST", "/api/references/:id/restore", "none", async ({ params }) => ok(await restoreReference(params.id))),
  route("POST", "/api/references/:id/swatch", "json", async ({ params, json }) => ok(await changeSwatch(params.id, { x: json.x, y: json.y }))),
  route("DELETE", "/api/references/:id/swatch", "none", async ({ params }) => ok(await changeSwatch(params.id, null))),
  route("GET", "/api/references/:id/original", "none", async ({ params }) => photoReply(await readPhoto(params.id, "original"))),
  route("GET", "/api/references/:id/display", "none", async ({ params, search }) => {
    const photo = await readPhoto(params.id, "display");
    const width = SHRINK_WIDTHS.find((served) => String(served) === search.get("w"));
    return photoReply(width ? { ...photo, bytes: await shrinkPhoto(params.id, photo.bytes, width) } : photo);
  }),

  route("GET", "/api/trash", "none", async () => ok(await listTrash())),
  route("GET", "/api/search", "none", async ({ search }) => {
    const text = search.get("q") ?? "";
    if (Array.from(text).length > 200) throw validationError({ q: "Keep the search to 200 characters or fewer." });
    return ok(await searchLibrary(text, filtersOf(search)));
  }),

  route("GET", "/api/reels", "none", async () => ok({ reels: await listReels() })),
  route("POST", "/api/reels", "json", async ({ json }) => ok(await createReel(json.name), 201)),
  route("GET", "/api/reels/:id", "none", async ({ params }) => ok(await readReel(params.id))),
  route("POST", "/api/reels/:id/stops", "json", async ({ params, json }) => ok(await appendStop(params.id, json.reference_id))),
  route("PUT", "/api/reels/:id/stops", "json", async ({ params, json }) => ok(await reorderStops(params.id, json.version, json.reference_ids))),
  route(
    "POST",
    "/api/reels/:id/sheets",
    "json",
    async ({ params, json }) => ok(await requestSheet(params.id, json.paper, json.unit), 202),
    {
      resource: async ({ params }) => {
        await findReel(params.id);
      },
      content: async ({ json }) => [JSON.stringify({ paper: json.paper, unit: json.unit })],
    },
  ),
  route("GET", "/api/reels/:id/sheets", "none", async ({ params }) => ok({ sheets: await listSheets(params.id) })),
  route("GET", "/api/sheets/:id", "none", async ({ params }) => ok(await readSheet(params.id))),
  route("POST", "/api/sheets/:id/retry", "none", async ({ params }) => ok(await retrySheet(params.id), 202)),
  route("GET", "/api/sheets/:id/pdf", "none", async ({ params }) => ({
    status: 200,
    bytes: await readSheetPdf(params.id),
    contentType: "application/pdf",
  })),

  route("GET", "/api/daily-pull", "none", async () => ok(await readDailyPull())),
  route("GET", "/api/settings", "none", async () => ok(await readSettings())),
  route("PUT", "/api/settings/home-zone", "json", async ({ json }) => ok(await saveHomeZone(json.zone))),
  route("PUT", "/api/settings/unit", "json", async ({ json }) => ok(await saveUnit(json.unit))),
];

function photoReply({ bytes, contentType }: { bytes: Buffer; contentType: string }): Reply {
  return { status: 200, bytes, contentType, headers: { "cache-control": "private, max-age=300" } };
}
