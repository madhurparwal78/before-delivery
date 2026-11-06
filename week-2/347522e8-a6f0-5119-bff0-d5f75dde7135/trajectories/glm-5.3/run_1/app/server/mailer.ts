import nodemailer from "nodemailer";
import { config } from "./config.js";

// The app sends mail over SMTP only. Delivery failures never fail the action;
// the outbox retries on its own schedule (DP-30).

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: false,
  connectionTimeout: 5000,
  greetingTimeout: 5000,
  socketTimeout: 5000,
});

export const sendMail = async (to: string, subject: string, body: string): Promise<boolean> => {
  try {
    await transporter.sendMail({
      from: config.smtp.mailFrom,
      to,
      subject,
      text: body,
    });
    return true;
  } catch {
    return false;
  }
};
