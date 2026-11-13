import type { Mode, TicketLength, TicketRequest } from "../shared/protocol";

const KEY = "strikeproof.test";

export type LengthChoice = 15 | 30 | 60 | 120 | 10 | 25 | 50 | 100 | "short" | "medium" | "long" | "all";

export const MODE_LENGTHS: Readonly<Record<Exclude<Mode, "custom">, readonly LengthChoice[]>> = {
  time: [15, 30, 60, 120],
  words: [10, 25, 50, 100],
  quote: ["short", "medium", "long", "all"],
};

/** What the typist last chose, kept in the browser across reloads. */
export interface TestChoice {
  readonly mode: Mode;
  readonly lengths: Readonly<Record<Exclude<Mode, "custom">, LengthChoice>>;
  readonly punctuation: boolean;
  readonly numbers: boolean;
  readonly customText: string;
}

const DEFAULT_CHOICE: TestChoice = {
  mode: "time",
  lengths: { time: 15, words: 10, quote: "all" },
  punctuation: false,
  numbers: false,
  customText: "",
};

export function loadChoice(): TestChoice {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<TestChoice>;
    return { ...DEFAULT_CHOICE, ...stored, lengths: { ...DEFAULT_CHOICE.lengths, ...stored.lengths } };
  } catch {
    return DEFAULT_CHOICE;
  }
}

export function saveChoice(choice: TestChoice): void {
  localStorage.setItem(KEY, JSON.stringify(choice));
}

export function currentLength(choice: TestChoice): LengthChoice | null {
  return choice.mode === "custom" ? null : choice.lengths[choice.mode];
}

/** The ticket request for a choice: quote and custom tests never carry punctuation or numbers. */
export function ticketRequest(choice: TestChoice): TicketRequest {
  const decorated = choice.mode === "time" || choice.mode === "words";
  return {
    mode: choice.mode,
    length: currentLength(choice) as TicketLength,
    punctuation: decorated && choice.punctuation,
    numbers: decorated && choice.numbers,
    text: choice.mode === "custom" ? choice.customText : null,
  };
}
