import nodemailer from 'nodemailer'
import { config } from './db.js'
import type { OrderView } from './orders.js'
import { money } from './domain.js'

export interface Mailer {
  send(to: string, subject: string, text: string, html: string, attachments?: { filename: string; content: Buffer; contentType: string }[]): Promise<void>
}

export function create_mailer(): Mailer {
  const transport = nodemailer.createTransport({
    host: config().smtp_host,
    port: config().smtp_port,
    secure: false,
    tls: { rejectUnauthorized: false },
    connectionTimeout: 10_000,
  })
  const mailer: Mailer = {
    async send(to, subject, text, html, attachments) {
      await transport.sendMail({
        from: config().mail_from,
        to,
        subject,
        text,
        html,
        attachments,
      })
    },
  }
  return mailer
}

export function probe_smtp(): Promise<boolean> {
  return new Promise((resolve) => {
    const net = require('node:net') as typeof import('node:net')
    const socket = net.createConnection({ host: config().smtp_host, port: config().smtp_port })
    const done = (result: boolean) => {
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(2_000, () => done(false))
    socket.on('connect', () => done(true))
    socket.on('error', () => done(false))
  })
}

function order_lines_text(order: OrderView): string {
  return order.lines
    .map((line) => `${line.variant_code} x ${line.quantity}    ${money(line.line_total_cents)}`)
    .join('\n')
}

function order_lines_html(order: OrderView): string {
  return order.lines
    .map(
      (line) =>
        `<tr><td style="font-family:monospace">${line.variant_code}</td><td style="text-align:center">x ${line.quantity}</td><td style="text-align:right">${money(line.line_total_cents)}</td></tr>`,
    )
    .join('')
}

export interface OrderEmailParts {
  subject: string
  text: string
  html: string
}

export function order_confirmation_email(order: OrderView): OrderEmailParts {
  const subject = `Your Lightfall order ${order.order_key}`
  const money_lines = [
    `Subtotal (excl. GST): ${money(order.subtotal_cents)}`,
    `GST (15%): ${money(order.gst_cents)}`,
    `Total (incl. GST): ${money(order.total_cents)}`,
  ].join('\n')
  const po = order.payment_method === 'account' && order.purchase_order
    ? `Purchase order: ${order.purchase_order}\n`
    : ''
  const text = [
    `Thank you for your Lightfall order ${order.order_key}.`,
    '',
    order_lines_text(order),
    '',
    money_lines,
  ].join('\n')
  const html = [
    '<html><body style="font-family:sans-serif;color:#222">',
    `<p>Thank you for your Lightfall order <strong>${order.order_key}</strong>.</p>`,
    po ? `<p>Purchase order: ${order.purchase_order}</p>` : '',
    `<table style="border-collapse:collapse">${order_lines_html(order)}</table>`,
    `<p style="font-family:monospace">Subtotal (excl. GST): ${money(order.subtotal_cents)}<br/>GST (15%): ${money(order.gst_cents)}<br/>Total (incl. GST): ${money(order.total_cents)}</p>`,
    '</body></html>',
  ].join('')
  return { subject, text, html }
}

export function trade_approved_email(name: string): OrderEmailParts {
  return {
    subject: 'Your Lightfall trade account is approved',
    text: `Kia ora ${name},\n\nYour Lightfall trade account is approved. Sign in to see trade prices, build projects and order on your monthly account.\n\n— Southerly Light Works`,
    html: `<html><body style="font-family:sans-serif"><p>Kia ora ${name},</p><p>Your Lightfall trade account is approved. Sign in to see trade prices, build projects and order on your monthly account.</p><p>— Southerly Light Works</p></body></html>`,
  }
}

export function trade_declined_email(name: string, reason: string): OrderEmailParts {
  return {
    subject: 'About your Lightfall trade application',
    text: `Kia ora ${name},\n\nYour trade application was not approved this time.\n\nReason: ${reason}\n\nYou can still shop at retail prices.\n\n— Southerly Light Works`,
    html: `<html><body style="font-family:sans-serif"><p>Kia ora ${name},</p><p>Your trade application was not approved this time.</p><p>Reason: ${reason}</p><p>You can still shop at retail prices.</p><p>— Southerly Light Works</p></body></html>`,
  }
}

export function newsletter_confirm_email(link: string, occupation: string): OrderEmailParts {
  return {
    subject: 'Confirm your Lightfall newsletter',
    text: `Confirm your Lightfall newsletter subscription.\n\nOccupation: ${occupation}\n\nFollow this link to confirm:\n${link}\n\n— Southerly Light Works`,
    html: `<html><body style="font-family:sans-serif"><p>Confirm your Lightfall newsletter subscription.</p><p>Occupation: ${occupation}</p><p><a href="${link}">Confirm your subscription</a></p><p>— Southerly Light Works</p></body></html>`,
  }
}

export function quote_share_email(
  sender_name: string,
  project_name: string,
  message: string | null,
  quote_text: string,
  quote_html: string,
): OrderEmailParts {
  const subject = `${sender_name} shared a Lightfall quote: ${project_name}`
  const text = [
    `${sender_name} shared a Lightfall quote with you: ${project_name}.`,
    '',
    message ?? '',
    '',
    quote_text,
  ].filter((s) => s !== undefined).join('\n')
  const html = `<html><body style="font-family:sans-serif"><p>${sender_name} shared a Lightfall quote with you: <strong>${project_name}</strong>.</p>${message ? `<p>${message}</p>` : ''}${quote_html}</body></html>`
  return { subject, text, html }
}

