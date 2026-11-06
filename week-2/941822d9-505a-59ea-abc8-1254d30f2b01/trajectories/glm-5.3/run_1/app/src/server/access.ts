import { notFound } from "./errors.ts";
import type { PoolClient } from "pg";

// Record access: a learner reads only their own records; a coordinator reads an
// enrolment or certificate only when their hospital funded it; the planner
// reads everything. Every other id answers 404.

export type CourseRow = { id: string; state: string; author_id: string };

export type User = {
  id: string;
  role: "learner" | "coordinator" | "planner" | "author";
  organisation_id: string | null;
};

/** May this user read this course record? Draft and in-review courses are
 * readable only by their author and the planner. */
export const mayReadCourse = (user: User, course: CourseRow): boolean =>
  course.state === "published" ||
  course.state === "withdrawn" ||
  user.role === "planner" ||
  (user.role === "author" && course.author_id === user.id);

export const assertCourseReadable = (user: User, course: CourseRow): void => {
  if (!mayReadCourse(user, course)) throw notFound();
};

export type EnrolmentAccessRow = {
  id: string;
  nurse_id: string;
  funding: string;
  hospital_id: string | null;
};

export const mayReadEnrolment = (user: User, row: EnrolmentAccessRow): boolean =>
  user.role === "planner" ||
  user.id === row.nurse_id ||
  (user.role === "coordinator" && user.organisation_id !== null &&
    row.hospital_id === user.organisation_id &&
    (row.funding === "seat" || row.funding === "co_pay"));

export const assertEnrolmentReadable = (user: User, row: EnrolmentAccessRow): void => {
  if (!mayReadEnrolment(user, row)) throw notFound();
};

export type HospitalIdRow = { hospital_id: string | null };

export async function coordinatorHospital(client: PoolClient, user: User): Promise<string | null> {
  if (user.role !== "coordinator" || user.organisation_id === null) return null;
  const { rows } = await client.query<{ id: string }>(`SELECT id FROM organisations WHERE id = $1 AND kind = 'hospital'`, [
    user.organisation_id,
  ]);
  return rows[0]?.id ?? null;
}
