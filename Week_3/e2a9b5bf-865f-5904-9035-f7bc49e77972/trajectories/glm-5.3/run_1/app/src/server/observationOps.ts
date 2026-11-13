// Observation changes: create, update, sketch.put and delete, with
// field-level conflict resolution in one place (DP-22, DP-65, DP-87, DP-50).
import type { Pool, PoolClient } from "pg";
import type { SyncChange } from "#shared/api.js";
import type { ConflictReport, ResolvableField } from "#shared/conflicts.js";
import { incomingWins } from "#shared/conflicts.js";
import { fieldMessages } from "#shared/messages.js";
import { eveningDateFor, localHHMM, observedAtWithinSession, parseInputTime, utcOffset, EDIT_FUTURE_TOLERANCE_SECONDS } from "#shared/time.js";
import { makePair } from "#shared/pair.js";
import { ApiError } from "./errors.js";
import { OBSERVATION_SELECT, observationFromRow, type ObservationRow } from "./rows.js";
import type { StorageClient } from "./services/storage.js";

export interface AppliedField {
  readonly field: ResolvableField;
  readonly value: unknown;
  readonly editedEpochMs: number;
  readonly editedText: string;
}

export interface FieldResolutionOutcome {
  readonly appliedFields: readonly AppliedField[];
  readonly reports: readonly ConflictReport[];
  readonly anyApplied: boolean;
  readonly errors: Partial<Record<string, string>>;
}

export interface FieldEdit { readonly edited_at: string; readonly edited_epoch_ms: number; readonly device: string; }

interface StoredEditRow {
  readonly field: string;
  readonly edited_at_text: string;
  readonly edited_epoch_ms: string;
  readonly device: string;
}

export async function loadFieldEdits(client: PoolClient, observationId: string): Promise<Map<ResolvableField, FieldEdit>> {
  const rows = await client.query<StoredEditRow>(
    "SELECT field, edited_at_text, edited_epoch_ms, device FROM observation_field_edits WHERE observation_id = $1",
    [observationId],
  );
  const map = new Map<ResolvableField, FieldEdit>();
  for (const row of rows.rows) {
    map.set(row.field as ResolvableField, { edited_at: row.edited_at_text, edited_epoch_ms: Number(row.edited_epoch_ms), device: row.device });
  }
  return map;
}

export interface IncomingField {
  readonly field: ResolvableField;
  readonly value: unknown;
  readonly error?: string;
}

// The one decision: each field is applied when its edited_at is the same as
// or later than the stored one; conflicts are reported by the published rule.
export function resolveFields(
  incoming: readonly IncomingField[],
  stored: Map<ResolvableField, FieldEdit>,
  incomingEdit: FieldEdit,
  storedVersion: number,
  baseVersion: number | undefined,
): FieldResolutionOutcome {
  const appliedFields: AppliedField[] = [];
  const reports: ConflictReport[] = [];
  const errors: Record<string, string> = {};
  let anyApplied = false;
  for (const field of incoming) {
    if (field.error) {
      errors[field.field] = field.error;
      continue;
    }
    const current = stored.get(field.field);
    if (current && !incomingWins(incomingEdit, current)) {
      // A value discarded because another device's value is newer: kept.
      if (current.device !== incomingEdit.device) {
        reports.push({ field: field.field, outcome: "kept", other_device: current.device, other_edited_at: current.edited_at });
      }
      continue;
    }
    const baseApplies = baseVersion === undefined || baseVersion >= storedVersion;
    const otherDeviceSetLater = current !== undefined && current.device !== incomingEdit.device && current.edited_epoch_ms > incomingEdit.edited_epoch_ms;
    appliedFields.push({
      field: field.field,
      value: field.value,
      editedEpochMs: incomingEdit.edited_epoch_ms,
      editedText: incomingEdit.edited_at,
    });
    anyApplied = true;
    if (current && current.device !== incomingEdit.device && !baseApplies) {
      reports.push({ field: field.field, outcome: "replaced", other_device: current.device, other_edited_at: current.edited_at });
    }
  }
  return { appliedFields, reports, anyApplied, errors };
}

export async function applyFieldsToRow(
  client: PoolClient,
  observationId: string,
  fields: readonly AppliedField[],
  incomingEdit: FieldEdit,
): Promise<void> {
  for (const field of fields) {
    await writeField(client, observationId, field, incomingEdit);
  }
}

