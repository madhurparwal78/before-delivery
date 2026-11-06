// The sign-in return path rule (brief: Sign-in return path), adapted from kit/modules/safe_redirect: the brief decodes
// `next` exactly once, so this checks the once-decoded value.

/** The raw `next` from a query string, percent-decoded once; undefined when absent. */
function nextParam(search: string): string | undefined {
  for (const pair of search.replace(/^\?/, "").split("&")) {
    const [name, ...rest] = pair.split("=");
    if (name !== "next") continue;
    try {
      return decodeURIComponent(rest.join("="));
    } catch {
      return "";
    }
  }
  return undefined;
}

function isAcceptedNext(value: string): boolean {
  return /^\/(?![/\\])/.test(value) && !value.includes("\\") && !/[\u0000-\u001f\u007f]/.test(value);
}

/** Where sign-in or account creation lands. */
export function landingAfterSignIn(search: string): string {
  const next = nextParam(search);
  if (next === undefined) return "/bookings";
  return isAcceptedNext(next) ? next : "/";
}
