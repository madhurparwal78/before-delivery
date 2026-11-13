// Measurement jobs: the worker that measures stored GLBs once, the range check, unit scales and delayed-job retries.
import { one, pool, rows, transaction } from "../db.js";
import { consumeMeasurements, publishMeasurement } from "../queue.js";
import { getObjectBytes } from "../storage.js";
import { measureGltf } from "./glb.js";
export const UNIT_SCALES = { as_exported: 1, mm: 0.001, cm: 0.01, in: 0.0254 };
const RANGE_MAX_M = 5;
const RANGE_MIN_M = 0.005;
const MAX_FAILURES = 2;
const FOREIGN_REQUEUE_MS = 150;
/** A largest dimension over 5 m or under 5 mm needs the client's unit decision; exactly either edge is in range. */
export function needsUnitDecision(metres) {
    const largest = Math.max(metres.x, metres.y, metres.z);
    return largest > RANGE_MAX_M || largest < RANGE_MIN_M;
}
/** Millimetres = metres × unit scale × 1000. */
export function scaledDimensions(metres, unit) {
    const factor = UNIT_SCALES[unit] * 1000;
    return { x: metres.x * factor, y: metres.y * factor, z: metres.z * factor };
}
/** Reads only the stored object's header and JSON chunk; measurement never needs the binary chunk. */
async function readStoredGltf(key) {
    const header = await getObjectBytes(key, { start: 0, end: 19 });
    if (header.length < 20)
        return null;
    const jsonLength = header.readUInt32LE(12);
    const json = await getObjectBytes(key, { start: 20, end: 20 + jsonLength - 1 });
    try {
        return JSON.parse(json.toString("utf8"));
    }
    catch {
        return null;
    }
}
async function handle(delivery) {
    const job = delivery.job;
    if (!job)
        return delivery.ack();
    const file = await one(pool, "SELECT id, engagement_id, extension, measurement, measurement_failures AS failures FROM intake_files WHERE id::text = $1 AND kind = 'model'", [job.intake_file_id]).catch(() => null);
    if (!file) {
        // Another instance's database owns this file.
        setTimeout(() => delivery.requeue(), FOREIGN_REQUEUE_MS);
        return;
    }
    if (file.measurement === "measured" || file.measurement === "failed")
        return delivery.ack();
    let doc;
    try {
        doc = await readStoredGltf(`intake/${file.engagement_id}/${file.id}.${file.extension}`);
    }
    catch {
        // Storage is not reachable from this instance; no failure is counted.
        setTimeout(() => delivery.requeue(), FOREIGN_REQUEUE_MS);
        return;
    }
    const dimensions = doc ? measureGltf(doc) : null;
    const outcome = await transaction(async (client) => {
        const locked = await one(client, "SELECT id, measurement, measurement_failures AS failures FROM intake_files WHERE id = $1 FOR NO KEY UPDATE", [file.id]);
        if (!locked || locked.measurement === "measured" || locked.measurement === "failed")
            return "done";
        if (dimensions) {
            await client.query("INSERT INTO measurements (intake_file_id, x_m, y_m, z_m, outcome) VALUES ($1, $2, $3, $4, 'measured') ON CONFLICT DO NOTHING", [
                file.id,
                dimensions.x,
                dimensions.y,
                dimensions.z,
            ]);
            await client.query("UPDATE intake_files SET measurement = 'measured', unit_decision = $2 WHERE id = $1", [file.id, needsUnitDecision(dimensions) ? null : "as_exported"]);
            return "done";
        }
        const failures = locked.failures + 1;
        if (failures < MAX_FAILURES) {
            await client.query("UPDATE intake_files SET measurement_failures = $2 WHERE id = $1", [file.id, failures]);
            return "retry";
        }
        await delivery.deadLetter();
        await client.query("UPDATE intake_files SET measurement_failures = $2, measurement = 'failed' WHERE id = $1", [file.id, failures]);
        await client.query("INSERT INTO measurements (intake_file_id, outcome) VALUES ($1, 'failed') ON CONFLICT DO NOTHING", [file.id]);
        return "dead";
    });
    if (outcome === "done")
        delivery.ack();
    else if (outcome === "retry")
        delivery.requeue();
}
/** Delayed jobs (queue was down at upload) are claimed and published again; a failed publish puts them back. */
async function republishDelayed() {
    const delayed = await rows(pool, "SELECT id FROM intake_files WHERE measurement = 'delayed' ORDER BY created_at LIMIT 50");
    for (const { id } of delayed) {
        const claimed = await one(pool, "UPDATE intake_files SET measurement = 'pending' WHERE id = $1 AND measurement = 'delayed' RETURNING id", [id]);
        if (!claimed)
            continue;
        try {
            await publishMeasurement({ intake_file_id: id });
        }
        catch {
            await pool.query("UPDATE intake_files SET measurement = 'delayed' WHERE id = $1 AND measurement = 'pending'", [id]);
            return;
        }
    }
}
export function startMeasurementWorker() {
    consumeMeasurements(handle);
    setInterval(() => void republishDelayed().catch(() => undefined), 5_000).unref();
}
