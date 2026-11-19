import type { Step } from '../../shared/catalogue.js';
import { operation, validateSteps } from '../../shared/catalogue.js';
import { toBase64Url, fromBase64Url } from '../../shared/text.js';

/** The one recipe-link codec: compact JSON, keys in catalogue order, unpadded base64url (DP-30). */
export function encodeRecipeLink(steps: Step[], input: Uint8Array): string {
  const compact = steps.map((step) => {
    const spec = operation(step.op);
    const entry: Record<string, unknown> = { op: step.op };
    if (spec && Object.keys(step.args).length > 0) {
      const args: Record<string, unknown> = {};
      for (const a of spec.args) args[a.key] = step.args[a.key];
      entry.args = args;
    }
    if (step.disabled) entry.disabled = true;
    if (step.breakpoint) entry.breakpoint = true;
    return entry;
  });
  const json = JSON.stringify(compact);
  const r = toBase64Url(new TextEncoder().encode(json));
  const i = toBase64Url(input);
  return `/w#r=${r}&i=${i}`;
}

export type ParseResult =
  | { ok: true; steps: Step[]; input: Uint8Array; notUtf8: boolean }
  | { ok: false; error: 'recipe' | 'input' };

export function parseRecipeLink(hash: string): ParseResult {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const r = params.get('r');
  const i = params.get('i');
  if (r === null) return { ok: false, error: 'recipe' };
  let json: string;
  try {
    json = new TextDecoder().decode(fromBase64Url(r));
  } catch {
    return { ok: false, error: 'recipe' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: 'recipe' };
  }
  if (!Array.isArray(parsed)) return { ok: false, error: 'recipe' };
  const v = validateSteps(parsed);
  if ('fields' in v) return { ok: false, error: 'recipe' };
  let input: Uint8Array;
  let notUtf8 = false;
  if (i === null) {
    input = new Uint8Array(0);
  } else {
    try {
      input = fromBase64Url(i);
    } catch {
      return { ok: false, error: 'input' };
    }
    notUtf8 = !isValidUtf8(input);
  }
  return { ok: true, steps: v.steps, input, notUtf8 };
}

function isValidUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}
