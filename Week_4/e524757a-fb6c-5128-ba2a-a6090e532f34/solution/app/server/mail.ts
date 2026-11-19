/** Mailpit over SMTP. A message counts as sent only when the server accepted it. */
import nodemailer from 'nodemailer'
import { config } from './config'

export class MailError extends Error {}

const transport = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: false,
  ignoreTLS: true,
  connectionTimeout: 4000,
  greetingTimeout: 4000,
  socketTimeout: 8000,
})

interface Message {
  to: string
  subject: string
  text: string
  attachment?: { filename: string; content: Buffer }
}

export async function sendMail(message: Message): Promise<void> {
  try {
    await transport.sendMail({
      from: config.mailFrom,
      to: message.to,
      subject: message.subject,
      text: message.text,
      attachments: message.attachment ? [message.attachment] : [],
    })
  } catch {
    throw new MailError('mail not accepted')
  }
}
