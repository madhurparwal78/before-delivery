import { BREAKPOINTS, type Breakpoint, type StyleKey, type StyleValue, type Styles, type Token, type TokenKind } from "./types.js";

const NAMED_COLOURS: ReadonlySet<string> = new Set(
  ("aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood " +
    "cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray " +
    "darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen " +
    "darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue " +
    "firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew " +
    "hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan " +
    "lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray " +
    "lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue " +
    "mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred " +
    "midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid " +
    "palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple " +
    "rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue " +
    "slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow " +
    "yellowgreen").split(" "),
);

/** The token kind each style key accepts (null: the key takes no token). */
export const TOKEN_KIND_FOR: Record<StyleKey, TokenKind | null> = {
  color: "color",
  "background-color": "color",
  "font-size": "size",
  padding: "size",
  gap: "size",
  width: "size",
  "text-align": null,
  display: null,
  "flex-direction": null,
};

const KEYWORDS: Partial<Record<StyleKey, readonly string[]>> = {
  "text-align": ["left", "center", "right"],
  display: ["block", "flex", "none"],
  "flex-direction": ["row", "column"],
};

const LENGTH = /^(\d{1,3}(?:\.\d{1,3})?)(px|rem)$/;
const PERCENT = /^(\d{1,3}(?:\.\d{1,3})?)%$/;

export function isTokenRef(value: unknown): value is { token: string } {
  return typeof value === "object" && value !== null && !Array.isArray(value) && typeof (value as { token?: unknown }).token === "string" && Object.keys(value).length === 1;
}

/** Why a style value is not accepted for a key, or null when it is. */
export function styleValueProblem(key: StyleKey, value: unknown, tokens: readonly Token[]): string | null {
  if (isTokenRef(value)) {
    const kind = TOKEN_KIND_FOR[key];
    if (!kind) return `${key} takes no token.`;
    const token = tokens.find((t) => t.name === value.token);
    if (!token) return `There is no token named ${value.token}.`;
    if (token.kind !== kind) return `${key} takes a ${kind} token.`;
    return null;
  }
  if (typeof value !== "string") return `${key} takes a text value or a token.`;
  switch (key) {
    case "color":
    case "background-color":
      return NAMED_COLOURS.has(value) ? null : `${key} takes a CSS named colour.`;
    case "font-size":
    case "padding":
    case "gap":
      return LENGTH.test(value) ? null : `${key} takes a number from 0 to 999 followed by px or rem.`;
    case "width": {
      if (value === "auto" || LENGTH.test(value)) return null;
      const percent = PERCENT.exec(value);
      return percent && Number(percent[1]) <= 100 ? null : "width takes px, rem, a percentage from 0 to 100, or auto.";
    }
    default: {
      const allowed = KEYWORDS[key] ?? [];
      return allowed.includes(value) ? null : `${key} takes ${allowed.join(", ")}.`;
    }
  }
}

/** Token names: 1 to 40 lowercase letters, digits and hyphens. */
export function tokenNameProblem(name: unknown): string | null {
  return typeof name === "string" && /^[a-z0-9-]{1,40}$/.test(name) ? null : "A token name is 1 to 40 lowercase letters, digits or hyphens.";
}

export function isColourName(value: unknown): value is string {
  return typeof value === "string" && NAMED_COLOURS.has(value);
}

export function sizeTokenProblem(value: unknown, unit: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 999) return "A size token takes a number from 0 to 999.";
  if (Math.round(value * 10000) !== value * 10000) return "A size token takes at most 4 decimals.";
  return unit === "px" || unit === "rem" ? null : "A size token's unit is px or rem.";
}

/** A token's value as text: a colour name, or the number followed directly by its unit. */
function tokenText(token: Token): string {
  return token.kind === "color" ? token.value : `${token.value}${token.unit}`;
}

