import { describeRituals, startsAt, totalMinutes, type RitualChoice } from "../src/shared/hour";
import { config } from "./config";

const LINK_LINE = "This link works once, for 15 minutes.";

export interface HourSummary {
  bedtime: string;
  time_zone: string;
  rituals: RitualChoice[];
}

const ritualLines = (rituals: RitualChoice[]) => [
  ...describeRituals(rituals).map((ritual) => `  ${ritual.title} · ${ritual.minutes} min`),
  `  ${totalMinutes(rituals)} minutes in all`,
];

const signInUrl = (token: string) => `${config.origin}/signin?token=${token}`;

export function confirmMail(token: string, hour: HourSummary) {
  return {
    subject: "Confirm your Stillhour",
    text: [
      "You planned a Stillhour. Confirm it and we will send one email each night when your hour starts.",
      "",
      `Bedtime ${hour.bedtime}, ${hour.time_zone} time. Your hour starts at ${startsAt(hour.bedtime)}.`,
      "",
      ...ritualLines(hour.rituals),
      "",
      `Confirm your hour: ${signInUrl(token)}`,
      LINK_LINE,
    ].join("\n"),
  };
}

export function signInMail(token: string) {
  return {
    subject: "Your Stillhour sign-in link",
    text: ["Here is your link to manage your Stillhour.", "", `Sign in: ${signInUrl(token)}`, LINK_LINE].join("\n"),
  };
}

/** `startsAtLocal` is the local time the reminder is due that night (after any clock change). */
export function reminderMail(hour: HourSummary, startsAtLocal: string) {
  return {
    subject: `Your Stillhour starts at ${startsAtLocal}`,
    text: [
      `Your hour before sleep starts now, for bed at ${hour.bedtime}.`,
      "",
      ...ritualLines(hour.rituals),
      "",
      `Change or pause your reminders: ${config.origin}/manage`,
    ].join("\n"),
  };
}
