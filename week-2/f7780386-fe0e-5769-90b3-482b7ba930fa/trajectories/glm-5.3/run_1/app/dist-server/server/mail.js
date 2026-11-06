// Mailpit client: raw SMTP over a socket to the sink. Every email comes
// from Passboard <passboard@halsted-kitchen.test>. When the sink is
// unreachable the email is queued in PostgreSQL and retried by the sweep.
import { connect } from 'node:net';
import { loadConfig } from './config.js';
import { OUTBOUND_FROM, OUTBOUND_ADDRESS } from '../shared/constants.js';
export class MailUnavailable extends Error {
}
function encodeHeader(value) {
    if (/^[\x20-\x7e]*$/.test(value))
        return value;
    return `=?utf-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}
/**
 * A tiny SMTP client state machine:
 *   greeting 220 → HELO → 250 → MAIL FROM → 250 → RCPT TO → 250 →
 *   DATA → 354 → message text → 250 → QUIT
 */
export function sendMail(mail) {
    const c = loadConfig();
    return new Promise((resolve, reject) => {
        const socket = connect(c.smtpPort, c.smtpHost);
        const steps = [
            { write: '', expect: 220 },
            { write: 'HELO passboard', expect: 250 },
            { write: `MAIL FROM:<${OUTBOUND_ADDRESS}>`, expect: 250 },
            { write: `RCPT TO:<${mail.to}>`, expect: 250 },
            { write: 'DATA', expect: 354 },
            { write: '', expect: 250, after: 'body' },
        ];
        let index = 0;
        let buffer = '';
        let done = false;
        const fail = (message) => {
            if (done)
                return;
            done = true;
            socket.destroy();
            reject(new MailUnavailable(message));
        };
        const succeed = () => {
            if (done)
                return;
            done = true;
            socket.end();
            resolve();
        };
        socket.setTimeout(8000, () => fail('smtp timeout'));
        socket.on('error', (err) => fail(`smtp error: ${err.message}`));
        socket.on('data', (chunk) => {
            if (done)
                return;
            buffer += chunk.toString('utf8');
            const lines = buffer.split('\r\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
                if (line === '')
                    continue;
                if (/^\d{3}-/.test(line))
                    continue; // multiline reply, more to come
                const code = Number(line.slice(0, 3));
                if (!Number.isInteger(code) || code < 200)
                    continue;
                if (code >= 500) {
                    fail(`smtp refused: ${line}`);
                    return;
                }
                const step = steps[index];
                if (!step || code !== step.expect)
                    continue;
                index += 1;
                if (step.after === 'body') {
                    // The message text was accepted: close the conversation.
                    socket.write('QUIT\r\n');
                    succeed();
                    return;
                }
                if (index < steps.length) {
                    if (index === 5) {
                        // DATA accepted; send the message body terminated by a dot.
                        const msg = [
                            `From: ${OUTBOUND_FROM}`,
                            `To: <${mail.to}>`,
                            `Subject: ${encodeHeader(mail.subject)}`,
                            'MIME-Version: 1.0',
                            'Content-Type: text/plain; charset=utf-8',
                            'Content-Transfer-Encoding: 8bit',
                            '',
                            mail.body,
                        ].join('\r\n');
                        socket.write(msg.replace(/\r?\n/g, '\r\n') + '\r\n.\r\n');
                    }
                    else {
                        socket.write(steps[index].write + '\r\n');
                    }
                }
            }
        });
    });
}
export async function probeSmtp() {
    const c = loadConfig();
    await new Promise((resolve, reject) => {
        const socket = connect(c.smtpPort, c.smtpHost);
        const finish = (ok) => {
            socket.destroy();
            if (ok)
                resolve();
            else
                reject(new MailUnavailable('smtp unreachable'));
        };
        socket.setTimeout(5000, () => finish(false));
        socket.once('data', () => finish(true));
        socket.once('error', () => finish(false));
    });
}
