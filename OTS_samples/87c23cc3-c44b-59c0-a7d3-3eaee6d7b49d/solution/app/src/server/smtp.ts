import { randomUUID } from 'node:crypto'
import net from 'node:net'
import { config } from './config.ts'

/** Raised when the mail server cannot be reached or does not accept the message. */
class MailError extends Error {}

const TIMEOUT_MS = 2000

interface Message {
  to: string
  subject: string
  text: string
}

function address(from: string): string {
  const start = from.indexOf('<')
  return start === -1 ? from.trim() : from.slice(start + 1, from.indexOf('>'))
}

function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

function mime(message: Message): string {
  const body = Buffer.from(message.text.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n')
  return [
    `From: ${config.mailFrom}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@joinery>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n')
}

class Dialogue {
  private buffer = ''
  private waiting: ((reply: { code: number; text: string }) => void) | null = null
  private failure: Error | null = null
  private failed: ((error: Error) => void) | null = null

  constructor(private readonly socket: net.Socket) {
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      this.buffer += chunk
      this.deliver()
    })
    socket.on('error', () => this.fail(new MailError('mail server unreachable')))
    socket.on('close', () => this.fail(new MailError('mail server closed the connection')))
    socket.setTimeout(TIMEOUT_MS, () => {
      socket.destroy()
      this.fail(new MailError('mail server timed out'))
    })
  }

  private fail(error: Error): void {
    this.failure ??= error
    this.failed?.(error)
  }

  private deliver(): void {
    if (!this.waiting) return
    const lines = this.buffer.split('\r\n')
    const last = lines.findIndex((line) => /^\d{3} /.test(line))
    if (last === -1) return
    const text = lines.slice(0, last + 1).join('\n')
    this.buffer = lines.slice(last + 1).join('\r\n')
    const waiting = this.waiting
    this.waiting = null
    waiting({ code: Number(text.slice(0, 3)), text })
  }

  reply(): Promise<{ code: number; text: string }> {
    return new Promise((resolve, reject) => {
      if (this.failure) return reject(this.failure)
      this.failed = reject
      this.waiting = resolve
      this.deliver()
    })
  }

  async expect(prefix: number): Promise<void> {
    const reply = await this.reply()
    if (Math.floor(reply.code / 100) !== prefix) throw new MailError(`mail server answered ${reply.code}`)
  }

  async command(line: string, prefix: number): Promise<void> {
    this.socket.write(`${line}\r\n`)
    await this.expect(prefix)
  }

  end(): void {
    this.socket.destroy()
  }
}

async function dial(): Promise<Dialogue> {
  const socket = net.connect({ host: config.smtp.host, port: config.smtp.port })
  const dialogue = new Dialogue(socket)
  await dialogue.expect(2)
  return dialogue
}

/** True when the mail server answers its greeting. */
export async function pingMail(): Promise<boolean> {
  try {
    const dialogue = await dial()
    dialogue.end()
    return true
  } catch {
    return false
  }
}

/** Resolves only after the SMTP server has accepted the message. */
export async function sendMail(message: Message): Promise<void> {
  const dialogue = await dial()
  try {
    await dialogue.command('EHLO joinery', 2)
    await dialogue.command(`MAIL FROM:<${address(config.mailFrom)}>`, 2)
    await dialogue.command(`RCPT TO:<${message.to}>`, 2)
    await dialogue.command('DATA', 3)
    await dialogue.command(`${mime(message).replace(/^\./gm, '..')}\r\n.`, 2)
    dialogue.end()
  } catch (error) {
    dialogue.end()
    throw error instanceof MailError ? error : new MailError('mail could not be sent')
  }
}
