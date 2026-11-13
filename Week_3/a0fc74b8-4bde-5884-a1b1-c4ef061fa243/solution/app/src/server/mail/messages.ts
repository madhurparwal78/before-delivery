import { config } from "../config.js";
import type { Envelope } from "./smtp.js";
import { singleLine } from "../util.js";

export type MailKind = "invitation" | "reminder" | "new_link" | "decline_notice" | "void_notice" | "completed";

export interface MailFacts {
  kind: MailKind;
  toEmail: string;
  title: string;
  senderName: string;
  linkToken: string | null;
  reason: string | null;
  actorName: string | null;
  completedSha256: string | null;
  downloadPath: string | null;
}

function parseMailFrom(): { name: string | null; address: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(config.mailFrom);
  if (!match) return { name: null, address: config.mailFrom.trim() };
  return { name: match[1] ? match[1] : null, address: match[2] ?? config.mailFrom };
}

function signLink(token: string): string {
  return `${config.publicUrl}/sign/${token}`;
}

export function composeMail(facts: MailFacts): Envelope {
  const base = parseMailFrom();
  const title = singleLine(facts.title);
  const sender = singleLine(facts.senderName);
  const reason = singleLine(facts.reason ?? "");
  const actor = singleLine(facts.actorName ?? "");
  const viaSender = { fromAddress: base.address, fromName: `${sender} via Undersign`, to: facts.toEmail };
  const system = { fromAddress: base.address, fromName: base.name, to: facts.toEmail };
  switch (facts.kind) {
    case "invitation":
      return {
        ...viaSender,
        subject: `Please sign: ${title}`,
        body: [`${sender} has asked you to sign "${title}".`, "", `Open the document: ${signLink(facts.linkToken ?? "")}`, "", "This link is for you alone."].join("\n"),
      };
    case "reminder":
      return {
        ...viaSender,
        subject: `Reminder: please sign ${title}`,
        body: [`${sender} is waiting for your signature on "${title}".`, "", `Open the document: ${signLink(facts.linkToken ?? "")}`].join("\n"),
      };
    case "new_link":
      return {
        ...viaSender,
        subject: `New link: ${title}`,
        body: [`${sender} has sent you a new link to sign "${title}". Earlier links no longer work.`, "", `Open the document: ${signLink(facts.linkToken ?? "")}`].join("\n"),
      };
    case "decline_notice":
      return {
        ...system,
        subject: `Declined: ${title}`,
        body: [`${actor} declined to sign "${title}". No further signatures are needed.`, "", `Reason: ${reason}`].join("\n"),
      };
    case "void_notice":
      return {
        ...system,
        subject: `Voided: ${title}`,
        body: [`${actor} voided "${title}". No further signatures are needed.`, "", `Reason: ${reason}`].join("\n"),
      };
    case "completed":
      return {
        ...system,
        subject: `Completed: ${title}`,
        body: [
          `Everyone has signed "${title}".`,
          "",
          `SHA-256 of the completed PDF: ${facts.completedSha256 ?? ""}`,
          `Download: ${config.publicUrl}${facts.downloadPath ?? ""}`,
        ].join("\n"),
      };
  }
}
