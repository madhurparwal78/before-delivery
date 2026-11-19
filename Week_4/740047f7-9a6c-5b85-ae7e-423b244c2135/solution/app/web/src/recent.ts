// The pens opened in this browser, most recent first.
const KEY = "pensight.recent";

export function recentPens(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function rememberPen(id: string): void {
  localStorage.setItem(KEY, JSON.stringify([id, ...recentPens().filter((x) => x !== id)].slice(0, 12)));
}
