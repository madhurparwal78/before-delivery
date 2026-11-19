// The mail sender: exactly the four messages Rushes sends.

import { SmtpClient, type MailMessage } from './smtp.js';
import type { Config } from '../config.js';
import { mailUnavailable } from '../errors.js';

export class Mailer {
  private client: SmtpClient;

  constructor(config: Config) {
    this.client = new SmtpClient(config.smtp);
  }

  async send(message: MailMessage): Promise<void> {
    try {
      await this.client.send(message);
    } catch {
      throw mailUnavailable();
    }
  }

  async verify(): Promise<boolean> {
    return this.client.verify();
  }
}
