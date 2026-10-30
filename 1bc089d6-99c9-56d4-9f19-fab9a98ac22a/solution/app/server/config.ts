/** The app's configuration, read from the environment once, at start. Nothing here is sent to the browser. */

const port = Number(process.env.APP_PUBLIC_PORT ?? 4173);

export const config = {
  port,
  /** Where emailed links point: STILLHOUR_PUBLIC_ORIGIN when set, otherwise this server on localhost. */
  origin: (process.env.STILLHOUR_PUBLIC_ORIGIN || `http://localhost:${port}`).replace(/\/+$/, ""),
  databaseUrl: process.env.DATABASE_URL,
  smtp: { host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT) },
  /** The From of every email; the brief sets MAIL_FROM to this value. */
  mailFrom: process.env.MAIL_FROM || "Stillhour <goodnight@stillhour.example>",
  testClock: process.env.STILLHOUR_TEST_CLOCK === "1",
};
