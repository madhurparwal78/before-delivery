const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** `<office date>`, for example `Fri 1 Jan`. Built from the server's office date only. */
export function officeDate(date: string): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `${WEEKDAYS[weekday]} ${day} ${MONTHS[month - 1]}`;
}

export function officeDateWithYear(date: string): string {
  return `${officeDate(date)} ${date.slice(0, 4)}`;
}

/** `<office stamp>` from the server's own office date, time and offset. */
export function officeStamp(date: string, time: string, offset: string): string {
  return `${officeDate(date)}, ${time} ${offset}`;
}

const ZONE = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  timeZoneName: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** The offset in effect at an office midnight, read with the same zone rule the server uses. */
export function officeOffsetAtMidnight(date: string): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  for (const hour of [5, 6]) {
    const read: Record<string, string> = {};
    for (const part of ZONE.formatToParts(new Date(Date.UTC(year, month - 1, day, hour)))) {
      read[part.type] = part.value;
    }
    if (Number(read.day) === day && read.hour === '00' && read.minute === '00') {
      return read.timeZoneName === 'CDT' ? 'CDT' : 'CST';
    }
  }
  return 'CST';
}

export function addDays(date: string, days: number): string {
  const moved = new Date(
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) + days),
  );
  return `${String(moved.getUTCFullYear()).padStart(4, '0')}-${String(moved.getUTCMonth() + 1).padStart(2, '0')}-${String(moved.getUTCDate()).padStart(2, '0')}`;
}

export function displayName(named: { name: string; formerly: string | null }): string {
  return named.formerly === null ? named.name : `${named.name} (formerly ${named.formerly})`;
}

export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] as string}`;
}

export const SEAT_CELL: Record<string, string> = {
  confirmed: 'Seat confirmed',
  waiting_on_billing: 'Waiting on billing',
  release_waiting: 'Release waiting on billing',
  released: 'Released',
};

export const ROLE_LABEL: Record<string, string> = {
  office_manager: 'Office manager',
  managing_partner: 'Managing partner',
  staff_accountant: 'Staff accountant',
  outside_bookkeeper: 'Outside bookkeeper',
};

export const ROLE_ORDER = ['office_manager', 'managing_partner', 'staff_accountant', 'outside_bookkeeper'] as const;

export const HEALTH_LABEL: Record<string, string> = {
  sound: 'Sound',
  out_of_policy: 'Out of policy',
  exposed: 'Exposed',
  vendor_breached: 'Vendor breached',
  not_checked: 'Not checked',
};

export const PERSON_STATUS: Record<string, string> = {
  invited: 'Invited',
  active: 'Active',
  travelling: 'Travelling',
  on_term: 'On term',
  left: 'Left',
};

export const REVIEW_STATUS: Record<string, string> = {
  open: 'Open',
  overdue: 'Overdue',
  signed_off: 'Signed off',
};
