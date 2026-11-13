import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiError } from './errors.ts';
import * as copy from './copy.ts';
import {
  assertMayReopen, atLeast, ballFor, canRetryExport, clampSwipe, decideStep, editRefusal, expireReview, isConflict, isDownloadable, isExportBusy,
  MINIMUM_ROLE, moveExport, moveIssueTo, moveRfiTo, moveVersion, pendingStep, startReview, stepMinimumRole, swipeFromPointer, viewOnlyRefusal,
  voidReview,
} from './rules.ts';
import type { ReviewStep } from './types.ts';

const refused = (code: string, message: string) => (error: unknown): boolean =>
  error instanceof ApiError && error.code === code && error.message === message;

const DUE = '2026-11-05T10:00:00.000Z';
const LATER = '2026-11-05T11:00:00.000Z';

describe('version machine', () => {
  it('allows the published path and refuses the rest with the published sentence', () => {
    assert.equal(moveVersion('publishing', 'published'), 'published');
    assert.equal(moveVersion('in_review', 'published'), 'published');
    assert.throws(() => moveVersion('approved', 'in_review'), refused('illegal_transition', "A version can't go from approved to in_review."));
    assert.throws(() => moveVersion('voided', 'published'), refused('illegal_transition', "A version can't go from voided to published."));
  });
});

describe('review steps', () => {
  const started = startReview('published', DUE);

  it('opens the markup step and waits on the manage step', () => {
    assert.equal(started.state, 'in_review');
    assert.deepEqual(started.steps, [
      { role: 'markup', state: 'pending', due_at: DUE },
      { role: 'manage', state: 'waiting', due_at: null },
    ]);
  });

  it('refuses to start from approved', () => {
    assert.throws(() => startReview('approved', DUE), refused('illegal_transition', "A version can't go from approved to in_review."));
  });

  it('refuses the manage step before the markup step', () => {
    assert.throws(() => decideStep({ state: 'in_review' }, started.steps, 'manage', 'approved', LATER), refused('out_of_order', 'Waiting on the step before.'));
    assert.throws(() => decideStep({ state: 'in_review' }, started.steps, 'manage', 'rejected', LATER), refused('out_of_order', 'Waiting on the step before.'));
  });

  it('opens the next step when one is approved and approves the version after the last', () => {
    const first = decideStep({ state: 'in_review' }, started.steps, 'markup', 'approved', LATER);
    assert.equal(first.state, 'in_review');
    assert.deepEqual(first.steps, [
      { role: 'markup', state: 'approved', due_at: DUE },
      { role: 'manage', state: 'pending', due_at: LATER },
    ]);
    const last = decideStep({ state: 'in_review' }, first.steps, 'manage', 'approved', LATER);
    assert.equal(last.state, 'approved');
  });

  it('rejects the version at any step and decides a step once', () => {
    const rejected = decideStep({ state: 'in_review' }, started.steps, 'markup', 'rejected', LATER);
    assert.equal(rejected.state, 'rejected');
    assert.throws(() => decideStep({ state: 'rejected' }, rejected.steps, 'markup', 'approved', LATER), refused('illegal_transition', "A version can't go from rejected to approved."));
  });

  it('expires the pending step and returns the version to published', () => {
    const expired = expireReview(started.steps);
    assert.equal(expired.state, 'published');
    assert.equal(expired.steps[0].state, 'expired');
    assert.throws(() => decideStep({ state: 'published' }, expired.steps, 'markup', 'approved', LATER), refused('review_expired', 'This review expired.'));
  });

  it('voids the undecided steps of a replaced review and names the replacing version', () => {
    const voided = voidReview('in_review', started.steps);
    assert.equal(voided.state, 'voided');
    assert.deepEqual(voided.steps.map((step: ReviewStep) => step.state), ['voided', 'voided']);
    assert.throws(
      () => decideStep({ state: 'voided', replacedByNumber: 4 }, voided.steps, 'markup', 'approved', LATER),
      refused('review_voided', 'Review voided: version 4 replaced this one.'),
    );
  });

  it('leaves approved and rejected versions as they are when a newer version replaces them', () => {
    const rejected = decideStep({ state: 'in_review' }, started.steps, 'markup', 'rejected', LATER);
    assert.deepEqual(voidReview('rejected', rejected.steps), rejected);
  });
});

describe('issues', () => {
  it('moves open, answered, closed and back', () => {
    assert.equal(moveIssueTo('open', 'answered', []), 'answered');
    assert.equal(moveIssueTo('answered', 'closed', ['closed']), 'closed');
    assert.equal(moveIssueTo('closed', 'open', []), 'open');
    assert.throws(() => moveIssueTo('open', 'closed', []), refused('illegal_transition', "An issue can't go from open to closed."));
  });

  it('cannot close while an RFI is not closed', () => {
    assert.throws(() => moveIssueTo('answered', 'closed', ['answered']), refused('rfi_open', 'Close its RFI first.'));
  });

  it('lets only a manager or the creator reopen', () => {
    assert.doesNotThrow(() => assertMayReopen('open', 'rae', { username: 'rae', manager: false }));
    assert.doesNotThrow(() => assertMayReopen('open', 'rae', { username: 'mo', manager: true }));
    assert.throws(() => assertMayReopen('open', 'rae', { username: 'ash', manager: false }), (error: unknown) => error instanceof ApiError && error.code === 'forbidden');
    assert.doesNotThrow(() => assertMayReopen('closed', 'rae', { username: 'ash', manager: false }));
  });
});

