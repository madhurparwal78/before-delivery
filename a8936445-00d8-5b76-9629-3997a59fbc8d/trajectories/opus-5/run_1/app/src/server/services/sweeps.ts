import { config } from '../config.js';
import { pool } from '../db/pool.js';
import {
  claimReminderDocuments,
  clearSeedPdf,
  listSeedDocumentsNeedingFiles,
  undoReminderClaim,
} from '../db/repo/documents.js';
import {
  countEmailAttempt,
  markEmailDelivered,
  markReversalDone,
  pendingEmails,
  pendingReversals,
  queueEmail,
} from '../db/repo/outbox.js';
import { findTenant } from '../db/repo/tenants.js';
import { REMINDER_LEAD_DAYS } from '../domain/constants.js';
import { kitchenToday } from '../domain/time.js';
import { credit, externalCharge } from '../providers/killbill.js';
import { sendEmail } from '../providers/smtp.js';
import * as storage from '../providers/storage.js';
import { billingAccountFor } from './tenants.js';
import { expiryReminderEmail } from './emails.js';

const EMAIL_BATCH = 50;

async function uploadSeededFiles(): Promise<void> {
  const pending = await listSeedDocumentsNeedingFiles();
  if (pending.length === 0) return;
  await storage.ensureBucket();
  for (const document of pending) {
    await storage.putObject(document.storageKey, document.pdf, document.contentType);
    await clearSeedPdf(document.id);
  }
}

async function queueReminders(): Promise<void> {
  const documents = await claimReminderDocuments(kitchenToday(), REMINDER_LEAD_DAYS);
  for (const document of documents) {
    const tenant = await findTenant(document.tenantId);
    if (!tenant) {
      await undoReminderClaim(document.id);
      continue;
    }
    try {
      await queueEmail(
        pool,
        expiryReminderEmail(tenant, document.kind, document.holderName, document.expiresOn),
      );
    } catch (error) {
      await undoReminderClaim(document.id);
      throw error;
    }
  }
}

async function flushEmailQueue(): Promise<void> {
  for (const email of await pendingEmails(EMAIL_BATCH)) {
    await countEmailAttempt(email.id);
    await sendEmail(email);
    await markEmailDelivered(email.id);
  }
}

async function retryReversals(): Promise<void> {
  for (const reversal of await pendingReversals()) {
    const tenant = await findTenant(reversal.tenantId);
    if (!tenant) continue;
    const accountId = await billingAccountFor(tenant);
    if (reversal.recordKind === 'credit') {
      await credit(accountId, reversal.amountCents, reversal.description);
    } else {
      await externalCharge(accountId, reversal.amountCents, reversal.description);
    }
    await markReversalDone(reversal.id);
  }
}

async function runSweep(): Promise<void> {
  const steps = [uploadSeededFiles, queueReminders, flushEmailQueue, retryReversals];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      console.warn(`Sweep step ${step.name} deferred:`, (error as Error).message);
    }
  }
}

export function startSweeps(): void {
  void runSweep();
  setInterval(() => void runSweep(), config.reminderSweepSeconds * 1000);
}
