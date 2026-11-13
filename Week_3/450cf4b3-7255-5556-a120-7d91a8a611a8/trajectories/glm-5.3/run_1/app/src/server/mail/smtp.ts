import net from 'node:net';

// Minimal SMTP client: one connection per send, speaking EHLO/MAIL/RCPT/DATA
// and trusting only the server's success replies at the end of the message.

export class SmtpClient {
  constructor(private host: string, private port: number, private fromAddress: string, private fromName: string | null) {}

  private async connect(): Promise<{ socket: net.Socket; read: () => Promise<string> }> {
    const socket = net.connect({ host: this.host, port: this.port });
    socket.setNoDelay(true);
    const chunks: Buffer[] = [];
    let waiting: ((reply: string) => void) | null = null;
    let buffer = '';
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      chunks.push(chunk);
      const lines = buffer.split('\r\n');
      buffer = lines.pop() ?? '';
      const reply = lines.join('\r\n');
      if (reply.length > 0 && waiting) {
        const w = waiting;
        waiting = null;
        w(reply);
      }
    });
    const readOnce = (): Promise<string> => new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) { settled = true; socket.destroy(); reject(new Error('smtp timeout')); }
      }, 10_000);
      waiting = (reply) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(reply);
      };
      socket.once('error', (e) => {
        if (!settled) { settled = true; clearTimeout(timer); reject(e); }
      });
    });
    return { socket, read: readOnce };
  }

  async send(toLine: string, envelopeTo: string, subject: string, body: string, messageId: string): Promise<void> {
    const { socket, read } = await this.connect();
    try {
      const expect = async (code: string): Promise<string> => {
        const reply = await read();
        if (!reply.startsWith(code)) throw new Error('smtp refused');
        return reply;
      };
      await expect('220');
      socket.write(`EHLO stationhouse.test\r\n`);
      await expect('250');
      socket.write(`MAIL FROM:<${this.fromAddress}>\r\n`);
      await expect('250');
      socket.write(`RCPT TO:<${envelopeTo}>\r\n`);
      await expect('250');
      socket.write(`DATA\r\n`);
      await expect('354');
      const headers = [
        `From: ${this.fromHeader()}`,
        `To: ${toLine}`,
        `Subject: ${subject}`,
        `Message-ID: ${messageId}`,
        `MIME-Version: 1.0`,
        `Content-Type: text/plain; charset=utf-8`,
        `Content-Transfer-Encoding: 8bit`,
      ].join('\r\n');
      // Dot-stuff lines that start with a dot so the message cannot end early.
      const safeBody = body.replace(/\r?\n\./g, (m) => `${m.replace('.', '..')}`);
      socket.write(`${headers}\r\n\r\n${safeBody}\r\n.\r\n`);
      await expect('250');
      socket.write(`QUIT\r\n`);
      socket.end();
    } finally {
      socket.destroy();
    }
  }

  // The From line: display name when configured, address always.
  private fromHeader(): string {
    if (this.fromName === null) return `<${this.fromAddress}>`;
    if (/^[\x20-\x7E]+$/.test(this.fromName)) {
      return `"${this.fromName.replace(/([\\"])/g, '\\$1')}" <${this.fromAddress}>`;
    }
    return `=?utf-8?B?${Buffer.from(this.fromName, 'utf8').toString('base64')}?= <${this.fromAddress}>`;
  }
}
