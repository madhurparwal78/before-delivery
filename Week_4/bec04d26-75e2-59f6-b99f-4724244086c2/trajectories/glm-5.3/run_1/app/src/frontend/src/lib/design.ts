/** The steady per-state tile colour rotation, by the state's position in the practice's sorted codes. */
export type TileColour = 'orange' | 'green' | 'yellow' | 'black';

const ROTATION: TileColour[] = ['orange', 'green', 'yellow', 'black'];

export function stateColour(stateCodes: string[], code: string): TileColour {
  const index = stateCodes.indexOf(code);
  return ROTATION[Math.max(0, index) % ROTATION.length];
}

export function tileClass(colour: TileColour): string {
  return `tile tile-${colour}`;
}

export const STATUS_LABELS: Record<string, string> = {
  not_started: 'Not started',
  prepared: 'Prepared',
  client_approved: 'Client approved',
  filed: 'Filed',
  packeted: 'Packeted',
  amended: 'Amended',
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function nextStepLabel(status: string): string {
  if (status === 'not_started') return 'Prepare return';
  if (status === 'prepared') return 'Check approval';
  if (status === 'client_approved') return 'File return';
  if (status === 'filed') return 'Check packet';
  return 'Open return';
}

/** `Monday June 22`, no comma, from a date the server sent. */
export function dateLine(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${weekdays[dt.getUTCDay()]} ${months[m - 1]} ${d}`;
}

export function periodLabel(period: string): string {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  if (period.length === 4) return period;
  if (period.includes('Q')) return `${period.slice(5)} ${period.slice(0, 4)}`;
  return `${months[Number(period.slice(5)) - 1]} ${period.slice(0, 4)}`;
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
