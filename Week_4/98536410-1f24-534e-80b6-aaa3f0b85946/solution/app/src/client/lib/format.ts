export { formatEuro } from "../../shared/euro";

export function formatKm(km: number): string {
  return km.toFixed(2);
}

/** m:ss with whole minutes and no leading zero. */
export function formatCountdown(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const LISBON_CLOCK = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Lisbon", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const LISBON_STAMP = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

/** HH:mm in Lisbon time for an instant the server gave. */
export function lisbonClock(ms: number): string {
  return LISBON_CLOCK.format(ms);
}

/** YYYY-MM-DD HH:mm in Lisbon time. */
export function lisbonStamp(iso: string): string {
  const parts = Object.fromEntries(LISBON_STAMP.formatToParts(Date.parse(iso)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

export const REGION_NAMES: Record<string, string> = {
  norte: "Norte", centro: "Centro", sul: "Sul", sao_miguel: "São Miguel", terceira: "Terceira",
};

/** A VAT-inclusive unit price in thousandths of a euro: two decimals, three when the third is not zero. */
export function formatMilli(milli: number): string {
  const whole = Math.trunc(milli / 1000);
  const thousandths = String(milli % 1000).padStart(3, "0");
  return `${whole},${thousandths.endsWith("0") ? thousandths.slice(0, 2) : thousandths} €`;
}
