import { randomUUID } from "node:crypto";
import net from "node:net";
import { BUDGET_NAMES, MAIL_COPY, PROJECT_TYPE_NAMES } from "../shared/copy.js";
import { firstName } from "../shared/rules.js";
import type { BudgetId, MailOutcome, ProjectTypeId } from "../shared/types.js";
import { config } from "./config.js";

export interface StoredEnquiry {
  reference: string;
  name: string;
  email: string;
  project_type: ProjectTypeId;
  budget: BudgetId;
  description: string;
}

const MAIL_DEADLINE_MS = 5000;

/** The five labelled lines both messages and the brief PDF share, as label and value. */
export function fieldPairs(enquiry: StoredEnquiry): [string, string][] {
  const label = MAIL_COPY.fieldLabels;
  return [
    [`${label.reference}:`, enquiry.reference],
    [`${label.name}:`, enquiry.name],
    [`${label.email}:`, enquiry.email],
    [`${label.projectType}:`, PROJECT_TYPE_NAMES[enquiry.project_type]],
    [`${label.budget}:`, BUDGET_NAMES[enquiry.budget]],
  ];
}

function fieldText(enquiry: StoredEnquiry): string {
  const lines = fieldPairs(enquiry).map(([label, value]) => `${label} ${value}`);
  return `${lines.join("\n")}\n\n${MAIL_COPY.descriptionLabel}\n${enquiry.description}\n`;
}

interface Message {
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
}

function messagesFor(enquiry: StoredEnquiry): [Message, Message] {
  const fields = fieldText(enquiry);
  const studio: Message = {
    to: config.studioEmail,
    replyTo: enquiry.email,
    subject: MAIL_COPY.studioSubject(enquiry.reference, PROJECT_TYPE_NAMES[enquiry.project_type], BUDGET_NAMES[enquiry.budget]),
    text: fields,
  };
  const acknowledgement: Message = {
    to: enquiry.email,
    subject: MAIL_COPY.acknowledgementSubject(enquiry.reference),
    text: `${MAIL_COPY.acknowledgementGreeting(firstName(enquiry.name))}\n\n${MAIL_COPY.acknowledgement}\n\n${fields}`,
  };
  return [studio, acknowledgement];
}

function encodeSubject(subject: string): string {
  if (/^[\x20-\x7e]*$/.test(subject)) return subject;
  const words: string[] = [];
  let current = "";
  for (const character of subject) {
    if (Buffer.byteLength(current + character) > 30) {
      words.push(current);
      current = "";
    }
    current += character;
  }
  words.push(current);
  return words.map((word) => `=?UTF-8?B?${Buffer.from(word).toString("base64")}?=`).join("\r\n ");
}

function addressOf(mailbox: string): string {
  const open = mailbox.indexOf("<");
  return open === -1 ? mailbox.trim() : mailbox.slice(open + 1, mailbox.indexOf(">"));
}

function render(message: Message): string {
  const body = Buffer.from(message.text).toString("base64").replace(/(.{76})/g, "$1\r\n");
  const sender = addressOf(config.mailFrom);
  const domain = sender.slice(sender.indexOf("@") + 1);
  return [
    `From: ${config.mailFrom}`,
    `To: ${message.to}`,
    ...(message.replyTo ? [`Reply-To: ${message.replyTo}`] : []),
    `Subject: ${encodeSubject(message.subject)}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}

interface SmtpStep {
  send: string;
  expect: number;
}

function conversation(messages: readonly Message[]): SmtpStep[] {
  const sender = addressOf(config.mailFrom);
  return [
    { send: "EHLO folio.local", expect: 250 },
    ...messages.flatMap((message): SmtpStep[] => [
      { send: `MAIL FROM:<${sender}>`, expect: 250 },
      { send: `RCPT TO:<${message.to}>`, expect: 250 },
      { send: "DATA", expect: 354 },
      { send: `${render(message)}\r\n.`, expect: 250 },
    ]),
    { send: "QUIT", expect: 221 },
  ];
}

/** A minimal SMTP conversation: no TLS and no authentication, as the provided mail server expects. */
function converse(messages: readonly Message[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: config.smtpHost, port: config.smtpPort });
    const steps = conversation(messages);
    let buffer = "";
    let expected = 220;
    let next = 0;
    const timer = setTimeout(() => fail(new Error("mail server did not answer in time")), MAIL_DEADLINE_MS);
    const fail = (error: Error): void => {
      clearTimeout(timer);
      socket.destroy();
      reject(error);
    };
    socket.setEncoding("utf8");
    socket.on("error", fail);
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      for (let end = buffer.indexOf("\r\n"); end !== -1; end = buffer.indexOf("\r\n")) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (line[3] === "-") continue;
        if (Number(line.slice(0, 3)) !== expected) return fail(new Error(`mail server answered ${line}`));
        const step = steps[next];
        if (step === undefined) {
          clearTimeout(timer);
          socket.end();
          return resolve();
        }
        next += 1;
        expected = step.expect;
        socket.write(`${step.send}\r\n`);
      }
    });
  });
}

/** Sends the studio copy, then the acknowledgement. `sent` only when the mail server accepted both. */
export async function sendEnquiryMail(enquiry: StoredEnquiry): Promise<MailOutcome> {
  try {
    await converse(messagesFor(enquiry));
    return "sent";
  } catch {
    return "not_sent";
  }
}

/** True when the mail server greets us. */
export function mailServerAnswers(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: config.smtpHost, port: config.smtpPort });
    const done = (ok: boolean): void => {
      clearTimeout(timer);
      socket.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), 1500);
    socket.setEncoding("utf8");
    socket.once("data", (greeting: string) => done(greeting.startsWith("220")));
    socket.once("error", () => done(false));
  });
}
