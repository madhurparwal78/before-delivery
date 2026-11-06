/** Domain constants shared by server and client. */

export const BOARDS = ["women", "men", "creators", "new_faces"] as const;
export type Board = (typeof BOARDS)[number];

export const BOARD_TITLES: Record<Board, string> = {
  women: "Women",
  men: "Men",
  creators: "Creators",
  new_faces: "New Faces",
};

export const OFFICES = ["toronto", "vancouver"] as const;
export type Office = (typeof OFFICES)[number];

export const OFFICE_META: Record<Office, { city: string; timeZone: string; desk: string }> = {
  toronto: { city: "Toronto", timeZone: "America/Toronto", desk: "toronto-desk@vesperrowe.example" },
  vancouver: { city: "Vancouver", timeZone: "America/Vancouver", desk: "vancouver-desk@vesperrowe.example" },
};

export const MEASUREMENT_FIELDS = ["height", "chest", "waist", "hips"] as const;
export type MeasurementField = (typeof MEASUREMENT_FIELDS)[number];

export const MEDIA = ["digital", "print", "out_of_home", "broadcast"] as const;
export type Media = (typeof MEDIA)[number];

export const MEDIA_TITLES: Record<Media, string> = {
  digital: "Digital",
  print: "Print",
  out_of_home: "Out of home",
  broadcast: "Broadcast",
};

export const TERRITORIES = ["canada", "north_america", "worldwide"] as const;
export type Territory = (typeof TERRITORIES)[number];

export const TERRITORY_TITLES: Record<Territory, string> = {
  canada: "Canada",
  north_america: "North America",
  worldwide: "Worldwide",
};

export const TERM_MONTHS = [3, 6, 12] as const;

export const USAGE_TERMS: Record<number, number> = { 3: 50, 6: 75, 12: 100 };

export const TERRITORY_PERCENT: Record<Territory, number> = {
  canada: 100,
  north_america: 150,
  worldwide: 250,
};

export const CLOSURE_DATES: Record<Office, string[]> = {
  toronto: [
    "2026-01-01", "2026-02-16", "2026-04-03", "2026-05-18", "2026-07-01", "2026-08-03", "2026-09-07", "2026-10-12", "2026-12-25", "2026-12-28",
    "2027-01-01", "2027-02-15", "2027-03-26", "2027-05-24", "2027-07-01", "2027-08-02", "2027-09-06", "2027-10-11", "2027-12-27", "2027-12-28",
  ],
  vancouver: [
    "2026-01-01", "2026-02-16", "2026-04-03", "2026-05-18", "2026-07-01", "2026-08-03", "2026-09-07", "2026-09-30", "2026-10-12", "2026-11-11", "2026-12-25",
    "2027-01-01", "2027-02-15", "2027-03-26", "2027-05-24", "2027-07-01", "2027-08-02", "2027-09-06", "2027-09-30", "2027-10-11", "2027-11-11", "2027-12-27",
  ],
};

export const ROLE_HOME: Record<string, string> = {
  agency_director: "/workspace/overview",
  booker: "/workspace/board",
  accounts_lead: "/workspace/licences",
  scout: "/workspace/applications",
  talent: "/workspace/me",
};

export const ROLE_TITLES: Record<string, string> = {
  agency_director: "Agency director",
  booker: "Booker",
  accounts_lead: "Accounts lead",
  scout: "Scout",
  talent: "Talent",
};

export const WORKSPACE_ROLES = ["agency_director", "booker", "accounts_lead", "scout"] as const;

export const APPLICATION_SLOTS = ["front", "profile", "full_length", "smile"] as const;
export type ApplicationSlot = (typeof APPLICATION_SLOTS)[number];

export const SLOT_TITLES: Record<ApplicationSlot, string> = {
  front: "Front photo",
  profile: "Profile photo",
  full_length: "Full-length photo",
  smile: "Smiling photo",
};

export const PACKAGE_TTL_FALLBACK = 1209600;

export const IDENT = {
  chars: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
};

export function randomToken(length = 32): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += IDENT.chars[bytes[i] % IDENT.chars.length];
  return out;
}

export function ordinal(rank: number): string {
  return rank === 1 ? "1st" : rank === 2 ? "2nd" : "3rd";
}
