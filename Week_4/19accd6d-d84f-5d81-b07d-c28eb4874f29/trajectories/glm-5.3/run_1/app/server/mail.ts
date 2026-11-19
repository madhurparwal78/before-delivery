import nodemailer, { type Transporter } from 'nodemailer';
import { ApiError } from './errors.js';

let mailer: Transporter | null = null;
let fromAddress = '';

export function initMail(host: string, port: number, from: string): void {
  mailer = nodemailer.createTransport({ host, port, ignoreTLS: true });
  fromAddress = from;
}

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  if (!mailer) throw new ApiError(503, 'mail_unavailable', 'Email could not be sent. Try again.');
  try {
    await mailer.sendMail({ from: fromAddress, to, subject, text });
  } catch {
    throw new ApiError(503, 'mail_unavailable', 'Email could not be sent. Try again.');
  }
}
