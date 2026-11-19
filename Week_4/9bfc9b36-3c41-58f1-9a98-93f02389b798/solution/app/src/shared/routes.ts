/** The screens' addresses, shared so the server and the browser agree on which paths exist. */

export type ScreenName =
  | "landing" | "signin" | "loft" | "boat" | "drawing" | "measure" | "draw" | "nest" | "confirm"
  | "floor" | "floor-drawing" | "stock" | "ledger" | "console" | "rulesets" | "accounts" | "owner" | "sheet";

const SCREEN_PATTERNS: readonly [ScreenName, string][] = [
  ["landing", "/"],
  ["signin", "/signin"],
  ["loft", "/loft"],
  ["boat", "/boats/:code"],
  ["drawing", "/drawings/:code"],
  ["measure", "/drawings/:code/measure"],
  ["draw", "/drawings/:code/draw"],
  ["nest", "/drawings/:code/nest"],
  ["confirm", "/drawings/:code/confirm"],
  ["floor", "/floor"],
  ["floor-drawing", "/floor/:code"],
  ["stock", "/stock"],
  ["ledger", "/ledger"],
  ["console", "/console"],
  ["rulesets", "/rulesets"],
  ["accounts", "/accounts"],
  ["owner", "/owner"],
  ["sheet", "/sheets/:id"],
];

export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const want = pattern.split("/");
  const have = path.split("/");
  if (want.length !== have.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < want.length; index++) {
    const expected = want[index]!;
    const actual = have[index]!;
    if (expected.startsWith(":")) {
      if (actual === "") return null;
      try {
        params[expected.slice(1)] = decodeURIComponent(actual);
      } catch {
        return null;
      }
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}

export function matchScreen(path: string): { screen: ScreenName; params: Record<string, string> } | null {
  for (const [screen, pattern] of SCREEN_PATTERNS) {
    const params = matchPath(pattern, path);
    if (params) return { screen, params };
  }
  return null;
}
