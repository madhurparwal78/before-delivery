// A minimal SMTP client for Mailpit with a timeout on every exchange (brief: Services, Mailpit).
import { randomUUID } from "node:crypto";
import { connect } from "node:net";
import { config } from "../config.js";
const TIMEOUT_MS = 5_000;
export class MailUnavailable extends Error {
}
const fromAddress = (from) => from.match(/<([^>]+)>/)?.[1] ?? from.trim();
function encodeHeader(value) {
    return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}
function format(mail) {
    const domain = fromAddress(config.smtp.from).split("@")[1] ?? "localhost";
    const body = Buffer.from(mail.body, "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n");
    return [
        `From: ${config.smtp.from}`,
        `To: <${mail.to}>`,
        `Subject: ${encodeHeader(mail.subject)}`,
        `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
        `Message-ID: <${randomUUID()}@${domain}>`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=utf-8",
        "Content-Transfer-Encoding: base64",
        "",
        body,
    ].join("\r\n");
}
/** One SMTP connection; open() fails fast when the server cannot be reached. */
export class SmtpConnection {
    socket;
    buffer = "";
    pending = null;
    constructor(socket) {
        this.socket = socket;
        socket.setEncoding("utf8");
        socket.on("data", (chunk) => {
            this.buffer += chunk;
            this.flush();
        });
        socket.on("close", () => this.settle(new MailUnavailable("SMTP connection closed")));
    }
    static open(timeoutMs = TIMEOUT_MS) {
        return new Promise((resolve, reject) => {
            const socket = connect({ host: config.smtp.host, port: config.smtp.port });
            socket.setTimeout(timeoutMs, () => socket.destroy(new MailUnavailable("SMTP timed out")));
            socket.on("error", (error) => reject(new MailUnavailable("SMTP connection failed", { cause: error })));
            socket.once("connect", () => {
                const connection = new SmtpConnection(socket);
                connection
                    .reply(220)
                    .then(() => connection.command("EHLO clinchline", 250))
                    .then(() => resolve(connection), reject);
            });
        });
    }
    settle(error) {
        const pending = this.pending;
        if (!pending)
            return;
        this.pending = null;
        if (error)
            pending.reject(error);
        else
            pending.resolve();
    }
    flush() {
        const match = this.buffer.match(/^(?:\d{3}-[^\r\n]*\r\n)*\d{3} [^\r\n]*\r\n/);
        if (!match || !this.pending)
            return;
        this.buffer = this.buffer.slice(match[0].length);
        const code = Number((match[0].trimEnd().split("\r\n").pop() ?? "").slice(0, 3));
        this.settle(code === this.pending.expected ? null : new MailUnavailable(`SMTP answered ${code}`));
    }
    reply(expected) {
        return new Promise((resolve, reject) => {
            this.pending = { expected, resolve, reject };
            this.flush();
        });
    }
    command(line, expected) {
        this.socket.write(`${line}\r\n`);
        return this.reply(expected);
    }
    async send(mail) {
        await this.command(`MAIL FROM:<${fromAddress(config.smtp.from)}>`, 250);
        await this.command(`RCPT TO:<${mail.to}>`, 250);
        await this.command("DATA", 354);
        await this.command(`${format(mail)}\r\n.`, 250);
    }
    close() {
        this.socket.end("QUIT\r\n");
    }
}
