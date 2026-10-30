import { providerCloseInstant } from "./time.ts";

// Seats remaining and the cohort close instant live here and nowhere else.

export type CohortRecord = {
  id: string;
  course_id: string;
  name: string;
  starts_on: string;
  close_date: string;
  seat_cap: number;
};

export const SEAT_OCCUPYING_STATES = "('held','confirmed','completed','certified')";

export const closeInstantOf = (closeDate: string): Date => providerCloseInstant(closeDate);

export const cohortOpen = (closeDate: string): boolean => Date.now() < closeInstantOf(closeDate).getTime();

export const seatsRemaining = (seatCap: number, activeEnrolments: number): number => seatCap - activeEnrolments;
