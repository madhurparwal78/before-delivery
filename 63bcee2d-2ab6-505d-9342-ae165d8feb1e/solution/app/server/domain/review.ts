import type { Role } from "../auth.js";

// Shop-drawing reviews (brief: Shop-drawing review clock): the code labels, who returns a submission, that each
// submission is returned once, and which codes allow resubmission.

export const REVIEW_CODES = ["Code 1 Proceed", "Code 2 Proceed with comments", "Code 3 Revise and resubmit", "Code 4 Rejected"] as const;

export const reviewCodeLabel = (code: number): string => REVIEW_CODES[code - 1];

/** Codes 3 and 4 send the drawing back for a new submission. */
export const canResubmit = (code: number): boolean => code === 3 || code === 4;

export const REVIEWERS: readonly Role[] = ["director", "project_lead", "designer"];

/** A submission is returned once: it awaits review until it has a code. */
export const awaitingReview = (code: number | null): boolean => code === null;

/** Whether the member may return the submission now. */
export const mayReview = (role: Role, code: number | null): boolean => REVIEWERS.includes(role) && awaitingReview(code);
