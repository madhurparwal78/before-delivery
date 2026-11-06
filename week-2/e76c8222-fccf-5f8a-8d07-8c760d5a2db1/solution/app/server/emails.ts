// The five emails of the brief's Services table.
import { SETTING_LABELS, type Setting } from "../shared/domain.js";
import { agencyDate, agencyTime, cardDate } from "../shared/time.js";
import { config } from "./config.js";
import type { Mail } from "./outbox.js";
import { refOf, type RequestRow } from "./views.js";

interface Job {
  ref: string;
  title: string;
  setting: Setting;
  location: string;
  start: Date;
  end: Date;
  orgName: string;
}

const when = (job: Job): string => `${cardDate(job.start)} ${agencyDate(job.start)}, ${agencyTime(job.start)}–${agencyTime(job.end)} Eastern Time`;

const signOff = ["", "Fernhollow Access Dispatch"];

export function offerMail(to: string, job: Job, seat: { position: number; total: number }, expiresAt: Date, token: string): Mail {
  return {
    to,
    subject: `Offer for ${job.ref} on ${agencyDate(job.start)}`,
    body: [
      `You have an offer for ${job.ref}, seat ${seat.position} of ${seat.total}.`,
      "",
      `${job.title}`,
      `Setting: ${SETTING_LABELS[job.setting]} (${job.setting})`,
      `Organisation: ${job.orgName}`,
      `When: ${when(job)}`,
      `Location: ${job.location}`,
      `Answer by: ${agencyDate(expiresAt)} ${agencyTime(expiresAt)} Eastern Time`,
      "",
      "Open the offer to accept or decline:",
      `${config.publicUrl}/offers/${token}`,
      ...signOff,
    ].join("\n"),
  };
}

export function staffedMail(to: string, job: Job, interpreters: string[]): Mail {
  return {
    to,
    subject: `Staffed: ${job.ref} on ${agencyDate(job.start)}`,
    body: [
      `${job.ref} ${job.title} is fully staffed.`,
      `When: ${when(job)}`,
      `Location: ${job.location}`,
      "",
      "Seated interpreters:",
      ...interpreters.map((name) => `- ${name}`),
      ...signOff,
    ].join("\n"),
  };
}

export function cancelledMail(to: string, job: Job, late: boolean, feePerInterpreter: string): Mail {
  return {
    to,
    subject: `Cancelled: ${job.ref} on ${agencyDate(job.start)}`,
    body: [
      `${job.orgName} cancelled ${job.ref} ${job.title}.`,
      `When: ${when(job)}`,
      "",
      late ? `Late cancellation. Charge per interpreter: $${feePerInterpreter}` : "On-time cancellation. No charge.",
      ...signOff,
    ].join("\n"),
  };
}

export function credentialWarningMail(to: string, type: string, number: string, expiresOn: string): Mail {
  return {
    to,
    subject: `Credential expiring: ${type} on ${expiresOn}`,
    body: [
      `Your ${type} credential ${number} expires on ${expiresOn}.`,
      "Add the renewed credential and its scan under My credentials so dispatch can keep offering you this work.",
      ...signOff,
    ].join("\n"),
  };
}

export function timesheetApprovedMail(to: string, job: Job, interpreter: string, billedHours: string, amount: string): Mail {
  return {
    to,
    subject: `Timesheet approved: ${job.ref}`,
    body: [
      `The timesheet for ${job.ref} ${job.title} is approved.`,
      `Interpreter: ${interpreter}`,
      `Billed hours: ${billedHours}`,
      `Amount: $${amount}`,
      ...signOff,
    ].join("\n"),
  };
}

export const jobOf = (r: RequestRow): Job => ({
  ref: refOf(r.ref_no),
  title: r.title,
  setting: r.setting,
  location: r.location,
  start: r.start_at,
  end: r.end_at,
  orgName: r.org_name,
});
