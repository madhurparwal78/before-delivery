import net from 'node:net'
import { config } from './config.ts'

export class MailUnavailable extends Error {}

function address(from: string): string {
  const open = from.indexOf('<')
  return open >= 0 ? from.slice(open + 1, from.indexOf('>')) : from.trim()
}

function encodedWord(text: string): string {
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`
}

function wrap(text: string, width: number): string {
  return (text.match(new RegExp(`.{1,${width}}`, 'g')) ?? []).join('\r\n')
}

function message(to: string, subject: string, body: string): string {
  return [
    `From: ${config.mailFrom}`,
    `To: ${to}`,
    `Subject: ${encodedWord(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(Buffer.from(body, 'utf8').toString('base64'), 76),
    '',
  ].join('\r\n')
}

/** Delivers one plain-text mail to Mailpit over SMTP. */
export function sendMail(to: string, subject: string, body: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: config.smtpHost, port: config.smtpPort })
    socket.setTimeout(8000)
    const script: [string, number][] = [
      ['', 220],
      ['EHLO twinrow', 250],
      [`MAIL FROM:<${address(config.mailFrom)}>`, 250],
      [`RCPT TO:<${to}>`, 250],
      ['DATA', 354],
      [`${message(to, subject, body).replace(/^\./gm, '..')}\r\n.`, 250],
      ['QUIT', 221],
    ]
    let step = 0
    let buffer = ''
    const fail = (reason: string) => { socket.destroy(); reject(new MailUnavailable(reason)) }
    socket.on('timeout', () => fail('timeout'))
    socket.on('error', (error) => fail(error.message))
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      const lines = buffer.split('\r\n')
      if (lines.length < 2) return
      const last = lines[lines.length - 2]
      if (/^\d{3}-/.test(last)) return
      buffer = ''
      const code = Number(last.slice(0, 3))
      if (code !== script[step][1]) return fail(last)
      step++
      if (step === script.length) {
        socket.end()
        resolve()
        return
      }
      socket.write(`${script[step][0]}\r\n`)
    })
  })
}
