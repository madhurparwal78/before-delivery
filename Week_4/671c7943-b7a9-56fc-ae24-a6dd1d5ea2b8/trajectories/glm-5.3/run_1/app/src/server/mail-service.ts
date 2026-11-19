import nodemailer, { type Transporter, type SendMailOptions } from "nodemailer";
import type { Config } from "./config.js";
import { budgetName, projectTypeName } from "../domain/model.js";

export interface EnquiryMessagePayload {
  reference: string;
  name: string;
  email: string;
  projectType: string;
  budget: string;
  description: string;
}

export interface MailOutcome {
  mail: "sent" | "not_sent";
}

export function firstName(name: string): string {
  const index = name.indexOf(" ");
  return index === -1 ? name : name.slice(0, index);
}

export function fieldLines(payload: EnquiryMessagePayload): string[] {
  return [
    `Reference: ${payload.reference}`,
    `Name: ${payload.name}`,
    `Email: ${payload.email}`,
    `Project type: ${projectTypeName(payload.projectType)}`,
    `Budget range: ${budgetName(payload.budget)}`,
    "",
    "Project description:",
    payload.description,
  ];
}

export function studioMessage(payload: EnquiryMessagePayload): { subject: string; text: string } {
  return {
    subject: `New enquiry ${payload.reference} · ${projectTypeName(payload.projectType)} · ${budgetName(payload.budget)}`,
    text: fieldLines(payload).join("\r\n"),
  };
}

export function acknowledgementMessage(payload: EnquiryMessagePayload): { subject: string; text: string } {
  const lines = [`Hello ${firstName(payload.name)},`, "", "Thank you for your enquiry. Maren will reply within two working days.", ""];
  return {
    subject: `Your enquiry ${payload.reference} to Sollis Studio`,
    text: [...lines, ...fieldLines(payload)].join("\r\n"),
  };
}

export class MailService {
  private transporter: Transporter | null = null;

  constructor(private config: Config) {}

  private connect(): Transporter {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: this.config.smtpHost,
        port: this.config.smtpPort,
        secure: false,
        tls: { rejectUnauthorized: false },
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        socketTimeout: 5000,
      });
    }
    return this.transporter;
  }

  async send(payload: EnquiryMessagePayload): Promise<MailOutcome> {
    try {
      const studio = studioMessage(payload);
      const acknowledgement = acknowledgementMessage(payload);
      await this.sendOne({
        from: this.config.mailFrom,
        to: this.config.studioEmail,
        replyTo: payload.email,
        subject: studio.subject,
        text: studio.text,
      });
      await this.sendOne({
        from: this.config.mailFrom,
        to: payload.email,
        subject: acknowledgement.subject,
        text: acknowledgement.text,
      });
      return { mail: "sent" };
    } catch (error) {
      this.transporter = null;
      return { mail: "not_sent" };
    }
  }

  private async sendOne(options: SendMailOptions): Promise<void> {
    const transporter = this.connect();
    const response = await transporter.sendMail(options);
    if (typeof response.rejected === "object" && response.rejected !== null && response.rejected.length > 0) {
      throw new Error("Message rejected by mail server");
    }
  }

  async available(): Promise<boolean> {
    try {
      await this.connect().verify();
      return true;
    } catch {
      this.transporter = null;
      return false;
    }
  }
}
