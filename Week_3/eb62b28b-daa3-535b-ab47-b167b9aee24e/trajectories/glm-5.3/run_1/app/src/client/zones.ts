export const ZONES: Record<string, string> = {
  newYork: "America/New_York",
  chicago: "America/Chicago",
  denver: "America/Denver",
  phoenix: "America/Phoenix",
  losAngeles: "America/Los_Angeles",
};

export const CITIES: Record<string, string> = {
  newYork: "New York",
  chicago: "Chicago",
  denver: "Denver",
  phoenix: "Phoenix",
  losAngeles: "Los Angeles",
};

export const STAFF_ZONE = "America/Phoenix";

export function zoneFor(timeZone: string): string {
  return ZONES[timeZone] ?? "America/Phoenix";
}

export function cityFor(timeZone: string): string {
  return CITIES[timeZone] ?? "Phoenix";
}
