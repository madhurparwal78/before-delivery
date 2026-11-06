// The two emails the game sends: postbox keys and postcards. Headers are ASCII only; names
// travel as RFC 2047 encoded-words so they can never add a header, a recipient or a line.
import { randomBytes } from "node:crypto";
import { config } from "./config";
import { postOffice } from "./services";
import { sendMessage } from "./smtp";

const POSTCARD_SENDER = "postcards@kitefold.example";

/** UTF-8 text as one or more B encoded-words, each at most 75 characters, never splitting a character. */
function encodedWords(text: string): string {
  const words: string[] = [];
  let chunk = "";
  const flush = (): void => {
    if (chunk) words.push(`=?UTF-8?B?${Buffer.from(chunk, "utf8").toString("base64")}?=`);
    chunk = "";
  };
  for (const ch of text) {
    if (Buffer.byteLength(chunk + ch, "utf8") > 45) flush();
    chunk += ch;
  }
  flush();
  return words.join("\r\n ");
}

/** A From display name stays plain only when it is letters, digits and single inner spaces. */
function phraseText(text: string): string {
  return /^[A-Za-z0-9]+( [A-Za-z0-9]+)*$/.test(text) ? text : encodedWords(text);
}

/** A Subject stays plain when it is printable ASCII that can't be mistaken for an encoded-word. */
function subjectText(text: string): string {
  return /^[\x20-\x7e]*$/.test(text) && !text.includes("=?") ? text : encodedWords(text);
}

function addressOf(mailbox: string): string {
  const m = /<([^>]+)>/.exec(mailbox);
  return (m ? m[1]! : mailbox).trim();
}

function compose(headers: Array<[string, string]>, text: string): string {
  const head = headers.map(([k, v]) => `${k}: ${v}`).join("\r\n");
  const body = Buffer.from(text, "utf8")
    .toString("base64")
    .replace(/.{1,76}/g, (line) => `${line}\r\n`);
  return `${head}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${body}`;
}

const messageId = (): string => `<${randomBytes(12).toString("hex")}@kitefold.example>`;

export async function sendPostboxKey(to: string, claimUrl: string, ttlSeconds: number): Promise<void> {
  const minutes = Math.max(1, Math.round(ttlSeconds / 60));
  const text =
    `Here is your Parcel Moon postbox key.\r\n\r\n` +
    `Open this link to claim your save on Bramble:\r\n${claimUrl}\r\n\r\n` +
    `It works once and expires in about ${minutes} minute${minutes === 1 ? "" : "s"}. ` +
    `If you didn't ask for it, you can ignore this email.\r\n`;
  const message = compose(
    [
      ["From", config.mailFrom],
      ["To", `<${to}>`],
      ["Subject", "Your Parcel Moon postbox key"],
      ["Date", new Date().toUTCString()],
      ["Message-ID", messageId()],
    ],
    text,
  );
  await postOffice.use(() => sendMessage(addressOf(config.mailFrom), to, message));
}

/** Sends one postcard email; resolves at the moment the mail server accepted it. */
export async function sendPostcard(to: string, displayName: string, shareUrl: string): Promise<Date> {
  const message = compose(
    [
      ["From", `${phraseText(`${displayName} via Parcel Moon`)} <${POSTCARD_SENDER}>`],
      ["To", `<${to}>`],
      ["Subject", subjectText(`${displayName} sent you a postcard from Bramble`)],
      ["Date", new Date().toUTCString()],
      ["Message-ID", messageId()],
    ],
    `${displayName} took this postcard on Bramble: ${shareUrl}\r\n`,
  );
  await postOffice.use(() => sendMessage(POSTCARD_SENDER, to, message));
  return new Date();
}
