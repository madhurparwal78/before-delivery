// Studio wall time on the console: formatting and the accepted zone set, mirroring the server.

export function isValidZoneClient(name: string): boolean {
  const extra = new Set([
    "UTC", "America/Vancouver", "America/St_Johns", "Europe/London", "Asia/Kolkata", "Asia/Kathmandu",
    "Australia/Adelaide", "Australia/Eucla", "Australia/Lord_Howe", "Pacific/Chatham",
  ]);
  if (extra.has(name)) return true;
  try {
    return (Intl.supportedValuesOf("timeZone") as string[]).includes(name);
  } catch {
    return false;
  }
}

const PAD = (n: number, w = 2) => String(n).padStart(w, "0");

export function formatLocalClient(zone: string, ms: number): string {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const parts = dtf.formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

void PAD;
