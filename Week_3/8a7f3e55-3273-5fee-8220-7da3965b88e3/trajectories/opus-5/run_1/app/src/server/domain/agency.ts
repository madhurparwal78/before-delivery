import { env } from '../env.js';

export const AGENCY = {
  name: 'Tandem Hands Collective',
  timeZone: 'America/Chicago',
  soloThresholdMinutes: 60,
} as const;

export const UPLOAD_LIMIT_BYTES = 10_000_000;
export const MAX_FILES_PER_BOOKING = 10;
export const MAX_MULTIPART_BYTES = 10_100_000;
export const MAX_JSON_BYTES = 65_536;

export const ACCEPTED_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
] as const;

export const openCallLeadMinutes = (): number => env.openCallLeadMinutes;
export const prepAccessGraceMinutes = (): number => env.prepAccessGraceMinutes;
export const prepLinkTtlSeconds = (): number => env.prepLinkTtlSeconds;
