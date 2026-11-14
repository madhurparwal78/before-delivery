import type { Position } from "../../shared/wire.ts";

export type { Position };

export type Clearance =
  | { verb: "PUSH" }
  | { verb: "TAXI"; point: string; via: string[] }
  | { verb: "HOLD" }
  | { verb: "CONTINUE" }
  | { verb: "CONTACT" }
  | { verb: "LINEUP"; runway: string }
  | { verb: "TAKEOFF"; runway: string }
  | { verb: "LAND"; runway: string }
  | { verb: "CROSS"; runway: string; point: string }
  | { verb: "GO" }
  | { verb: "NEGATIVE"; subject: "RUNWAY" | "HP"; value: string };

/** The position a verb belongs to, or null for a verb either seat may use. */
const VERB_POSITION: Record<KnownVerb, Position | null> = {
  PUSH: "GND",
  TAXI: "GND",
  CONTACT: "GND",
  HOLD: null,
  CONTINUE: null,
  NEGATIVE: null,
  LINEUP: "TWR",
  CLEARED: "TWR",
  CROSS: "TWR",
  GO: "TWR",
};

type KnownVerb = "PUSH" | "TAXI" | "CONTACT" | "HOLD" | "CONTINUE" | "NEGATIVE" | "LINEUP" | "CLEARED" | "CROSS" | "GO";

export const isKnownVerb = (word: string): word is KnownVerb => word in VERB_POSITION;
export const verbPosition = (word: KnownVerb): Position | null => VERB_POSITION[word];
export const positionName = (position: Position): string => (position === "GND" ? "Ground" : "Tower");

/** Input is trimmed, runs of spaces collapse and lower case is taken as upper case. */
const normalise = (text: string): string => text.trim().replace(/\s+/g, " ").toUpperCase();

interface ParsedLine {
  /** The normalised line; empty when the text was blank. */
  line: string;
  words: string[];
}

export function parseLine(text: string): ParsedLine {
  const line = normalise(text);
  return { line, words: line === "" ? [] : line.split(" ") };
}

const USAGE = {
  PUSH: "<CS> PUSH APPROVED",
  TAXI: "<CS> TAXI HP <point> VIA <taxiways>",
  HOLD: "<CS> HOLD POSITION",
  CONTINUE: "<CS> CONTINUE TAXI",
  CONTACT: "<CS> CONTACT TOWER",
  LINEUP: "<CS> LINEUP <rwy>",
  TAKEOFF: "<CS> CLEARED TAKEOFF <rwy>",
  LAND: "<CS> CLEARED LAND <rwy>",
  CLEARED: "<CS> CLEARED TAKEOFF <rwy> or <CS> CLEARED LAND <rwy>",
  CROSS: "<CS> CROSS <rwy> AT <point>",
  GO: "<CS> GO AROUND",
  NEGATIVE: "<CS> NEGATIVE RUNWAY <rwy> or <CS> NEGATIVE HP <point>",
} as const;

export const usageLine = "Usage: <CALLSIGN> <VERB> <ARGS>.";

type ClearanceResult = { ok: true; clearance: Clearance } | { ok: false; usage: string };

const usage = (form: keyof typeof USAGE): ClearanceResult => ({ ok: false, usage: `Usage: ${USAGE[form]}.` });

/** Reads the words after the callsign into a clearance, or names the usage that was broken. */
export function parseClearance(verb: KnownVerb, args: string[]): ClearanceResult {
  const exact = (...expected: string[]): boolean => args.length === expected.length && expected.every((word, i) => args[i] === word);
  const ok = (clearance: Clearance): ClearanceResult => ({ ok: true, clearance });
  switch (verb) {
    case "PUSH":
      return exact("APPROVED") ? ok({ verb: "PUSH" }) : usage("PUSH");
    case "HOLD":
      return exact("POSITION") ? ok({ verb: "HOLD" }) : usage("HOLD");
    case "CONTINUE":
      return exact("TAXI") ? ok({ verb: "CONTINUE" }) : usage("CONTINUE");
    case "CONTACT":
      return exact("TOWER") ? ok({ verb: "CONTACT" }) : usage("CONTACT");
    case "GO":
      return exact("AROUND") ? ok({ verb: "GO" }) : usage("GO");
    case "LINEUP":
      return args.length === 1 ? ok({ verb: "LINEUP", runway: args[0] ?? "" }) : usage("LINEUP");
    case "TAXI": {
      const [hp, point, via, ...taxiways] = args;
      if (hp !== "HP" || point === undefined || (via !== undefined && via !== "VIA")) return usage("TAXI");
      return ok({ verb: "TAXI", point, via: taxiways });
    }
    case "CLEARED": {
      const [what, runway] = args;
      if (what !== "TAKEOFF" && what !== "LAND") return usage("CLEARED");
      if (args.length !== 2 || runway === undefined) return usage(what);
      return ok({ verb: what, runway });
    }
    case "CROSS": {
      const [runway, at, point] = args;
      return args.length === 3 && at === "AT" && runway !== undefined && point !== undefined
        ? ok({ verb: "CROSS", runway, point })
        : usage("CROSS");
    }
    case "NEGATIVE": {
      const [subject, value] = args;
      return args.length === 2 && (subject === "RUNWAY" || subject === "HP") && value !== undefined
        ? ok({ verb: "NEGATIVE", subject, value })
        : usage("NEGATIVE");
    }
  }
}

const FORM_OWNER: [keyof typeof USAGE, Position | null][] = [
  ["PUSH", "GND"],
  ["TAXI", "GND"],
  ["CONTACT", "GND"],
  ["HOLD", null],
  ["CONTINUE", null],
  ["LINEUP", "TWR"],
  ["TAKEOFF", "TWR"],
  ["LAND", "TWR"],
  ["CROSS", "TWR"],
  ["GO", "TWR"],
  ["NEGATIVE", null],
];

/** The clearance forms a seat may use, for the grammar help beside the command line. */
export const commandForms = (position: Position): string[] =>
  FORM_OWNER.filter(([, owner]) => owner === null || owner === position).map(([form]) => USAGE[form]);
