// Players' folders: only published folders of their own chair, decided from stored data on every request.
import { folderVisibleTo } from "../access.js";
import { pool } from "../db.js";
import { notFound } from "../errors.js";
import { route } from "../http.js";
import { authenticate, requireRole } from "../people.js";
import { barInCut, loadProgrammes, loadScans, overlaps, pad2 } from "../readModel.js";
import { londonTimestamp } from "../../shared/london.js";
import { storageUp } from "../scoreStore.js";
function chairParts(model, person) {
    return model.works.flatMap((work) => work.parts.filter((part) => part.chair_key === person.seat?.key).map((part) => ({ work, part })));
}
function pagesOf(model, person, scans) {
    return chairParts(model, person).map(({ work, part }) => {
        const cuts = work.cuts.filter((cut) => overlaps(part, cut));
        const scan = scans.find((s) => s.part_id === part.id && s.kind === "marked_part");
        return {
            part_id: part.id,
            work_id: work.row.id,
            work_title: work.row.title,
            composer: work.row.composer,
            part_name: part.name,
            bars_from: part.bars_from,
            bars_to: part.bars_to,
            cuts: cuts.map(({ from_bar, to_bar }) => ({ from_bar, to_bar })),
            rehearsal_letters: work.letters
                .filter((l) => l.bar >= part.bars_from && l.bar <= part.bars_to)
                .filter((l) => !barInCut(work, l.bar))
                .map(({ letter, bar }) => ({ letter, bar })),
            marked_scan: scan ? { id: scan.id, file_name: scan.file_name, content_type: scan.content_type, size_bytes: scan.size_bytes } : null,
        };
    });
}
async function visibleFolder(person, programmeId) {
    const [model] = await loadProgrammes(pool, [programmeId]);
    if (!model || !folderVisibleTo(person, model))
        throw notFound();
    return model;
}
async function scansOf(model, person) {
    return loadScans(pool, chairParts(model, person).map(({ part }) => part.id));
}
route("GET", "/api/folders", "none", async (request) => {
    const person = await authenticate(pool, request);
    requireRole(person, "SY");
    const models = (await loadProgrammes(pool, null)).filter((model) => folderVisibleTo(person, model));
    return {
        status: 200,
        json: {
            folders: models.map((model) => ({
                programme_id: model.row.id,
                number: pad2(model.row.number),
                title: model.row.title,
                status: model.row.status,
                first_rehearsal: londonTimestamp(model.row.first_rehearsal),
                chair_label: person.chair?.label ?? "",
                part_count: chairParts(model, person).length,
            })),
        },
    };
});
route("GET", "/api/folders/{programmeId}", "none", async (request) => {
    const person = await authenticate(pool, request);
    const model = await visibleFolder(person, request.params.programmeId ?? "");
    requireRole(person, "SY");
    const [scans, available] = await Promise.all([scansOf(model, person), storageUp()]);
    return {
        status: 200,
        json: {
            programme: {
                id: model.row.id,
                number: pad2(model.row.number),
                title: model.row.title,
                status: model.row.status,
                first_rehearsal: londonTimestamp(model.row.first_rehearsal),
            },
            chair: person.chair,
            scans_available: available,
            pages: pagesOf(model, person, scans),
        },
    };
});
route("GET", "/api/folders/{programmeId}/parts/{partId}", "none", async (request) => {
    const person = await authenticate(pool, request);
    const model = await visibleFolder(person, request.params.programmeId ?? "");
    const page = pagesOf(model, person, await scansOf(model, person)).find((p) => p.part_id === request.params.partId);
    if (!page)
        throw notFound();
    requireRole(person, "SY");
    return { status: 200, json: page };
});
