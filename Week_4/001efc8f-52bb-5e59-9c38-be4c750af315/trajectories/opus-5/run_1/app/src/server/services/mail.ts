import net from 'node:net';
import { config } from '../config';
import { nowDate } from '../clock';
import { encodeHeaderText, newMessageId, quoteDisplayName, rfcDate, smtpSend } from './smtp';

export interface OutgoingMail {
  toAddress: string;
  toName: string;
  subject: string;
  body: string;
}

function addressOf(mailbox: string): string {
  const match = /<([^>]+)>/.exec(mailbox);
  return match === null ? mailbox.trim() : (match[1] as string);
}

/**
 * Hands one plain-text email to mail. Its Date header carries the app-clock
 * instant at which the app hands it over, and it never has Cc or Bcc.
 */
export async function deliverMail(mail: OutgoingMail): Promise<void> {
  const handedOver = nowDate();
  const headers = [
    `From: ${config.mail.from}`,
    `To: ${quoteDisplayName(mail.toName)} <${mail.toAddress}>`,
    `Subject: ${encodeHeaderText(mail.subject)}`,
    `Date: ${rfcDate(handedOver)}`,
    `Message-ID: ${newMessageId('rimewire.example')}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
  ];
  const data = `${headers.join('\r\n')}\r\n\r\n${mail.body.split('\n').join('\r\n')}\r\n`;
  await smtpSend({
    host: config.mail.host,
    port: config.mail.port,
    from: addressOf(config.mail.from),
    to: mail.toAddress,
    data,
  });
}

export async function mailReachable(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host: config.mail.host, port: config.mail.port });
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(5_000);
    socket.on('data', (chunk: Buffer) => finish(chunk.toString('ascii').startsWith('220')));
    socket.on('error', () => finish(false));
    socket.on('timeout', () => finish(false));
  });
}
