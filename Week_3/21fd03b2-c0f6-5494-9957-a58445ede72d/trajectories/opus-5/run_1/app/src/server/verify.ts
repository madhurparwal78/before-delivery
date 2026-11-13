import type { Json } from '../shared/canonical.js';
import { fieldCopy, unexposedCopy } from '../shared/copy.js';
import { findSpec, inRange, rangeMessage } from '../shared/params.js';
import type { SceneDocument } from '../shared/scene.js';
import { MAX_VERIFY_STEPS } from '../shared/sim.js';
import { faults } from './errors.js';

export interface VerifyInput {
  steps: number;
  params: Record<string, number>;
}

/** Validates a verify request against the document, and against the exposed keys for a lab. */
export function parseVerifyRequest(
  body: Record<string, Json>,
  document: SceneDocument,
  exposed: readonly string[] | null,
): VerifyInput {
  const fields: Record<string, string> = {};
  const stepsValue = body.steps;
  const steps = typeof stepsValue === 'number' ? stepsValue : Number.NaN;
  if (!Number.isInteger(steps) || steps < 1 || steps > MAX_VERIFY_STEPS)
    fields.steps = fieldCopy.steps;

  const params: Record<string, number> = {};
  const raw = body.params;
  if (raw !== undefined && raw !== null) {
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      fields.params = fieldCopy.notANumber;
    } else {
      for (const [key, value] of Object.entries(raw as Record<string, Json>)) {
        if (exposed !== null && !exposed.includes(key)) {
          fields[key] = unexposedCopy(key);
          continue;
        }
        const separator = key.lastIndexOf('.');
        const objectId = separator < 0 ? '' : key.slice(0, separator);
        const paramKey = separator < 0 ? '' : key.slice(separator + 1);
        const object = document.objects.find((candidate) => candidate.id === objectId);
        const spec = object ? findSpec(object.kind, paramKey) : undefined;
        if (!spec) {
          fields[key] = unexposedCopy(key);
          continue;
        }
        if (typeof value !== 'number' || !inRange(spec, value)) {
          fields[key] = rangeMessage(spec);
          continue;
        }
        params[key] = value;
      }
    }
  }
  if (Object.keys(fields).length > 0) throw faults.validation(fields);
  return { steps, params };
}
