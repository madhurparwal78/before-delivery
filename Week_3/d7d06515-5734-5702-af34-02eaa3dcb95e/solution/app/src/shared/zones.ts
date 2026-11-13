// Studio time zones offered at sign-up (brief: Seed data > Studio time zones). The first is the default.
export const STUDIO_ZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Europe/London',
  'Europe/Berlin', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney',
] as const;
export type StudioZone = (typeof STUDIO_ZONES)[number];
