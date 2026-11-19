import nodemailer from 'nodemailer';

const SMTP_HOST = process.env.SMTP_HOST ?? '';
const SMTP_PORT = Number(process.env.SMTP_PORT ?? '1025');
const MAIL_FROM = process.env.MAIL_FROM ?? 'Duefield <reminders@duefield.test>';
const GOTENBERG_URL = process.env.GOTENBERG_URL ?? '';
export const SERVICE_RETRY_SECONDS = Number(process.env.SERVICE_RETRY_SECONDS ?? '30');

let mailReachable = false;
let pdfReachable = false;

export function mailUp(): boolean {
  return mailReachable;
}

export function pdfUp(): boolean {
  return pdfReachable;
}

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: false,
  tls: { rejectUnauthorized: false },
  connectionTimeout: 4000,
  greetingTimeout: 4000,
  socketTimeout: 8000,
});

/** Probe both services; drives the banners and /api/health. */
export async function probeServices(): Promise<void> {
  mailReachable = await probeMail();
  pdfReachable = await probePdf();
}

async function probeMail(): Promise<boolean> {
  if (SMTP_HOST === '') return false;
  try {
    await transporter.verify();
    return true;
  } catch {
    return false;
  }
}

async function probePdf(): Promise<boolean> {
  if (GOTENBERG_URL === '') return false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(`${GOTENBERG_URL}/health`, { signal: controller.signal });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

/** Send one message through Mailpit; true only when Mailpit accepted it. */
export async function sendMail(to: string, subject: string, body: string): Promise<boolean> {
  try {
    await transporter.sendMail({ from: MAIL_FROM, to, subject, text: body });
    return true;
  } catch {
    return false;
  }
}

/** Render the packet HTML to PDF through Gotenberg; null when it cannot be reached. */
export async function renderPdf(html: string): Promise<Buffer | null> {
  try {
    const form = new FormData();
    form.append('index.html', new Blob([html], { type: 'text/html' }), 'index.html');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const response = await fetch(`${GOTENBERG_URL}/forms/chromium/convert/html`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0) return null;
    return bytes;
  } catch {
    return null;
  }
}
