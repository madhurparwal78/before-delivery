const grouped = (n: number): string => {
  const whole = Math.trunc(Math.abs(n)).toString();
  let out = "";
  for (let i = 0; i < whole.length; i += 1) {
    if (i > 0 && (whole.length - i) % 3 === 0) out += ",";
    out += whole[i];
  }
  return (n < 0 ? "-" : "") + out;
};

/** euros writes a whole-euro amount as the brief's <euros> placeholder. */
export const euros = (n: number): string => `€${grouped(n)}`;

/** plainEuros writes a whole-euro figure without its euro sign. */
export const plainEuros = (n: number): string => grouped(n);

/** amount writes a two-decimal wire amount as the brief's <amount>. */
export const amount = (wire: string): string => {
  const negative = wire.startsWith("-");
  const [whole, cents = "00"] = wire.replace("-", "").split(".");
  return `${negative ? "-" : ""}€${grouped(Number(whole))}.${cents}`;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const rotterdamParts = (iso: string): Record<string, string> => {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Amsterdam",
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(iso))) parts[part.type] = part.value;
  return parts;
};

/**
 * rotterdamTime writes a server time in Rotterdam local time, as the brief's
 * <rotterdam time> placeholder. The device clock is never consulted.
 */
export const rotterdamTime = (iso: string): string => {
  const p = rotterdamParts(iso);
  const hour = p.hour === "24" ? "00" : p.hour;
  return `${Number(p.day)} ${MONTHS[Number(p.month) - 1]} ${p.year}, ${hour}:${p.minute}:${p.second}`;
};

/** timeLeft writes a count of seconds as the brief's <time left> placeholder. */
export const timeLeft = (totalSeconds: number): string => {
  const total = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (days >= 1) return `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  if (hours >= 1) return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return `${minutes}:${pad(seconds)}`;
};
