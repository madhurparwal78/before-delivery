import { createTransport, Transporter } from 'nodemailer';
import { config } from './config.js';

let transporter: Transporter | null = null;

const getTransporter = (): Transporter | null => {
  if (!config.smtp.host) return null;
  if (!transporter) {
    transporter = createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: false,
      ignoreTLS: true,
      connectionTimeout: 4000,
    });
  }
  return transporter;
};

type Pending = { to: string; subject: string; body: string; deadline: number };

const queue: Pending[] = [];
let draining = false;

/** Email sending never blocks the action. Failures retry every 10 seconds for up to 10 minutes. */
export const sendMail = (to: string, subject: string, body: string): void => {
  queue.push({ to, subject, body, deadline: Date.now() + 10 * 60 * 1000 });
  drain();
};

const drain = async (): Promise<void> => {
  if (draining) return;
  draining = true;
  while (queue.length > 0) {
    const message = queue[0];
    const t = getTransporter();
    if (!t) { queue.shift(); continue; }
    try {
      await t.sendMail({ from: config.mailFrom, to: message.to, subject: message.subject, text: message.body });
      queue.shift();
    } catch {
      if (Date.now() >= message.deadline) { queue.shift(); } else {
        await new Promise((r) => setTimeout(r, 10000));
      }
    }
  }
  draining = false;
};
