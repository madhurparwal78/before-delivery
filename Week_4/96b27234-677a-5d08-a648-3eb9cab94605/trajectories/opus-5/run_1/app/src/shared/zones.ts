export interface ZoneEntry {
  readonly name: string;
  readonly standardOffset: number;
  readonly standardAbbreviation: string;
  readonly daylightAbbreviation: string | null;
}

export const ZONES: readonly ZoneEntry[] = [
  { name: 'America/New_York', standardOffset: -300, standardAbbreviation: 'EST', daylightAbbreviation: 'EDT' },
  { name: 'America/Los_Angeles', standardOffset: -480, standardAbbreviation: 'PST', daylightAbbreviation: 'PDT' },
  { name: 'Europe/London', standardOffset: 0, standardAbbreviation: 'GMT', daylightAbbreviation: 'BST' },
  { name: 'Europe/Berlin', standardOffset: 60, standardAbbreviation: 'CET', daylightAbbreviation: 'CEST' },
  { name: 'Asia/Kolkata', standardOffset: 330, standardAbbreviation: 'IST', daylightAbbreviation: null },
  { name: 'Asia/Tokyo', standardOffset: 540, standardAbbreviation: 'JST', daylightAbbreviation: null },
  { name: 'Australia/Sydney', standardOffset: 600, standardAbbreviation: 'AEST', daylightAbbreviation: 'AEDT' }
];
