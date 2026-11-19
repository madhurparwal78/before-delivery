export function one<E extends Element = HTMLElement>(
  selector: string,
  scope: ParentNode = document,
): E | null {
  return scope.querySelector<E>(selector);
}

export function all<E extends Element = HTMLElement>(
  selector: string,
  scope: ParentNode = document,
): E[] {
  return [...scope.querySelectorAll<E>(selector)];
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function narrow(): boolean {
  return window.innerWidth < 720;
}

export function setStatus(element: Element | null, message: string): void {
  if (element === null) return;
  element.textContent = message;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export type ApiFailure = {
  readonly status: number;
  readonly message: string;
  readonly fields: Readonly<Record<string, string>>;
};

export const UNREACHABLE = "We couldn't reach Aldermoor. Check your connection and try again.";

export async function readFailure(response: Response): Promise<ApiFailure> {
  try {
    const payload = (await response.json()) as {
      message?: string;
      fields?: Record<string, string>;
    };
    return {
      status: response.status,
      message: payload.message ?? UNREACHABLE,
      fields: payload.fields ?? {},
    };
  } catch {
    return { status: response.status, message: UNREACHABLE, fields: {} };
  }
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function parts(instant: Date, zone: string | undefined): Record<string, number> {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const result: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== 'literal') result[part.type] = Number.parseInt(part.value, 10);
  }
  return result;
}

/** "<D Month YYYY, HH:mm>" in the given zone, or the reader's zone when none is given. */
export function formatDateTime(instant: Date, zone?: string): string {
  const read = parts(instant, zone);
  const day = read.day ?? 1;
  const month = MONTHS[(read.month ?? 1) - 1] ?? '';
  const hour = String(read.hour ?? 0).padStart(2, '0');
  const minute = String(read.minute ?? 0).padStart(2, '0');
  return `${day} ${month} ${read.year ?? 0}, ${hour}:${minute}`;
}

export function formatCalendarDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match === null) return value;
  return `${Number.parseInt(match[3] as string, 10)} ${
    MONTHS[Number.parseInt(match[2] as string, 10) - 1] ?? ''
  } ${match[1]}`;
}
