// Minimal ambient declarations for the parts of nodemailer the app uses.
declare module "nodemailer" {
  export interface TransportOptions {
    host: string;
    port: number;
    secure: boolean;
    ignoreTLS?: boolean;
  }
  export interface SendMailOptions {
    from: string;
    to: string;
    subject: string;
    text: string;
  }
  export interface Transporter {
    sendMail(options: SendMailOptions): Promise<unknown>;
    close(): void;
  }
  export function createTransport(options: TransportOptions): Transporter;
}
