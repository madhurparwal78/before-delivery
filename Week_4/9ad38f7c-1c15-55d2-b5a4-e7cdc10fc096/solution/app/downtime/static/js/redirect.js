// The return-address check (adapted from kit/modules/safe_redirect to the brief's single decode).

const UNSAFE = /[\u0000-\u001f\u007f-\u009f\s\\]/;

/**
 * The same-origin path, query and fragment named by `redirect`, or /downtime for any other value. A value that
 * starts with exactly one "/" carries no scheme; resolving it must also stay on this origin.
 */
export function returnAddress(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || UNSAFE.test(value)) {
    return "/downtime";
  }
  const target = new URL(value, window.location.origin);
  if (target.origin !== window.location.origin) return "/downtime";
  return target.pathname + target.search + target.hash;
}
