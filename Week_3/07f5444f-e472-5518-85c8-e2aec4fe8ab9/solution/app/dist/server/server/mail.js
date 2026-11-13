// Mail over SMTP to the server in SMTP_HOST / SMTP_PORT. A message counts as sent only once the
// server answers 250 to its DATA.
import { randomBytes } from "node:crypto";
import { Socket } from "node:net";
import { config } from "./config.js";
const PROBE_TIMEOUT_MS = 2_000;
const SEND_TIMEOUT_MS = 10_000;
class SmtpSession {
    socket;
    buffer = "";
    waiting = null;
    failure = null;
    constructor(socket) {
        this.socket = socket;
        socket.setEncoding("utf8");
        socket.on("data", (chunk) => {
            this.buffer += chunk;
            this.drain();
        });
        socket.on("error", (error) => this.fail(error));
        socket.on("close", () => this.fail(new Error("SMTP connection closed")));
    }
    static open(timeoutMs) {
        return new Promise((resolve, reject) => {
            const socket = new Socket();
            socket.setTimeout(timeoutMs, () => socket.destroy(new Error("SMTP timed out")));
            socket.once("error", reject);
            socket.connect(config.mail.port, config.mail.host, () => {
                socket.off("error", reject);
                resolve(new SmtpSession(socket));
            });
        });
    }
    fail(error) {
        this.failure ??= error;
        this.waiting?.({ code: 0, text: error.message });
        this.waiting = null;
    }
    drain() {
        if (this.waiting === null)
            return;
        const lines = this.buffer.split("\r\n");
        for (let i = 0; i < lines.length - 1; i++) {
            const line = lines[i] ?? "";
            if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
                this.buffer = lines.slice(i + 1).join("\r\n");
                const waiter = this.waiting;
                this.waiting = null;
                waiter?.({ code: Number(line.slice(0, 3)), text: line });
                return;
            }
        }
    }
    reply() {
        if (this.failure)
            return Promise.resolve({ code: 0, text: this.failure.message });
        return new Promise((resolve) => {
            this.waiting = resolve;
            this.drain();
        });
    }
    async command(line) {
        this.socket.write(`${line}\r\n`);
        return (await this.reply()).code;
    }
    close() {
        this.socket.end("QUIT\r\n");
        this.socket.destroy();
    }
}
function address(mailbox) {
    return /<([^>]+)>/.exec(mailbox)?.[1] ?? mailbox.trim();
}
/** RFC 2047 encoded words on one line, so the decoded subject equals the text character for character. */
function encodeHeader(text) {
    if (/^[ -~]*$/.test(text))
        return text;
    const words = [];
    let chunk = "";
    for (const character of text) {
        if (Buffer.byteLength(chunk + character, "utf8") > 45) {
            words.push(chunk);
            chunk = "";
        }
        chunk += character;
    }
    words.push(chunk);
    return words.map((word) => `=?UTF-8?B?${Buffer.from(word, "utf8").toString("base64")}?=`).join(" ");
}
function render(message) {
    const from = address(config.mail.from);
    const domain = from.split("@")[1] ?? "localhost";
    const body = Buffer.from(message.lines.join("\r\n") + "\r\n", "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
    return [
        `From: ${config.mail.from}`,
        `To: <${message.to}>`,
        `Subject: ${encodeHeader(message.subject)}`,
        `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
        `Message-ID: <${randomBytes(12).toString("hex")}@${domain}>`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: base64",
        "",
        body.trimEnd(),
    ].join("\r\n");
}
/**
 * Sends each message in one SMTP session. Returns, per message, whether the server accepted it.
 * When the server cannot be reached every message is reported as not accepted.
 */
export async function sendAll(messages) {
    const accepted = messages.map(() => false);
    if (messages.length === 0)
        return accepted;
    let session;
    try {
        session = await SmtpSession.open(SEND_TIMEOUT_MS);
    }
    catch {
        return accepted;
    }
    try {
        if ((await session.reply()).code !== 220)
            return accepted;
        if ((await session.command("EHLO quirewell")) !== 250)
            return accepted;
        for (const [index, message] of messages.entries()) {
            if ((await session.command(`MAIL FROM:<${address(config.mail.from)}>`)) !== 250)
                continue;
            if ((await session.command(`RCPT TO:<${message.to}>`)) !== 250) {
                await session.command("RSET");
                continue;
            }
            if ((await session.command("DATA")) !== 354)
                continue;
            const data = render(message).replace(/^\./gm, "..");
            accepted[index] = (await session.command(`${data}\r\n.`)) === 250;
        }
        return accepted;
    }
    finally {
        session.close();
    }
}
/** True when the mail server greets within two seconds. */
export async function mailUp() {
    try {
        const session = await SmtpSession.open(PROBE_TIMEOUT_MS);
        try {
            return (await session.reply()).code === 220;
        }
        finally {
            session.close();
        }
    }
    catch {
        return false;
    }
}
