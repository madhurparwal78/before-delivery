// Agency time: every date and time the app shows or accepts is Eastern Time on a 24-hour clock.
const AGENCY_TZ = "America/New_York";

interface AgencyParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const numeric = new Intl.DateTimeFormat("en-US", {
  timeZone: AGENCY_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const wordy = new Intl.DateTimeFormat("en-GB", {
  timeZone: AGENCY_TZ,
  weekday: "long",
  day: "numeric",
  month: "long",
});

const brief = new Intl.DateTimeFormat("en-GB", {
  timeZone: AGENCY_TZ,
  weekday: "short",
  day: "numeric",
  month: "short",
});

function parts(instant: Date): AgencyParts {
  const found: Record<string, number> = {};
  for (const part of numeric.formatToParts(instant)) {
    if (part.type !== "literal") found[part.type] = Number.parseInt(part.value, 10);
  }
  return {
    year: found.year ?? 0,
    month: found.month ?? 0,
    day: found.day ?? 0,
    hour: found.hour ?? 0,
    minute: found.minute ?? 0,
    second: found.second ?? 0,
  };
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** YYYY-MM-DD in agency time. */
export function agencyDate(instant: Date): string {
  const p = parts(instant);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** HH:MM in agency time, 24-hour clock. */
export function agencyTime(instant: Date): string {
  const p = parts(instant);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** The typed form the date-and-time textboxes accept: YYYY-MM-DDTHH:MM. */
export function agencyInput(instant: Date): string {
  return `${agencyDate(instant)}T${agencyTime(instant)}`;
}

function wordParts(format: Intl.DateTimeFormat, instant: Date): string {
  const found: Record<string, string> = {};
  for (const part of format.formatToParts(instant)) found[part.type] = part.value;
  return `${found.weekday} ${found.day} ${found.month}`;
}

/** "Tue 27 Oct", used on cards. */
export function cardDate(instant: Date): string {
  return wordParts(brief, instant);
}

/** "Tuesday 27 October", used in day headings. */
export function dayHeading(instant: Date): string {
  return wordParts(wordy, instant);
}

const INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** Reads a typed agency date-time; null when the text is not a real agency time. */
export function fromAgencyInput(text: string): Date | null {
  const m = INPUT.exec(text.trim());
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1).map((v) => Number.parseInt(v, 10)) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wanted;
  for (let i = 0; i < 2; i += 1) {
    const p = parts(new Date(guess));
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += wanted - shown;
  }
  const result = new Date(guess);
  return agencyInput(result) === `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}` ? result : null;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written YYYY-MM-DD. */
export function isCalendarDate(text: string): boolean {
  const m = DATE.exec(text);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === text;
}
