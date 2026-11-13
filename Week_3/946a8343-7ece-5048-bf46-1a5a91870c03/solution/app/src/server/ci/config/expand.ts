// `$NAME` and `${NAME}` expansion shared by every place a job's text is expanded.
const PASSES = 3;
// Stands in for a `$$` so later passes leave it alone.
const LITERAL_DOLLAR = "\u0000";
const REFERENCE = /\$\$|\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;

export function expandVariables(text: string, vars: Readonly<Record<string, string>>): string {
  let current = text;
  for (let pass = 0; pass < PASSES; pass++) {
    const next = current.replace(REFERENCE, (whole, braced: string | undefined, bare: string | undefined) => {
      if (whole === "$$") return LITERAL_DOLLAR;
      const name = braced ?? bare ?? "";
      return Object.hasOwn(vars, name) ? (vars[name] ?? "") : "";
    });
    if (next === current) break;
    current = next;
  }
  return current.replaceAll(LITERAL_DOLLAR, "$");
}
