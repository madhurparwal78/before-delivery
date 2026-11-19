/** SMTP client (Mailpit) with RFC 2047 encoded subjects (DP-66). */
import * as net from 'node:net';
import type { Config } from './config.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** RFC 2047 UTF-8 encoded words whenever the subject holds any non-ASCII character. */
export function encodeSubject(subject: string): string {
  if (/^[\x20-\x7e]*$/.test(subject)) return subject;
  const b64 = Buffer.from(subject, 'utf8').toString('base64');
  return `=?UTF-8?B?${b64}?=`;
}

function extractAddress(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return m ? m[1] : from;
}

interface SmtpReply { code: number; text: string }

interface SmtpSession {
  sock: net.Socket;
  read(): Promise<SmtpReply>;
  command(cmd: string): Promise<SmtpReply>;
  close(): void;
}

function smtpConnect(cfg: Config): Promise<SmtpSession> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: cfg.smtp.host, port: cfg.smtp.port });
    let buffer = '';
    let waiter: { resolve: (r: SmtpReply) => void; reject: (e: Error) => void } | null = null;
    sock.setTimeout(10000, () => { sock.destroy(); reject(new Error('smtp timeout')); });
    sock.on('error', (e) => { sock.destroy(); reject(e); });
    sock.on('data', (d: Buffer) => {
      buffer += d.toString('utf8');
      for (;;) {
        const idx = buffer.indexOf('\r\n');
        if (idx === -1) return;
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (/^\d{3} /.test(line) && waiter) {
          const w = waiter;
          waiter = null;
          w.resolve({ code: Number(line.slice(0, 3)), text: line });
        }
      }
    });
    sock.on('connect', () => {
      let pending: Promise<SmtpReply> | null = null;
      const session: SmtpSession = {
        sock,
        read(): Promise<SmtpReply> {
          pending = new Promise((res, rej) => { waiter = { resolve: res, reject: rej }; });
          return pending;
        },
        command(cmd: string): Promise<SmtpReply> {
          sock.write(`${cmd}\r\n`);
          return session.read();
        },
        close(): void { sock.end(); },
      };
      const greeting = session.read();
      greeting.then((g) => {
        if (g.code !== 220) { session.close(); reject(new Error(`smtp greeting ${g.code}`)); return; }
        resolve(session);
      }, reject);
    });
  });
}

export async function sendMail(cfg: Config, msg: MailMessage): Promise<void> {
  const s = await smtpConnect(cfg);
  try {
    let r = await s.command('EHLO lanternfold.test');
    if (r.code !== 250) throw new Error(`ehlo ${r.code}`);
    r = await s.command(`MAIL FROM:<${extractAddress(cfg.smtp.from)}>`);
    if (r.code !== 250) throw new Error(`mail from ${r.code}`);
    r = await s.command(`RCPT TO:<${msg.to}>`);
    if (r.code !== 250 && r.code !== 251) throw new Error(`rcpt ${r.code}`);
    r = await s.command('DATA');
    if (r.code !== 354) throw new Error(`data ${r.code}`);
    const mime = buildMime(cfg, msg);
    s.sock.write(mime);
    r = await s.command('.');
    if (r.code !== 250) throw new Error(`message ${r.code}`);
    await s.command('QUIT');
  } finally {
    s.close();
  }
}

function buildMime(cfg: Config, msg: MailMessage): string {
  const boundary = `lfr_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const headers = [
    `From: ${cfg.smtp.from}`,
    `To: <${msg.to}>`,
    `Subject: ${encodeSubject(msg.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
  ].join('\r\n') + '\r\n'; // the empty list item ends the headers; one more CRLF starts the body
  const textPart = `--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${dotStuff(msg.text)}`;
  const htmlPart = `--${boundary}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${dotStuff(msg.html)}`;
  const end = `--${boundary}--`;
  return `${headers}${textPart}\r\n${htmlPart}\r\n${end}\r\n.\r\n`;
}

function dotStuff(body: string): string {
  return body.replace(/\r\n/g, '\n').replace(/(^|\n)\./g, '$1..');
}

/** Probe a TCP service with a short timeout (health checks). */
export async function probeTcp(host: string, port: number, ms = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port });
    const t = setTimeout(() => { sock.destroy(); resolve(false); }, ms);
    sock.once('connect', () => { clearTimeout(t); sock.destroy(); resolve(true); });
    sock.once('error', () => { clearTimeout(t); resolve(false); });
  });
}

/** Probe an HTTP service with a short timeout (health checks). */
export async function probeHttp(url: string, ms = 2000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res.ok || res.status === 401 || res.status === 403 || res.status === 404;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
