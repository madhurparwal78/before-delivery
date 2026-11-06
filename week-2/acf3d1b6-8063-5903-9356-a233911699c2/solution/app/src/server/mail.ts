import { Injectable, Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { config } from './config.js';

export interface Message {
  to: string;
  subject: string;
  text: string;
}

/** The one SMTP transport. A failed send is logged and never undoes the stored change that asked for it. */
@Injectable()
export class Mailer {
  private readonly logger = new Logger('Mailer');
  private readonly transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: false,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
  });

  async send(message: Message): Promise<void> {
    try {
      await this.transport.sendMail({ from: config.mailFrom, ...message });
    } catch (error) {
      this.logger.error(`Could not send "${message.subject}" to ${message.to}: ${(error as Error).message}`);
    }
  }
}
