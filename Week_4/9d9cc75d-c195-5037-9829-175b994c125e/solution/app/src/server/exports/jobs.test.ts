import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requestKey, type ExportRequest } from './jobs.ts';

const request: ExportRequest = { kind: 'csv', target: { sheet: 'abc' }, filters: [], parameters: { Top: 2, Name: 'x' } };

test('the same request has the same key whatever the order of its keys', () => {
  const reordered: ExportRequest = { ...request, parameters: { Name: 'x', Top: 2 } };
  assert.equal(requestKey(request), requestKey(reordered));
});

test('another kind, target or parameter is another request', () => {
  assert.notEqual(requestKey(request), requestKey({ ...request, kind: 'pdf' }));
  assert.notEqual(requestKey(request), requestKey({ ...request, target: { dashboard: 'abc' } }));
  assert.notEqual(requestKey(request), requestKey({ ...request, parameters: { Top: 3, Name: 'x' } }));
});
