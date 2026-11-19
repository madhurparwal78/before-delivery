import { App } from './app.js';

const env = {
  DATABASE_URL: process.env['DATABASE_URL'] ?? '',
  KILLBILL_URL: process.env['KILLBILL_URL'] ?? '',
  KILLBILL_USERNAME: process.env['KILLBILL_USERNAME'] ?? '',
  KILLBILL_PASSWORD: process.env['KILLBILL_PASSWORD'] ?? '',
  KILLBILL_API_KEY: process.env['KILLBILL_API_KEY'] ?? '',
  KILLBILL_API_SECRET: process.env['KILLBILL_API_SECRET'] ?? '',
  S3_ENDPOINT: process.env['S3_ENDPOINT'] ?? '',
  S3_REGION: process.env['S3_REGION'] ?? '',
  S3_BUCKET: process.env['S3_BUCKET'] ?? '',
  S3_FORCE_PATH_STYLE: process.env['S3_FORCE_PATH_STYLE'] ?? 'true',
  S3_ACCESS_KEY_ID: process.env['S3_ACCESS_KEY_ID'] ?? '',
  S3_SECRET_ACCESS_KEY: process.env['S3_SECRET_ACCESS_KEY'] ?? '',
  SMTP_HOST: process.env['SMTP_HOST'] ?? '',
  SMTP_PORT: process.env['SMTP_PORT'] ?? '1025',
  MAIL_FROM: process.env['MAIL_FROM'] ?? 'Saltmoon Practice <hello@saltmoon.example>',
  APP_PUBLIC_PORT: process.env['APP_PUBLIC_PORT'] ?? '4173',
};

const app = new App(env);
app.start().then(
  () => {
    console.log(`lanternfish listening on 0.0.0.0:${env.APP_PUBLIC_PORT}`);
  },
  (err) => {
    console.error('failed to start', err);
    process.exit(1);
  },
);
