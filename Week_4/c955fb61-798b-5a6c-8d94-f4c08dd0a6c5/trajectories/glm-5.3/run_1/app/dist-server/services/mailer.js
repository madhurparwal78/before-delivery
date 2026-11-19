// Assignment notices over SMTP with Node's net module, retried while Mailpit is unreachable.
import net from 'node:net';
function extractAddress(from) {
    const match = /<([^>]+)>/.exec(from);
    return match !== null ? match[1] : from;
}
/** One SMTP conversation carrying a plain-text message. */
function smtpSend(config, message) {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: config.host, port: config.port });
        socket.setEncoding('utf8');
        let stage = 0;
        let buffer = '';
        let settled = false;
        const fail = (error) => {
            if (settled)
                return;
            settled = true;
            socket.destroy();
            reject(error);
        };
        const command = (line) => {
            socket.write(`${line}\r\n`);
        };
        const step = () => {
            stage += 1;
            switch (stage) {
                case 1:
                    command('EHLO slackwater.local');
                    break;
                case 2:
                    command(`MAIL FROM:<${extractAddress(config.from)}>`);
                    break;
                case 3:
                    command(`RCPT TO:<${message.toEmail}>`);
                    break;
                case 4:
                    command('DATA');
                    break;
                case 5: {
                    const headers = [
                        `From: ${config.from}`,
                        `To: ${message.toName} <${message.toEmail}>`,
                        `Subject: ${message.subject}`,
                        'Content-Type: text/plain; charset=utf-8',
                        'MIME-Version: 1.0',
                    ].join('\r\n');
                    // Dot-stuff the body per RFC 5321.
                    const stuffed = message.body
                        .replace(/\r\n/g, '\n')
                        .split('\n')
                        .map((line) => (line.startsWith('.') ? `.${line}` : line))
                        .join('\r\n');
                    socket.write(`${headers}\r\n\r\n${stuffed}\r\n.\r\n`);
                    break;
                }
                case 6:
                    command('QUIT');
                    socket.end();
                    if (!settled) {
                        settled = true;
                        resolve();
                    }
                    break;
            }
        };
        socket.on('data', (chunk) => {
            buffer += chunk;
            if (!buffer.endsWith('\r\n'))
                return;
            const lines = buffer.split('\r\n');
            buffer = '';
            for (const line of lines) {
                if (line === '')
                    continue;
                const code = Number.parseInt(line.slice(0, 3), 10);
                if (Number.isNaN(code))
                    continue;
                const isFinal = line.charAt(3) !== '-';
                if (code >= 500) {
                    fail(new Error(`SMTP refused: ${line}`));
                    return;
                }
                if (isFinal)
                    step();
            }
        });
        socket.on('error', fail);
        socket.on('close', () => {
            if (!settled) {
                settled = true;
                reject(new Error('SMTP connection closed early'));
            }
        });
    });
}
export class Mailer {
    config;
    constructor(config) {
        this.config = config;
    }
    async send(message) {
        await smtpSend(this.config, message);
    }
}
