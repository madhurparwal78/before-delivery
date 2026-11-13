// Request values against a part's manifest.
import { buildManifest, checkValue, type Model, type Values } from "../shared/tine";
import { invalid } from "./errors";

/** The parameters of `values` that take numbers: the ones whose strings the number grammar refuses. */
export function numericParameters(model: Model): Set<string> {
  return new Set(
    buildManifest(model, {})
      .filter((entry) => !entry.derived && (entry.kind === "length" || entry.kind === "angle" || entry.kind === "count"))
      .map((entry) => entry.name),
  );
}

/** Validates a values object, throwing a 422 with one message per failing name; -0 becomes 0. */
export function validateValues(model: Model, raw: unknown): Values {
  if (raw === undefined) return {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw invalid({ values: "Send the values as an object." });
  const entries = new Map(buildManifest(model, {}).map((entry) => [entry.name, entry]));
  const errors: Record<string, string> = {};
  const values: Values = {};
  for (const [name, value] of Object.entries(raw)) {
    const entry = entries.get(name);
    const problem = entry && !entry.derived ? checkValue(entry, value) : "Unknown parameter.";
    if (problem) errors[name] = problem;
    else values[name] = value === 0 ? 0 : (value as Values[string]);
  }
  if (Object.keys(errors).length > 0) throw invalid(errors);
  return values;
}
