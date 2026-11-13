// Pending steps: charge posting, requested invoice commits and notices. One pass runs at a time,
// every few seconds, so each pending step runs exactly once when its provider is reachable.
import type { App } from "./app.js";
import { commitInvoice, postCharges } from "./domain/billing.js";
import { forgetOldKeys } from "./idempotency.js";
import { ProviderError } from "./providers/providerError.js";
import type { NoticeRecord } from "./store.js";

const PASS_MS = 3000;

/** One step's provider failure leaves it pending for the next pass; anything else is a defect to log. */
async function attempt(step: () => Promise<void>): Promise<void> {
  try {
    await step();
  } catch (error) {
    if (!(error instanceof ProviderError)) console.error(error);
  }
}

async function postPendingCharges(app: App): Promise<void> {
  const invoices = app.store.invoices.all().sort((a, b) => a.seq - b.seq);
  for (const invoice of invoices.filter((i) => i.charge_state === "pending")) {
    await attempt(() => postCharges(app, invoice.id));
  }
  for (const invoice of app.store.invoices.all()) {
    if (invoice.issue_requested_by && invoice.state === "pending" && invoice.charge_state === "posted") {
      await attempt(async () => {
        await commitInvoice(app, invoice.id);
      });
    }
  }
}

/** Sends one notice; it becomes `sent` only after the SMTP server accepts the message. */
async function sendNotice(app: App, notice: NoticeRecord): Promise<void> {
  const photos = notice.photo_ids.flatMap((id) => app.store.photos.get(id) ?? []);
  if (photos.length && !app.services.up("storage")) return;
  const attachments = [];
  for (const photo of photos) {
    attachments.push({
      filename: `${photo.id}.${photo.content_type.split("/")[1] ?? "bin"}`,
      contentType: photo.content_type,
      data: await app.objects.get(photo.key),
    });
  }
  await app.mailer.send({ to: notice.to, subject: notice.subject, text: notice.body, attachments });
  app.store.notices.put({ ...notice, state: "sent" });
}

async function sendPendingNotices(app: App): Promise<void> {
  const pending = app.store.notices.by("state", "pending").sort((a, b) => a.seq - b.seq);
  for (const notice of pending) await attempt(() => sendNotice(app, notice));
}

export function startSteps(app: App): void {
  let running = false;
  const pass = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await app.services.check();
      if (app.services.up("billing")) await postPendingCharges(app);
      if (app.services.up("mail")) await sendPendingNotices(app);
      forgetOldKeys(app.store);
    } finally {
      running = false;
    }
  };
  void pass();
  setInterval(() => void pass(), PASS_MS);
}