/** The px/rem conversion of the Tokens panel (16 px root, rounded to 4 decimals). */
export function convertSize(value: number, from: "px" | "rem", to: "px" | "rem"): number {
  if (from === to) return value;
  const converted = to === "rem" ? value / 16 : value * 16;
  return Math.round(converted * 10000) / 10000;
}

// ── Breakpoint inheritance: the one place it is decided ──────────────────────────────────────────

/** The value a breakpoint resolves to and the breakpoint that holds it: its own, else the nearest one above. */
export function resolve(styles: Styles, bp: Breakpoint, key: StyleKey): { value: StyleValue; from: Breakpoint } | undefined {
  for (let i = BREAKPOINTS.indexOf(bp); i >= 0; i -= 1) {
    const from = BREAKPOINTS[i];
    const value = styles[from][key];
    if (value !== undefined) return { value, from };
  }
  return undefined;
}

type RowSource = "set" | "inherited" | "unset";
/** Whether a breakpoint holds its own value for a property (an override below Desktop). */
export function holdsOwn(styles: Styles, bp: Breakpoint, key: StyleKey): boolean {
  return styles[bp][key] !== undefined;
}

export function rowSource(styles: Styles, bp: Breakpoint, key: StyleKey): RowSource {
  const found = resolve(styles, bp, key);
  if (!found) return "unset";
  return found.from === bp ? "set" : "inherited";
}

type PipState = "set" | "inherited" | "overridden" | "unset";
export function pipState(styles: Styles, bp: Breakpoint, key: StyleKey): PipState {
  const source = rowSource(styles, bp, key);
  if (source === "set") return bp === "desktop" ? "set" : "overridden";
  return source;
}

/** A clear-override control exists only below Desktop where the row holds its own value. */
export function hasOverride(styles: Styles, bp: Breakpoint, key: StyleKey): boolean {
  return bp !== "desktop" && holdsOwn(styles, bp, key);
}

interface Reach {
  inherited: Breakpoint[];
  kept: Breakpoint[];
  shielded: Breakpoint[];
}

/** Which breakpoints below `changed` follow a new value there (Reach of a change). */
export function reach(styles: Styles, changed: Breakpoint, key: StyleKey): Reach {
  const out: Reach = { inherited: [], kept: [], shielded: [] };
  let shield = false;
  for (const bp of BREAKPOINTS.slice(BREAKPOINTS.indexOf(changed) + 1)) {
    if (holdsOwn(styles, bp, key)) {
      out.kept.push(bp);
      shield = true;
    } else if (shield) out.shielded.push(bp);
    else out.inherited.push(bp);
  }
  return out;
}

/** The breakpoints whose resolved value now flows through `cleared` after its override is removed. */
export function inheritingThrough(styles: Styles, cleared: Breakpoint, key: StyleKey): Breakpoint[] {
  const out: Breakpoint[] = [cleared];
  for (const bp of BREAKPOINTS.slice(BREAKPOINTS.indexOf(cleared) + 1)) {
    if (holdsOwn(styles, bp, key)) break;
    out.push(bp);
  }
  return out;
}

/** A stored style value as notice text: the string, the token's name, or `nothing`. */
export function valueText(value: StyleValue | undefined): string {
  if (value === undefined) return "nothing";
  return typeof value === "string" ? value : value.token;
}

/** The CSS a style value stands for, with tokens resolved to their current values. */
export function cssValue(value: StyleValue, tokens: readonly Token[]): string | undefined {
  if (typeof value === "string") return value;
  const token = tokens.find((t) => t.name === value.token);
  return token ? tokenText(token) : undefined;
}

/** Every resolved CSS declaration of a node at one breakpoint. */
export function declarations(styles: Styles, bp: Breakpoint, tokens: readonly Token[]): [StyleKey, string][] {
  const out: [StyleKey, string][] = [];
  for (const key of Object.keys(TOKEN_KIND_FOR) as StyleKey[]) {
    const found = resolve(styles, bp, key);
    const css = found && cssValue(found.value, tokens);
    if (css !== undefined) out.push([key, css]);
  }
  return out;
}
