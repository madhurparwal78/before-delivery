import { decodeUtf8Strict, latin1String, utf8Bytes } from "../../shared/bytes";
import type { Step } from "../../shared/operations/types";
import { parseSteps } from "../../shared/operations/validate";
import { compactSteps } from "./state";

export const toBase64 = (bytes: Uint8Array): string => btoa(latin1String(bytes));

export function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
}

/** Unpadded base64url of some bytes. */
function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The bytes of an unpadded base64url string, or null when it is not one. */
function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  return fromBase64(padded);
}

/** The recipe link: `/w#r=<steps>&i=<input bytes>`, both unpadded base64url. */
export function recipeLink(steps: readonly Step[], input: Uint8Array): string {
  const recipe = toBase64Url(utf8Bytes(JSON.stringify(compactSteps(steps))));
  return `${window.location.origin}/w#r=${recipe}&i=${toBase64Url(input)}`;
}

type LinkContents = { steps: Step[]; input: Uint8Array } | { damaged: "recipe" | "input" };

/** Reads a link's fragment; the recipe part is checked first, then the input part. */
export function readLink(fragment: string): LinkContents {
  const params = new URLSearchParams(fragment);
  const recipeBytes = fromBase64Url(params.get("r") ?? "");
  const recipeText = recipeBytes ? decodeUtf8Strict(recipeBytes) : null;
  let raw: unknown = null;
  try {
    raw = recipeText === null ? null : JSON.parse(recipeText);
  } catch {
    return { damaged: "recipe" };
  }
  const steps = parseSteps(raw);
  if ("problems" in steps) return { damaged: "recipe" };
  const input = fromBase64Url(params.get("i") ?? "");
  return input ? { steps: steps.steps, input } : { damaged: "input" };
}
