const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const TIME_ZONE = "America/Los_Angeles";

const instantParts = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export const groupThousands = (count: number): string => count.toLocaleString("en-US");

export function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** A decimal string such as 1346.31 as $1,346.31, without ever passing through a float. */
export function dollars(amount: string): string {
  const [whole = "0", fraction] = amount.split(".");
  return `$${groupDigits(whole)}${fraction === undefined ? "" : `.${fraction}`}`;
}

/** A date YYYY-MM-DD as 28 Feb 2027. */
export function displayDate(date: string): string {
  const [year = "", month = "1", day = "1"] = date.split("-");
  return `${Number.parseInt(day, 10)} ${MONTHS[Number.parseInt(month, 10) - 1] ?? ""} ${year}`;
}

/** An instant as 28 Feb 2027, 14:05:09 PT, in Tidecraft's time zone whatever the device zone. */
export function displayInstant(instant: string): string {
  const parts = Object.fromEntries(instantParts.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
  return `${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute}:${parts.second} PT`;
}

const two = (value: number): string => String(value).padStart(2, "0");

/** A number of seconds as <D>d <HH>:<MM>:<SS>. */
export function countdown(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  const days = Math.floor(whole / 86400);
  const rest = whole % 86400;
  return `${days}d ${two(Math.floor(rest / 3600))}:${two(Math.floor((rest % 3600) / 60))}:${two(rest % 60)}`;
}

export const VESTING_LABEL = {
  standard: "4 years, 1-year cliff",
  monthly: "4 years monthly, no cliff",
} as const;

export const ROLE_LABEL = {
  founder_admin: "Founder admin",
  board_member: "Board member",
  option_holder: "Option holder",
  leaver: "Leaver",
  investor: "Investor",
} as const;
