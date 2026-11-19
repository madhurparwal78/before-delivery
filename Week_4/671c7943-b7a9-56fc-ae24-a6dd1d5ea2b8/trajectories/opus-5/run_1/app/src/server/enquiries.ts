import { randomBytes } from 'node:crypto';
import {
  findEnquiryBySubmission,
  markMailSent,
  storeEnquiry,
} from './db.js';
import { sendEnquiryMessages } from './mail.js';
import { MESSAGES, checkEnquiry, isSubmissionId } from '../shared/validation.js';
import type { MailOutcome, StoredEnquiry } from '../shared/types.js';

const briefUrl = (token: string): string => `/briefs/${token}.pdf`;

interface EnquiryBody {
  reference: string;
  brief_url: string;
  mail: MailOutcome;
}

export type EnquiryResult =
  | { status: 201 | 200; body: EnquiryBody }
  | { status: 422; body: { error: 'invalid'; fields: Record<string, string> } }
  | { status: 503; body: { error: 'unavailable'; message: string } };

const inFlight = new Map<string, Promise<EnquiryResult>>();

const answer = (enquiry: StoredEnquiry, status: 201 | 200): EnquiryResult => ({
  status,
  body: {
    reference: enquiry.reference,
    brief_url: briefUrl(enquiry.briefToken),
    mail: enquiry.mail,
  },
});

const unavailable: EnquiryResult = {
  status: 503,
  body: { error: 'unavailable', message: 'The enquiry could not be saved.' },
};

const readFields = (body: Record<string, unknown>) => ({
  name: body['name'],
  email: body['email'],
  projectType: body['project_type'],
  budget: body['budget'],
  description: body['description'],
});

function invalid(fields: Record<string, string>): EnquiryResult {
  return { status: 422, body: { error: 'invalid', fields } };
}

async function run(
  submissionId: string,
  body: Record<string, unknown>,
): Promise<EnquiryResult> {
  let stored: StoredEnquiry | null;
  try {
    stored = await findEnquiryBySubmission(submissionId);
  } catch {
    return unavailable;
  }
  if (stored) return answer(stored, 200);

  const check = checkEnquiry(readFields(body));
  if (check.values === null) {
    return invalid(
      Object.fromEntries(check.errors.map((error) => [error.field, error.message])),
    );
  }

  let enquiry: StoredEnquiry;
  try {
    enquiry = await storeEnquiry(submissionId, randomBytes(16).toString('hex'), check.values);
  } catch {
    return unavailable;
  }

  const mail = await sendEnquiryMessages(enquiry);
  if (mail === 'sent') {
    await markMailSent(submissionId);
  }
  return answer({ ...enquiry, mail }, 201);
}

const asReplay = (result: EnquiryResult): EnquiryResult =>
  result.status === 201 ? { status: 200, body: result.body } : result;

export function submitEnquiry(body: Record<string, unknown>): Promise<EnquiryResult> {
  const submissionId = body['submission_id'];
  if (!isSubmissionId(submissionId)) {
    const check = checkEnquiry(readFields(body));
    return Promise.resolve(
      invalid({
        submission_id: MESSAGES.submissionId,
        ...Object.fromEntries(check.errors.map((error) => [error.field, error.message])),
      }),
    );
  }

  const running = inFlight.get(submissionId);
  if (running) return running.then(asReplay);

  const started = run(submissionId, body);
  inFlight.set(submissionId, started);
  return started.finally(() => {
    inFlight.delete(submissionId);
  });
}