async function writeField(client: PoolClient, observationId: string, field: AppliedField, edit: FieldEdit): Promise<void> {
  switch (field.field) {
    case "observed_at": {
      const parsed = typeof field.value === "string" ? parseInputTime(field.value) : null;
      const session = await client.query<{ started_at_text: string; time_zone: string }>(
        `SELECT s.started_at_text, si.time_zone FROM observing_sessions s JOIN sites si ON si.id = s.site_id
         JOIN observations o ON o.session_id = s.id WHERE o.id = $1`,
        [observationId],
      );
      const sessionRow = session.rows[0]!;
      const timeZone = sessionRow.time_zone;
      if (parsed) {
        const start = parseInputTime(sessionRow.started_at_text)!;
        if (!observedAtWithinSession(parsed.epochMs, start.epochMs)) {
          throw new ApiError(422, "validation", { observed_at: fieldMessages.observed_at });
        }
        await client.query(
          "UPDATE observations SET observed_at = $1, observed_at_text = $2, local_time = $3, local_offset = $4 WHERE id = $5",
          [new Date(parsed.epochMs), parsed.text, localHHMM(parsed.epochMs, timeZone), utcOffset(parsed.epochMs, timeZone), observationId],
        );
      } else {
        await client.query("UPDATE observations SET observed_at = NULL, observed_at_text = NULL, local_time = NULL, local_offset = NULL WHERE id = $1", [observationId]);
      }
      break;
    }
    case "seeing": {
      const value = field.value as number | null;
      await client.query("UPDATE observations SET seeing = $1 WHERE id = $2", [value, observationId]);
      break;
    }
    case "transparency_nelm": {
      const value = field.value as number | null;
      await client.query("UPDATE observations SET transparency_nelm = $1 WHERE id = $2", [value, observationId]);
      break;
    }
    case "concentration_class": {
      const value = field.value as string | null;
      await client.query("UPDATE observations SET concentration_class = $1 WHERE id = $2", [value, observationId]);
      break;
    }
    case "description": {
      const value = typeof field.value === "string" ? field.value : "";
      await client.query("UPDATE observations SET description = $1 WHERE id = $2", [value, observationId]);
      break;
    }
    case "pair": {
      const value = field.value as { primary: [number, number]; secondary: [number, number] } | null;
      if (value) {
        const pair = makePair(value.primary, value.secondary);
        await client.query(
          "UPDATE observations SET pair_primary = $1, pair_secondary = $2, pair_separation = $3, pair_pa = $4 WHERE id = $5",
          [JSON.stringify(value.primary), JSON.stringify(value.secondary), pair.separation_arcmin, pair.position_angle_deg, observationId],
        );
      } else {
        await client.query("UPDATE observations SET pair_primary = NULL, pair_secondary = NULL, pair_separation = NULL, pair_pa = NULL WHERE id = $1", [observationId]);
      }
      break;
    }
    case "optics": {
      const value = field.value as { telescope_id: string; eyepiece_id: string; barlow_id: string | null; train: string };
      await client.query(
        "UPDATE observations SET telescope_id = $1, eyepiece_id = $2, barlow_id = $3, train = $4, derived = $5 WHERE id = $6",
        [value.telescope_id, value.eyepiece_id, value.barlow_id, value.train, JSON.stringify((field as AppliedOptics).derived), observationId],
      );
      break;
    }
    default:
      break;
  }
  await client.query(
    `INSERT INTO observation_field_edits (observation_id, field, edited_at_text, edited_epoch_ms, device)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (observation_id, field) DO UPDATE SET edited_at_text = EXCLUDED.edited_at_text, edited_epoch_ms = EXCLUDED.edited_epoch_ms, device = EXCLUDED.device`,
    [observationId, field.field, field.editedText, field.editedEpochMs, edit.device],
  );
}

export interface AppliedOptics extends AppliedField {
  readonly derived: unknown;
}

export async function loadObservationRow(client: PoolClient, accountId: string, observationId: string): Promise<ObservationRow | null> {
  const result = await client.query<ObservationRow>(`${OBSERVATION_SELECT} WHERE o.id = $1 AND o.account_id = $2 AND o.deleted = false`, [observationId, accountId]);
  return result.rows[0] ?? null;
}
