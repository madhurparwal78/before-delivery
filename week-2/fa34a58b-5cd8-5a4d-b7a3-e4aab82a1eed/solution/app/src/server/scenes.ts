// The scene catalogue: unique names, one of six tints, a brightness and an optional setpoint.

import { randomUUID } from "node:crypto";
import { TINTS, type Scene, type Tint } from "../shared/types.ts";
import { pool, rows, transaction } from "./db.ts";
import { ApiError, FIELD, FieldErrors } from "./errors.ts";
import { broadcast } from "./socket.ts";

const COLUMNS = "id, name, tint, brightness, setpoint_f";

export async function listScenes(): Promise<Scene[]> {
  return rows<Scene>(pool, `SELECT ${COLUMNS} FROM scenes ORDER BY position`);
}

const isWhole = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

interface SceneFields {
  name: string;
  tint: Tint;
  brightness: number;
  setpoint_f: number | null;
}

function validate(body: unknown): { fields: SceneFields; errors: FieldErrors } {
  const request = (typeof body === "object" && body !== null && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const errors = new FieldErrors();
  const name = typeof request.name === "string" ? request.name.trim() : "";
  if (name.length < 1 || name.length > 40) errors.add("name", FIELD.sceneName);
  if (!TINTS.includes(request.tint as Tint)) errors.add("tint", FIELD.tint);
  if (!isWhole(request.brightness, 0, 100)) errors.add("brightness", FIELD.sceneBrightness);
  const setpoint = request.setpoint_f ?? null;
  if (setpoint !== null && !isWhole(setpoint, 60, 80)) errors.add("setpoint_f", FIELD.setpoint);
  return {
    fields: { name, tint: request.tint as Tint, brightness: request.brightness as number, setpoint_f: setpoint as number | null },
    errors,
  };
}

/** POST /api/scenes and PUT /api/scenes/{id}; a null id creates. */
export async function saveScene(id: string | null, body: unknown): Promise<Scene> {
  const scene = await transaction(async (client) => {
    if (id !== null) {
      const [existing] = await rows<{ id: string }>(client, "SELECT id FROM scenes WHERE id = $1 FOR UPDATE", [id]);
      if (!existing) throw ApiError.of("not_found");
    }
    const { fields, errors } = validate(body);
    await client.query("LOCK TABLE scenes IN SHARE ROW EXCLUSIVE MODE");
    if (!errors.has("name")) {
      const [taken] = await rows<{ id: string }>(
        client, "SELECT id FROM scenes WHERE lower(name) = lower($1) AND id IS DISTINCT FROM $2", [fields.name, id],
      );
      if (taken) errors.add("name", FIELD.sceneNameTaken);
    }
    errors.throwIfAny();
    const values = [fields.name, fields.tint, fields.brightness, fields.setpoint_f];
    const [saved] = id === null
      ? await rows<Scene>(client, `INSERT INTO scenes (id, name, tint, brightness, setpoint_f) VALUES ($5, $1, $2, $3, $4) RETURNING ${COLUMNS}`, [...values, randomUUID()])
      : await rows<Scene>(client, `UPDATE scenes SET name = $1, tint = $2, brightness = $3, setpoint_f = $4 WHERE id = $5 RETURNING ${COLUMNS}`, [...values, id]);
    return saved as Scene;
  });
  broadcast({ type: "scene", scene });
  return scene;
}
