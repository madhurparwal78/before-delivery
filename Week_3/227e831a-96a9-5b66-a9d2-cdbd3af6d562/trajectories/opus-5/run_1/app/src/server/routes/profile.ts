import { pool } from '../db.js';
import { declaredBody, present } from '../http/json.js';
import type { Route } from '../http/pipeline.js';
import { loadProfileRow, profileJson } from '../store.js';
import {
  FieldErrors,
  MESSAGES,
  displayUnitOf,
  paperSizeOf,
  timeZoneOf,
  trimmedText,
  weightGramsOf,
} from '../validate.js';

const FIELDS = ['displayName', 'unit', 'goal', 'timeZone', 'paperSize'] as const;

export const profileRoutes: Route[] = [
  {
    method: 'PATCH',
    pattern: '/api/profile',
    auth: 'owner',
    body: 'json',
    handler: async (ctx) => {
      const body = declaredBody(ctx.body, FIELDS);
      const errors = new FieldErrors();
      const updates: string[] = [];
      const values: unknown[] = [];

      if (present(body['displayName'])) {
        const displayName = trimmedText(body['displayName'], 1, 60);
        if (displayName === null) errors.add('displayName', MESSAGES.displayName);
        else {
          updates.push(`display_name = $${values.push(displayName)}`);
        }
      }
      if (present(body['unit'])) {
        const unit = displayUnitOf(body['unit']);
        if (unit === null) errors.add('unit', MESSAGES.unit);
        else updates.push(`unit = $${values.push(unit)}`);
      }
      if (present(body['goal'])) {
        const grams = weightGramsOf(body['goal']);
        if (grams === null || grams < 1) errors.add('goal', MESSAGES.goal);
        else updates.push(`goal_grams = $${values.push(grams)}`);
      }
      if (present(body['timeZone'])) {
        const zone = timeZoneOf(body['timeZone']);
        if (zone === null) errors.add('timeZone', MESSAGES.timeZone);
        else updates.push(`time_zone = $${values.push(zone)}`);
      }
      if (present(body['paperSize'])) {
        const paper = paperSizeOf(body['paperSize']);
        if (paper === null) errors.add('paperSize', MESSAGES.paperSize);
        else updates.push(`paper_size = $${values.push(paper)}`);
      }
      errors.throwIfAny();

      if (updates.length > 0) {
        await pool.query(`UPDATE profile SET ${updates.join(', ')} WHERE only_row`, values);
      }
      return { status: 200, json: { profile: profileJson(await loadProfileRow()) } };
    },
  },
];
