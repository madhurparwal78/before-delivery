export const km = (metres) => (metres / 1000).toFixed(2);

export function duration(seconds) {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export const mmss = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
export const pace = (seconds) => `${mmss(seconds)} /km`;

export function dateTime(iso, zone = "UTC") {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: zone }).format(new Date(iso));
}

export function shortDate(iso, zone = "UTC") {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: zone }).format(new Date(iso));
}

export const initials = (name) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

export const thousands = (value, digits = 0) =>
  value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const SPORT_NAMES = { run: "Run", ride: "Ride", walk: "Walk", hike: "Hike" };
export const VISIBILITY_NAMES = { everyone: "Everyone", followers: "Followers", only_me: "Only You" };
