// Published copy that both the server (503 bodies, HTML pages) and the browser (banners) render.

export type ServiceName =
  | "postgres"
  | "keycloak"
  | "killbill"
  | "mailpit"
  | "minio"
  | "gotenberg"
  | "svix"
  | "ntfy"
  | "renderProvider";

export const SERVICE_NAMES: readonly ServiceName[] = [
  "postgres", "keycloak", "killbill", "mailpit", "minio", "gotenberg", "svix", "ntfy", "renderProvider",
];

export const BANNERS: Record<ServiceName, string> = {
  killbill: "Payments are paused — our billing system isn't answering. Nothing has been charged.",
  mailpit: "Emails are delayed — receipts and notices will arrive once our mail service is back.",
  minio: "Uploads are paused — our file store isn't answering. Nothing was saved.",
  gotenberg: "Documents are delayed — PDFs will appear here once our document service is back.",
  svix: "CRM updates are delayed — they'll be sent once our webhook service is back.",
  ntfy: "Crew alerts are delayed — they'll be posted once our alert service is back.",
  renderProvider: "Concept previews are delayed — requests are queued and will start once our render partner is back.",
  keycloak: "Sign-in is paused — our sign-in service isn't answering. If you're already signed in, you can keep working for now.",
  postgres: "The studio is offline — we can't reach our records. Try again in a minute.",
};

export const SIGN_IN_ERROR = {
  heading: "Sign-in didn't complete",
  text: "That sign-in link has expired, was already used or was opened in a different browser. Start again from Sign in.",
};
