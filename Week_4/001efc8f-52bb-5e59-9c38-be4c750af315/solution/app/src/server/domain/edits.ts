import { now } from "../clock.js";
import { one, pool, tx } from "../db.js";
import { ApiError, FIELD, invalid, type FieldErrors } from "../errors.js";
import { logEvents } from "../events.js";
import type { Body, Viewer } from "../http.js";
import { EDIT_FIELDS, unacceptedKeys } from "./acceptedFields.js";
import { messageEvents } from "./fanout.js";
import { loadMessage, visibleMessage, type MessageJson } from "./messages.js";
import { moderates } from "./roles.js";
import { TEXT_LIMIT } from "./send.js";

// Edits: the author, or a crew lead / dispatcher / operations manager, within the edit window
// judged by the app clock, against the current version.
export async function editMessage(viewer: Viewer, id: string, body: Body): Promise<MessageJson> {
  const access = await visibleMessage(pool, viewer, id);
  if (access.author_id !== viewer.id && !moderates(viewer.role)) throw new ApiError("forbidden");
  const value = body.kind === "json" && typeof body.value === "object" && body.value !== null && !Array.isArray(body.value) ? (body.value as Record<string, unknown>) : null;
  if (!value) throw invalid({});

  return tx(async (client) => {
    const row = await visibleMessage(client, viewer, id, { forUpdate: true });
    const expected = value.expected_version;
    const wholeNumber = typeof expected === "number" && Number.isInteger(expected);
    if (wholeNumber && expected !== row.version) {
      const current = await one<{ version: number; text: string; editor_id: string; editor_name: string; created_at: Date }>(
        client,
        `SELECT v.version, v.text, u.id AS editor_id, u.name AS editor_name, v.created_at
           FROM message_versions v JOIN users u ON u.id = v.edited_by WHERE v.message_id = $1 AND v.version = $2`,
        [row.id, row.version],
      );
      throw new ApiError("stale_version", {
        extra: {
          current: {
            version: current?.version ?? row.version,
            text: current?.text ?? row.text,
            edited_by: { id: current?.editor_id ?? "", name: current?.editor_name ?? "" },
            edited_at: current?.created_at.toISOString() ?? null,
          },
        },
      });
    }
    const at = now();
    if (at.getTime() >= row.editable_until.getTime()) throw new ApiError("edit_window_closed");

    const fieldErrors: FieldErrors = {};
    const text = typeof value.text === "string" ? value.text.trim() : null;
    const hasPhotos = await one(client, "SELECT 1 FROM attachments WHERE message_id = $1 AND state = 'stored'", [row.id]);
    if (text === null || (text === "" && !hasPhotos)) fieldErrors.text = FIELD.textEmpty;
    else if ([...text].length > TEXT_LIMIT) fieldErrors.text = FIELD.textLong;
    if (!wholeNumber) fieldErrors.expected_version = FIELD.expectedVersion;
    const keys = Object.keys(value);
    const unaccepted = unacceptedKeys(keys, EDIT_FIELDS);
    const errors: FieldErrors = {};
    for (const key of keys) {
      const copy = unaccepted[key] ?? fieldErrors[key];
      if (copy) errors[key] = copy;
    }
    for (const [key, copy] of Object.entries(fieldErrors)) if (!(key in errors)) errors[key] = copy;
    if (Object.keys(errors).length > 0) throw invalid(errors);

    const version = row.version + 1;
    await client.query("INSERT INTO message_versions (message_id, version, text, edited_by, created_at) VALUES ($1, $2, $3, $4, $5)", [
      row.id, version, text, viewer.id, at,
    ]);
    await client.query("UPDATE messages SET text = $2, version = $3, edited_at = $4 WHERE id = $1", [row.id, text, version, at]);
    await logEvents(client, () => messageEvents(client, "message.updated", row.workspace_id, row.channel_id, [row.id]));
    return loadMessage(client, row.id);
  });
}
