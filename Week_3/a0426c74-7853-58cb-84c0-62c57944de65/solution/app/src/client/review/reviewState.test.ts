import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Issue, Markup, Rfi } from '../../shared/types.ts';
import { initialReviewState, reviewReducer } from './reviewState.ts';

const issue = (id: string, state: Issue['state'] = 'open'): Issue => ({
  id, version_id: 'v1', drawing_id: 'd', title: id, x: 0, y: 0, state, creator: 'a', rfi_ids: [],
});
const rfi = (id: string, state: Rfi['state'] = 'draft'): Rfi => ({
  id, issue_id: 'i1', question: id, answer: null, state, asker: 'a', addressee: 'b', ball_in_court: 'a',
});
const markup = (id: string): Markup => ({ id, version_id: 'v1', kind: 'cloud', x1: 0, y1: 0, x2: 1, y2: 1, text: '', flag: null, author: 'a' });

test('a live issue replaces the one it changes and is added when new', () => {
  const first = reviewReducer(initialReviewState, { type: 'issue', issue: issue('i1') });
  const changed = reviewReducer(first, { type: 'issue', issue: issue('i1', 'answered') });
  assert.deepEqual(changed.issues.map((entry) => entry.state), ['answered']);
  assert.equal(reviewReducer(changed, { type: 'issue', issue: issue('i2') }).issues.length, 2);
});

test('fetched issues keep an issue that only arrived live meanwhile', () => {
  const live = reviewReducer(initialReviewState, { type: 'issue', issue: issue('late') });
  const merged = reviewReducer(live, { type: 'issues', issues: [issue('early')], rfis: [rfi('r1')] });
  assert.deepEqual(merged.issues.map((entry) => entry.id), ['early', 'late']);
  assert.equal(merged.rfis.length, 1);
});

test('an RFI message updates the RFI and its issue', () => {
  const state = reviewReducer(initialReviewState, { type: 'rfi', rfi: rfi('r1', 'sent'), issue: issue('i1', 'answered') });
  assert.equal(state.rfis[0].state, 'sent');
  assert.equal(state.issues[0].state, 'answered');
});

test('markups are listed per version and a live markup is not duplicated by the fetch', () => {
  const live = reviewReducer(initialReviewState, { type: 'markup', markup: markup('m1') });
  const fetched = reviewReducer(live, { type: 'markups', versionId: 'v1', markups: [markup('m1'), markup('m2')] });
  assert.deepEqual(fetched.markups.v1.map((entry) => entry.id), ['m1', 'm2']);
});

test('a note is set for a version and cleared with null', () => {
  const noted = reviewReducer(initialReviewState, { type: 'note', versionId: 'v1', text: 'This review expired.' });
  assert.equal(noted.notes.v1, 'This review expired.');
  assert.deepEqual(reviewReducer(noted, { type: 'note', versionId: 'v1', text: null }).notes, {});
});
