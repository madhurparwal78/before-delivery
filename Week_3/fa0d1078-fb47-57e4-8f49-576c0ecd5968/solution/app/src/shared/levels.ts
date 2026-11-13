export const LEVELS = ["easy", "medium", "hard", "expert"] as const;
export type Level = (typeof LEVELS)[number];

export const LEVEL_NAMES: Readonly<Record<Level, string>> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
  expert: "Expert",
};

export function isLevel(value: unknown): value is Level {
  return typeof value === "string" && (LEVELS as readonly string[]).includes(value);
}
