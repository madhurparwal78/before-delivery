import './testenv.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSON_LIMIT_BYTES } from './config.ts';
import { matchRoute, matchSocketRoute, route, socketRoute } from './router.ts';

const handler = async () => ({ status: 204, headers: {}, body: Buffer.alloc(0) });

test('matches literal and :param segments and decodes parameters', () => {
  route('GET', '/api/test-router/:id/things/:handle', handler);
  const match = matchRoute('GET', '/api/test-router/d%201/things/Site%7CL1');
  assert.deepEqual(match?.params, { id: 'd 1', handle: 'Site|L1' });
  assert.equal(match?.bodyLimit, JSON_LIMIT_BYTES);
  assert.equal(match?.access, undefined);
});

test('the method and the segment count must match', () => {
  route('POST', '/api/test-router-b/:id', handler, { access: 'public', bodyLimit: 5 });
  assert.equal(matchRoute('GET', '/api/test-router-b/x'), null);
  assert.equal(matchRoute('POST', '/api/test-router-b/x/y'), null);
  const match = matchRoute('POST', '/api/test-router-b/x');
  assert.equal(match?.access, 'public');
  assert.equal(match?.bodyLimit, 5);
});

test('socket routes are matched apart from HTTP routes', () => {
  socketRoute('/api/test-router-c/:id/live', async () => ({ attach: () => undefined }));
  assert.equal(matchRoute('GET', '/api/test-router-c/x/live'), null);
  assert.deepEqual(matchSocketRoute('/api/test-router-c/x/live')?.params, { id: 'x' });
});

test('a malformed percent-escape is kept as sent', () => {
  route('GET', '/api/test-router-d/:id', handler);
  assert.deepEqual(matchRoute('GET', '/api/test-router-d/%E0%A4%A')?.params, { id: '%E0%A4%A' });
});

test('a parameter that decodes to a null character is kept as sent, so no lookup is made with it', () => {
  route('GET', '/api/test-router-e/:id', handler);
  assert.deepEqual(matchRoute('GET', '/api/test-router-e/a%00b')?.params, { id: 'a%00b' });
});
