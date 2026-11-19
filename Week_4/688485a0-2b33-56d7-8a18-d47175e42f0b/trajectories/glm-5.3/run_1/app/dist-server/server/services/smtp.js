import { connect as netConnect } from "node:net";
/** A line-oriented SMTP conversation with proper multi-line reply handling. */
class SmtpConnection {
    socket;
    buffer = "";
    replies = [];
    constructor(socket) {
        this.socket = socket;
        socket.setEncoding("utf8");
        socket.on("data", chunk => {
            this.buffer += chunk;
            let idx;
            while ((idx = this.buffer.indexOf("\r\n")) >= 0) {
                const line = this.buffer.slice(0, idx);
                this.buffer = this.buffer.slice(idx + 2);
                const code = Number(line.slice(0, 3));
                const final = line.length < 4 || line[3] !== "-";
                const last = this.replies[this.replies.length - 1];
                if (last && !last.final) {
                    last.final = final;
                }
                else {
                    this.replies.push({ code, final });
                }
            }
        });
    }
    waitReply() {
        return new Promise((resolve, reject) => {
            const started = Date.now();
            const check = () => {
                const first = this.replies[0];
                if (first && first.final) {
                    this.replies.shift();
                    resolve(first);
                    return;
                }
                if (Date.now() - started > 5000) {
                    reject(new Error("smtp reply timeout"));
                    return;
                }
                setTimeout(check, 10);
            };
            check();
        });
    }
    async command(line) {
        this.socket.write(line + "\r\n");
        return this.waitReply();
    }
    end() {
        this.socket.end();
    }
}
export async function sendMail(cfg, to, subject, bodyLines) {
    const socket = await new Promise((resolve, reject) => {
        const s = netConnect(cfg.port, cfg.host);
        s.setTimeout(5000, () => {
            s.destroy();
            reject(new Error("smtp connect timeout"));
        });
        s.once("connect", () => {
            s.setTimeout(0);
            resolve(s);
        });
        s.once("error", reject);
    });
    const conn = new SmtpConnection(socket);
    try {
        await conn.waitReply(); // greeting
        await conn.command("EHLO jarful");
        await conn.command("MAIL FROM:<" + extractAddress(cfg.from) + ">");
        await conn.command("RCPT TO:<" + to + ">");
        await conn.command("DATA");
        const text = "From: " + cfg.from + "\r\n" +
            "To: <" + to + ">\r\n" +
            "Subject: " + subject + "\r\n" +
            "Content-Type: text/plain; charset=utf-8\r\n" +
            "\r\n" +
            bodyLines.join("\r\n") + "\r\n" +
            ".\r\n";
        socket.write(text);
        await conn.waitReply();
        await conn.command("QUIT");
    }
    finally {
        conn.end();
    }
}
function extractAddress(from) {
    const m = from.match(/<([^>]+)>/);
    return m ? m[1] : from;
}
