// Invite email over plain SMTP: a fresh connection per message that gives up after
// 5 seconds, so delivery recovers the moment the mail server answers again.
import { randomBytes } from "node:crypto";
import net from "node:net";
import { config } from "./config.js";

const TIMEOUT_MS = 5000;

interface Invite {
  to: string;
  sharerName: string;
  documentName: string;
  documentId: string;
  role: "editor" | "viewer";
}

function envelopeAddress(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return (match ? match[1]! : from).trim();
}

// RFC 2047: UTF-8 B-encoded words of whole characters, each at most 75 characters long,
// joined by CRLF SPACE so no header line passes 76 characters.
function encodeSubject(subject: string): string {
  if (/^[\x20-\x7e]*$/.test(subject)) return subject;
  const words: string[] = [];
  let chunk: string[] = [];
  const flush = () => {
    if (chunk.length) words.push(`=?UTF-8?B?${Buffer.from(chunk.join(""), "utf8").toString("base64")}?=`);
    chunk = [];
  };
  for (const ch of Array.from(subject)) {
    // 39 bytes encode to 52 base64 characters: 64 with the word's markers, inside the first line's room.
    if (Buffer.byteLength(chunk.join("") + ch, "utf8") > 39) flush();
    chunk.push(ch);
  }
  flush();
  return words.join("\r\n ");
}

function message(invite: Invite): string {
  const role = invite.role === "editor" ? "Editor" : "Viewer";
  const text =
    `${invite.sharerName} shared "${invite.documentName}" with you as ${role}.\r\n` +
    `Open it here: ${config.publicUrl}/d/${invite.documentId}\r\n`;
  const body = Buffer.from(text, "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n");
  const domain = envelopeAddress(config.mailFrom).split("@")[1] ?? new URL(config.publicUrl).hostname;
  return [
    `From: ${config.mailFrom}`,
    `To: ${invite.to}`,
    `Subject: ${encodeSubject(`${invite.sharerName} shared ${invite.documentName} with you`)}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${randomBytes(12).toString("hex")}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}

// Sends one invite to exactly one recipient; resolves false when the server cannot be reached.
export function sendInvite(invite: Invite): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: config.smtpHost, port: config.smtpPort });
    let buffer = "";
    let step = 0;
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), TIMEOUT_MS);
    const from = envelopeAddress(config.mailFrom);
    const script: [string | null, number][] = [
      [null, 220],
      ["EHLO tallyframe", 250],
      [`MAIL FROM:<${from}>`, 250],
      [`RCPT TO:<${invite.to}>`, 250],
      ["DATA", 354],
      [`${message(invite).replace(/\r\n\./g, "\r\n..")}\r\n.`, 250],
    ];
    socket.setEncoding("utf8");
    socket.on("error", () => finish(false));
    socket.on("close", () => finish(false));
    socket.on("data", (data: string) => {
      buffer += data;
      // A reply is complete at a line whose code is followed by a space.
      const lines = buffer.split("\r\n");
      const last = lines.findIndex((l) => /^\d{3} /.test(l));
      if (last === -1) return;
      buffer = lines.slice(last + 1).join("\r\n");
      const code = Number(lines[last]!.slice(0, 3));
      if (code !== script[step]![1]) return finish(false);
      step++;
      if (step === script.length) {
        socket.write("QUIT\r\n");
        return finish(true);
      }
      socket.write(`${script[step]![0]}\r\n`);
    });
  });
}
