const pacific = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function pacificFields(at: Date): number {
  const parts = pacific.formatToParts(at);
  const read = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return Date.UTC(read("year"), read("month") - 1, read("day"), read("hour"), read("minute"), read("second"));
}

/** Reads "YYYY-MM-DD HH:MM" written in Tidecraft's time zone as an exact instant. */
export function pacificToInstant(typed: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(typed.trim());
  if (match === null) return typed.trim();
  const wanted = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  );
  let guess = new Date(wanted);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offset = pacificFields(guess) - guess.getTime();
    if (offset === 0) break;
    guess = new Date(guess.getTime() + (wanted - pacificFields(guess)));
  }
  return guess.toISOString();
}
