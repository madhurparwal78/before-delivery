import type { Settings } from "../shared/protocol";
import type { LengthChoice } from "./testConfig";

/** What choosing a command line option does. */
export type Command =
  | { readonly label: string; readonly kind: "mode"; readonly mode: "time" | "words" | "quote" | "custom" }
  | { readonly label: string; readonly kind: "length"; readonly mode: "time" | "words" | "quote"; readonly length: LengthChoice }
  | { readonly label: string; readonly kind: "toggle"; readonly field: "punctuation" | "numbers"; readonly on: boolean }
  | { readonly label: string; readonly kind: "setting"; readonly patch: Partial<Settings> };

const lengths = (prefix: string, mode: "time" | "words" | "quote", values: readonly LengthChoice[]): Command[] =>
  values.map((length) => ({ label: `${prefix}: ${length}`, kind: "length", mode, length }));

const onOff = (prefix: string, field: "punctuation" | "numbers"): Command[] => [
  { label: `${prefix}: on`, kind: "toggle", field, on: true },
  { label: `${prefix}: off`, kind: "toggle", field, on: false },
];

const setting = <K extends keyof Settings>(prefix: string, key: K, values: readonly Settings[K][]): Command[] =>
  values.map((value) => ({ label: `${prefix}: ${typeof value === "boolean" ? (value ? "on" : "off") : value}`, kind: "setting", patch: { [key]: value } }));

const COMMANDS: readonly Command[] = [
  ...(["time", "words", "quote", "custom"] as const).map((mode): Command => ({ label: `Mode: ${mode}`, kind: "mode", mode })),
  ...lengths("Time", "time", [15, 30, 60, 120]),
  ...lengths("Words", "words", [10, 25, 50, 100]),
  ...lengths("Quote length", "quote", ["short", "medium", "long", "all"]),
  ...onOff("Punctuation", "punctuation"),
  ...onOff("Numbers", "numbers"),
  ...setting("Theme", "theme", ["sand", "cobalt", "carbon", "ledger"]),
  ...setting("Caret", "caret", ["line", "block", "underline", "off"]),
  ...setting("Smooth caret", "smoothCaret", [true, false]),
  ...setting("Font size", "fontSize", [1, 1.5, 2, 3]),
  ...setting("Blind mode", "blindMode", [true, false]),
  ...setting("Quick restart", "quickRestart", ["tab", "enter"]),
];

/** An option matches when every space-separated part of the typed text appears in its label, ignoring case. */
export function matchingCommands(query: string): Command[] {
  const parts = query.toLowerCase().split(" ").filter(Boolean);
  return COMMANDS.filter((command) => parts.every((part) => command.label.toLowerCase().includes(part)));
}
