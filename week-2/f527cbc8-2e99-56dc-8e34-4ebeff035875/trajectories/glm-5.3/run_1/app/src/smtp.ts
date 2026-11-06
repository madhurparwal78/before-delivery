import net from 'node:net';
import { config } from './config.js';

export interface OutboxMessage {
  to: string;
  subject: string;
  body: string;
}

/** Minimal SMTP client for the Mailpit relay (Services, SMTP). Explicit timeouts. */
export function sendSmtp(msg: OutboxMessage): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: config.smtpHost, port: config.smtpPort });
    socket.setTimeout(8000);
    let step = 0;
    let buffer = '';
    let failed = false;
    const fail = () => {
      if (failed) return;
      failed = true;
      socket.destroy();
      resolve(false);
    };
    socket.on('error', fail);
    socket.on('timeout', fail);

    const fromAddr = extractAddress(config.mailFrom);
    const toAddr = extractAddress(msg.to);

    const commands: Array<string | null> = [
      null, // wait for greeting
      `EHLO clinchline\r\n`,
      `MAIL FROM:<${fromAddr}>\r\n`,
      `RCPT TO:<${toAddr}>\r\n`,
      `DATA\r\n`
    ];

    const message =
      `From: ${config.mailFrom}\r\n` +
      `To: ${msg.to}\r\n` +
      `Subject: ${msg.subject}\r\n` +
      `Content-Type: text/plain; charset=utf-8\r\n` +
      `\r\n` +
      msg.body.replace(/\r?\n/g, '\r\n').replace(/\./g, '..') +
      `\r\n.\r\nQUIT\r\n`;

    socket.on('data', (chunk) => {
      if (failed) return;
      buffer += chunk.toString('utf8');
      if (!/\r\n$/.test(buffer)) return;
      const code = parseInt(buffer.slice(0, 3), 10);
      buffer = '';
      if (code >= 400) { fail(); return; }
      if (step === commands.length - 1) {
        // the message was accepted
        socket.end();
        resolve(true);
        return;
      }
      step += 1;
      const cmd = commands[step];
      if (cmd === null) { fail(); return; }
      const payload = step === commands.length - 1 ? cmd + message : cmd;
      socket.write(payload);
    });
  });
}

function extractAddress(header: string): string {
  const m = /<([^>]+)>/.exec(header);
  return m ? m[1] : header.trim();
}
