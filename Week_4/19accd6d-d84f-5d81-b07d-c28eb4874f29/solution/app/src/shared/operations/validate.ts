import { isRecord } from "../records";
import { defaultArgs, operationNamed } from "./catalogue";
import type { ArgSpec, ArgValue, Step, StepArgs } from "./types";

const MAX_STEPS = 100;
const FLAG_LETTERS = "gims";

type StepProblem = { path: string; message: string };

function argProblem(arg: ArgSpec, value: unknown): string | null {
  switch (arg.kind) {
    case "option":
      return typeof value === "string" && arg.options.includes(value)
        ? null : `${arg.label} must be one of ${arg.options.join(", ")}.`;
    case "toggle":
      return typeof value === "boolean" ? null : `${arg.label} must be on or off.`;
    case "integer":
      return typeof value === "number" && Number.isInteger(value) && value >= arg.min && value <= arg.max
        ? null : `${arg.label} must be a whole number from ${arg.min} to ${arg.max}.`;
    case "text":
      return typeof value === "string" ? null : `${arg.label} must be text.`;
    case "flags":
      return typeof value === "string" && [...value].every((letter, i) => FLAG_LETTERS.includes(letter) && value.indexOf(letter) === i)
        ? null : `${arg.label} may only hold g, i, m and s, each once.`;
  }
}

/** The flags in the published order g, i, m, s. */
function orderedFlags(value: string): string {
  return [...FLAG_LETTERS].filter((letter) => value.includes(letter)).join("");
}

/** Validates one step; missing args take their defaults and the result lists args in catalogue order. */
export function parseStep(raw: unknown, path: string): { step: Step } | { problems: StepProblem[] } {
  if (!isRecord(raw)) return { problems: [{ path, message: "A step must be an object." }] };
  const operation = typeof raw.op === "string" ? operationNamed(raw.op) : undefined;
  if (!operation) {
    return { problems: [{ path: `${path}.op`, message: `Unknown operation ${JSON.stringify(raw.op ?? null)}.` }] };
  }
  const given = isRecord(raw.args) ? raw.args : {};
  const problems: StepProblem[] = [];
  const args: StepArgs = {};
  for (const arg of operation.args) {
    const value: unknown = arg.key in given ? given[arg.key] : defaultArgs(operation)[arg.key];
    const problem = argProblem(arg, value);
    if (problem) problems.push({ path: `${path}.args.${arg.key}`, message: problem });
    else args[arg.key] = arg.kind === "flags" ? orderedFlags(value as string) : (value as ArgValue);
  }
  for (const key of ["disabled", "breakpoint"] as const) {
    if (key in raw && typeof raw[key] !== "boolean") problems.push({ path: `${path}.${key}`, message: `${key} must be true or false.` });
  }
  if (problems.length) return { problems };
  return { step: { op: operation.name, args, disabled: raw.disabled === true, breakpoint: raw.breakpoint === true } };
}

export function parseSteps(raw: unknown, path = "steps"): { steps: Step[] } | { problems: StepProblem[] } {
  if (!Array.isArray(raw)) return { problems: [{ path, message: "Steps must be a list." }] };
  if (raw.length > MAX_STEPS) return { problems: [{ path, message: `A recipe has at most ${MAX_STEPS} steps.` }] };
  const steps: Step[] = [];
  const problems: StepProblem[] = [];
  raw.forEach((item, index) => {
    const parsed = parseStep(item, `${path}.${index}`);
    if ("step" in parsed) steps.push(parsed.step);
    else problems.push(...parsed.problems);
  });
  return problems.length ? { problems } : { steps };
}
