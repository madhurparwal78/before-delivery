/** Club-local wall-clock text for a stored instant, so every device shows the same field values. */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let found = formatters.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, found);
  }
  return found;
}

export function clubFieldText(iso: string | null, timeZone: string): string {
  if (!iso) return '';
  const parts = formatter(timeZone).formatToParts(new Date(iso));
  const lookup: Record<string, string> = {};
  for (const part of parts) lookup[part.type] = part.value;
  const date = `${lookup.year}-${lookup.month}-${lookup.day}`;
  const clock = `${lookup.hour}:${lookup.minute}`;
  return lookup.second === '00' ? `${date} ${clock}` : `${date} ${clock}:${lookup.second}`;
}

/** Turns a typed club-time field into the API's local format. */
export function fieldTextToLocal(text: string): string {
  return text.trim().replace(' ', 'T');
}
