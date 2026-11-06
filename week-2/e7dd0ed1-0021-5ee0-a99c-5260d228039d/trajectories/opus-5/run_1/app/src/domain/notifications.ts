import type { PoolClient } from '../db';
import { formatCount, formatTime } from '../format';
import { ownerEmails, queueMail } from '../services/mail';

function bytes(value: number): string {
  return `${formatCount(value)} bytes`;
}

export async function mailInvite(
  client: PoolClient,
  options: { email: string; workspaceName: string; role: string; acceptUrl: string; expiresAt: Date },
): Promise<void> {
  await queueMail(
    client,
    options.email,
    `You're invited to ${options.workspaceName} on Farshore`,
    [
      `You have been invited to join ${options.workspaceName} on Farshore as ${options.role}.`,
      `Accept the invite: ${options.acceptUrl}`,
      `This invite expires ${formatTime(options.expiresAt)}.`,
    ].join('\n'),
  );
}

export async function mailKeyCreated(
  client: PoolClient,
  slug: string,
  options: { keyId: string; workspaceName: string; description: string; permission: string; creatorName: string },
): Promise<void> {
  for (const email of await ownerEmails(client, slug)) {
    await queueMail(
      client,
      email,
      `New access key ${options.keyId} in ${options.workspaceName}`,
      [
        `Access key ${options.keyId} was created in ${options.workspaceName}.`,
        `Description: ${options.description}`,
        `Permission: ${options.permission}`,
        `Created by: ${options.creatorName}`,
        'The secret is shown only once, in the console, and is never emailed.',
      ].join('\n'),
    );
  }
}

export async function mailKeyRotated(
  client: PoolClient,
  slug: string,
  options: { keyId: string; workspaceName: string; previousSecretExpiresAt: Date },
): Promise<void> {
  for (const email of await ownerEmails(client, slug)) {
    await queueMail(
      client,
      email,
      `Access key ${options.keyId} rotated in ${options.workspaceName}`,
      [
        `Access key ${options.keyId} was rotated in ${options.workspaceName}.`,
        `The previous secret stops working ${formatTime(options.previousSecretExpiresAt)}.`,
        'Neither secret is included in this message.',
      ].join('\n'),
    );
  }
}

export async function mailTwoStepOn(client: PoolClient, email: string, at: Date): Promise<void> {
  await queueMail(
    client,
    email,
    'Two-step sign-in turned on for your Farshore account',
    [`Two-step sign-in was turned on ${formatTime(at)}.`, 'If this was not you, change your password and turn it off.'].join('\n'),
  );
}

export async function mailTwoStepOff(client: PoolClient, email: string, at: Date): Promise<void> {
  await queueMail(
    client,
    email,
    'Two-step sign-in turned off for your Farshore account',
    [`Two-step sign-in was turned off ${formatTime(at)}.`, 'If this was not you, change your password at once.'].join('\n'),
  );
}

export async function mailPasswordChanged(client: PoolClient, email: string, at: Date, endedSessions: number): Promise<void> {
  await queueMail(
    client,
    email,
    'Your Farshore password was changed',
    [
      `Your password was changed ${formatTime(at)}.`,
      `Other sessions signed out: ${formatCount(endedSessions)}.`,
      'This message never contains your password.',
    ].join('\n'),
  );
}

export async function mailThreshold(
  client: PoolClient,
  slug: string,
  options: { workspaceName: string; metric: 'storage' | 'egress'; threshold: 80 | 100; currentBytes: number; includedBytes: number },
): Promise<void> {
  for (const email of await ownerEmails(client, slug)) {
    await queueMail(
      client,
      email,
      `${options.workspaceName} has used ${options.threshold}% of included ${options.metric}`,
      [
        `${options.workspaceName} has used ${bytes(options.currentBytes)} of ${bytes(options.includedBytes)} included ${options.metric}.`,
        'Usage figures are month to date in UTC.',
      ].join('\n'),
    );
  }
}

export async function mailSuspended(
  client: PoolClient,
  slug: string,
  options: { workspaceName: string; reason: string },
): Promise<void> {
  for (const email of await ownerEmails(client, slug)) {
    await queueMail(
      client,
      email,
      `${options.workspaceName} is suspended on Farshore`,
      [
        `${options.workspaceName} is suspended on Farshore.`,
        `Reason: ${options.reason}`,
        'Uploads, downloads and share links are paused until it is reinstated.',
      ].join('\n'),
    );
  }
}

export async function mailDeadDelivery(
  client: PoolClient,
  slug: string,
  options: { workspaceName: string; host: string; eventType: string; sequence: number; attempts: number },
): Promise<void> {
  for (const email of await ownerEmails(client, slug)) {
    await queueMail(
      client,
      email,
      `Webhook delivery failed in ${options.workspaceName}`,
      [
        `A webhook delivery to ${options.host} failed for good in ${options.workspaceName}.`,
        `Event type: ${options.eventType}`,
        `Sequence: ${formatCount(options.sequence)}`,
        `Attempts: ${formatCount(options.attempts)}`,
        'Redeliver it from the endpoint\u2019s deliveries page once the receiver is fixed.',
      ].join('\n'),
    );
  }
}