describe('RFIs', () => {
  const draft = { state: 'draft', asker: 'rae', addressee: 'ash', ball_in_court: 'rae', answer: null } as const;

  it('moves the ball to the addressee on send and back to the asker on answer', () => {
    const sent = moveRfiTo(draft, 'sent', undefined, 'rae');
    assert.equal(sent.ball_in_court, 'ash');
    const answered = moveRfiTo(sent, 'answered', 'The north one', 'ash');
    assert.deepEqual([answered.state, answered.ball_in_court, answered.answer], ['answered', 'rae', 'The north one']);
    assert.equal(moveRfiTo(answered, 'sent', undefined, 'rae').ball_in_court, 'ash');
    assert.equal(moveRfiTo(answered, 'closed', undefined, 'rae').state, 'closed');
  });

  it('refuses anyone but the ball in court before looking at the state', () => {
    assert.throws(() => moveRfiTo(draft, 'answered', 'x', 'ash'), refused('not_ball_in_court', 'This RFI is with rae.'));
  });

  it('refuses a move the machine does not have, then an answer that is missing', () => {
    assert.throws(() => moveRfiTo(draft, 'answered', 'x', 'rae'), refused('illegal_transition', "An RFI can't go from draft to answered."));
    const sent = moveRfiTo(draft, 'sent', undefined, 'rae');
    assert.throws(() => moveRfiTo(sent, 'answered', undefined, 'ash'), (error: unknown) => error instanceof ApiError && error.code === 'invalid');
  });
});

describe('export machine', () => {
  it('retries only a failed job', () => {
    assert.equal(moveExport('failed', 'running'), 'running');
    assert.throws(() => moveExport('ready', 'running'), refused('illegal_transition', "An export can't go from ready to running."));
  });
});

describe('roles', () => {
  it('orders view < markup < edit < manage', () => {
    assert.ok(atLeast('manage', 'edit') && atLeast('edit', 'edit') && atLeast('markup', 'view'));
    assert.ok(!atLeast('markup', 'edit') && !atLeast('view', 'markup'));
  });

  it('names the lowest role of each action, and of each review step', () => {
    assert.ok(atLeast('edit', MINIMUM_ROLE.publish) && !atLeast('markup', MINIMUM_ROLE.publish));
    assert.ok(atLeast('markup', MINIMUM_ROLE.raiseIssue) && !atLeast('view', MINIMUM_ROLE.raiseIssue));
    assert.ok(atLeast('manage', MINIMUM_ROLE.createLink) && !atLeast('edit', MINIMUM_ROLE.createLink));
    assert.equal(stepMinimumRole('markup'), 'markup');
    assert.equal(stepMinimumRole('manage'), 'manage');
  });

  it('refuses editing by view-only roles, and by a phone whatever the role', () => {
    assert.equal(editRefusal('edit', false), null);
    assert.equal(editRefusal('manage', false), null);
    assert.equal(editRefusal('view', false), copy.VIEW_ONLY);
    assert.equal(editRefusal('markup', false), copy.VIEW_ONLY);
    assert.equal(editRefusal('manage', true), copy.PHONE_COMMAND);
    assert.equal(viewOnlyRefusal(false), copy.VIEW_ONLY);
    assert.equal(viewOnlyRefusal(true), copy.PHONE_COMMAND);
  });
});

describe('operation results', () => {
  it('counts every status but applied as a conflict', () => {
    assert.equal(isConflict({ status: 'applied' }), false);
    for (const status of ['rebased', 'dropped', 'redirected'] as const) assert.equal(isConflict({ status }), true);
  });
});

describe('pending review step', () => {
  it('is the first pending step, and none once the review is decided', () => {
    const started = startReview('published', DUE);
    assert.equal(pendingStep(started.steps)?.role, 'markup');
    const approved = decideStep({ state: 'in_review' }, started.steps, 'markup', 'approved', LATER);
    assert.equal(pendingStep(approved.steps)?.role, 'manage');
    assert.equal(pendingStep(decideStep({ state: 'in_review' }, approved.steps, 'manage', 'approved', LATER).steps), undefined);
  });
});

describe('ball in court', () => {
  it('is with the addressee while the RFI is sent and with the asker otherwise', () => {
    assert.equal(ballFor('sent', 'rae', 'ash'), 'ash');
    for (const state of ['draft', 'answered', 'closed'] as const) assert.equal(ballFor(state, 'rae', 'ash'), 'rae');
  });
});

describe('export decisions', () => {
  it('retries a failed job, is busy while queued or running, downloads when ready', () => {
    assert.deepEqual((['queued', 'running', 'ready', 'failed'] as const).map(canRetryExport), [false, false, false, true]);
    assert.deepEqual((['queued', 'running', 'ready', 'failed'] as const).map(isExportBusy), [true, true, false, false]);
    assert.deepEqual((['queued', 'running', 'ready', 'failed'] as const).map(isDownloadable), [false, false, true, false]);
  });
});

describe('compare swipe', () => {
  it('rounds to whole percent and stays within 0 to 100', () => {
    assert.equal(clampSwipe(33.4), 33);
    assert.equal(clampSwipe(-5), 0);
    assert.equal(clampSwipe(140), 100);
    assert.equal(swipeFromPointer(50, 200), 25);
    assert.equal(swipeFromPointer(-10, 200), 0);
    assert.equal(swipeFromPointer(250, 200), 100);
  });
});
