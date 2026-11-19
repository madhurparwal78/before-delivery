import { dateWords } from "../../shared/calendar";
import { clockWords, localDate, offsetMinutes, PRACTICE_ZONE, zoneLabel } from "./zone";

/** `Due Monday June 22, 11:59 pm Eastern` */
export const dueLine = (dueDate: string, zone: string): string =>
  `Due ${dateWords(dueDate)}, 11:59 pm ${zoneLabel(zone)}`;

/** `11:59 pm Pacific` */
export const localDeadlineLabel = (dueAt: number, zone: string): string =>
  `${clockWords(dueAt, zone)} ${zoneLabel(zone)}`;

/** `1:59 am Central` */
export const practiceDeadlineLabel = (dueAt: number): string =>
  `${clockWords(dueAt, PRACTICE_ZONE)} ${zoneLabel(PRACTICE_ZONE)}`;

/** The state's UTC offset minus Central's, in hours, at the deadline. */
export const offsetHours = (dueAt: number, zone: string): number =>
  (offsetMinutes(dueAt, zone) - offsetMinutes(dueAt, PRACTICE_ZONE)) / 60;

/** `Monday June 22, 10:00 am Central` */
export const practiceMoment = (ms: number): string =>
  `${dateWords(localDate(ms, PRACTICE_ZONE))}, ${clockWords(ms, PRACTICE_ZONE)} ${zoneLabel(PRACTICE_ZONE)}`;

export const toIso = (ms: number): string => new Date(ms).toISOString();
