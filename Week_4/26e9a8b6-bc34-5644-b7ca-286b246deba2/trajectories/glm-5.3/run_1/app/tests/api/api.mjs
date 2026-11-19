const BASE = process.env.PW_BASE_URL ?? 'http://127.0.0.1:4173';
let failures = 0;
function check(name, condition, detail) {
  if (condition) console.log(`PASS ${name}`);
  else { failures++; console.log(`FAIL ${name}: ${detail ?? ''}`); }
}
async function req(method, path, body, headers = {}, raw = false) {
  const response = await fetch(BASE + path, {
    method,
    headers: { ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {}), ...headers },
    body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: response.status, headers: response.headers, text, json };
}

async function main() {
  // Basic routing
  let r = await req('GET', '/api/health');
  check('health ok', r.status === 200 && r.json.status === 'ok', JSON.stringify(r.json));

  r = await req('GET', '/api/unknown-path');
  check('unknown api path 404', r.status === 404 && r.json.error === 'not_found');

  r = await req('DELETE', '/api/health');
  check('wrong method 405', r.status === 405 && r.json.error === 'method_not_allowed' && r.headers.get('allow') !== null);

  r = await req('POST', '/api/accounts', { name: 'x', email: 'x@y.zz', password: '12345678' }, { 'content-type': 'text/plain' });
  check('wrong content type 415', r.status === 415 && r.json.error === 'unsupported_media_type');

  r = await req('GET', '/api/guides/unknown-guide-id');
  check('unknown guide 404', r.status === 404);

  // Sign up flow with mail
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const email = `tester-${stamp}@example.test`;
  r = await req('POST', '/api/accounts', { name: `Test Person ${stamp}`, email, password: 'longpassword1' });
  check('signup 201', r.status === 201 && r.json.user.email === email && r.json.message_sent === true, r.text);
  const signupCookies = r.headers.get('set-cookie');
  check('signup sets session', signupCookies !== null && signupCookies.includes('pw_session='));

  // Mailpit: fetch the confirmation link
  const messagesResponse = await fetch('http://mailpit:8025/api/v1/messages');
  const messagesJson = await messagesResponse.json();
  const message = messagesJson.messages.find((m) => m.To[0].Address === email);
  check('message delivered', !!message, 'no message to ' + email);
  check('message from', message.From.Address === 'no-reply@pennywasher.example');
  check('message subject', message.Subject === 'Confirm your Pennywasher account');
  const bodyResponse = await fetch(`http://mailpit:8025/api/v1/message/${message.ID}`);
  const bodyText = (await bodyResponse.json()).Text;
  const match = bodyText.match(/token=([A-Za-z0-9_-]+)/);
  check('token link in message', !!match, bodyText);
  const token = match[1];

  // Unconfirmed restrictions
  r = await req('GET', '/api/guides/coffee-grinder-fit-new-burrs');
  const gid = r.json.id;
  check('guide reading ok', r.status === 200 && r.json.title === 'Coffee grinder: fit new burrs');
  check('guide total', r.json.total_cost_text === '€21.30', r.json.total_cost_text);
  check('parts count', r.json.part_count === 9);
  check('steps count', r.json.step_count === 5);
  check('step 4 cost', r.json.steps[3].parts_cost_text === '€18.90', r.json.steps[3].parts_cost_text);
  check('step 5 cost', r.json.steps[4].parts_cost_text === '€21.30', r.json.steps[4].parts_cost_text);

  // working copy needs session
  r = await req('GET', `/api/guides/${gid}/working`);
  check('working signed out 401', r.status === 401 && r.json.error === 'not_signed_in');

  // unconfirmed upload refused
  const glb = readFileSync('/app/public/samples/coffee-grinder.glb');
  r = await req('POST', `/api/guides/${gid}/model`, glb, { 'content-type': 'model/gltf-binary', cookie: signupCookies }, true);
  check('unconfirmed upload 403', r.status === 403 && r.json.error === 'unconfirmed', r.text);

  // confirm the token (no session needed)
  r = await req('POST', '/api/account/confirm', { token });
  check('confirm 200', r.status === 200 && r.json.confirmed === true, r.text);

  // token cannot be reused
  r = await req('POST', '/api/account/confirm', { token });
  check('token reuse 410', r.status === 410 && r.json.error === 'token_invalid');

  // create a guide
  r = await req('POST', '/api/guides', { title: 'My first guide', currency: 'EUR' }, { cookie: signupCookies });
  check('create guide 201', r.status === 201 && !!r.json.id, r.text);
  const myGuide = r.json.id;

  // working copy
  r = await req('GET', `/api/guides/${myGuide}/working`, undefined, { cookie: signupCookies });
  check('working 200', r.status === 200 && r.json.latest_version === null, r.text);
  check('no model copy', r.json.model === null);

  // add a step
  r = await req('POST', `/api/guides/${myGuide}/steps`, { title: 'First step' }, { cookie: signupCookies });
  check('add step 201', r.status === 201 && r.json.number === 1, r.text);
  const stepId = r.json.id;

  // commit a field
  r = await req('PATCH', `/api/guides/${myGuide}/working`, { field: `step/${stepId}/text`, value: 'Hello world', based_on: 0 }, { cookie: signupCookies });
  check('commit text 200', r.status === 200 && r.json.field_revision === 1, r.text);

  // stale commit 409
  r = await req('PATCH', `/api/guides/${myGuide}/working`, { field: `step/${stepId}/text`, value: 'Second try', based_on: 0 }, { cookie: signupCookies });
  check('stale commit 409', r.status === 409 && r.json.error === 'edit_conflict' && r.json.theirs.by.length > 0, r.text);

  // upload a model
  r = await req('POST', `/api/guides/${myGuide}/model`, glb, { 'content-type': 'model/gltf-binary', cookie: signupCookies }, true);
  check('model upload 201', r.status === 201 && r.json.model.state === 'stored', r.text);
  check('model parts', r.json.parts.length === 9, r.text);

  // bad model: text file renamed
  const textBytes = Buffer.from('not a glb file at all');
  r = await req('POST', `/api/guides/${myGuide}/model`, textBytes, { 'content-type': 'model/gltf-binary', cookie: signupCookies }, true);
  check('not glb refused', r.status === 422 && r.json.error === 'not_glb', r.text);

  // save a version
  r = await req('POST', `/api/guides/${myGuide}/versions`, { base_version: null }, { cookie: signupCookies });
  check('save version 201', r.status === 201 && r.json.number === 1, r.text);

  // publish without scale confirmation
  r = await req('POST', `/api/guides/${myGuide}/publish`, {}, { cookie: signupCookies });
  console.log('DEBUG publish url:', `/api/guides/${myGuide}/publish`, 'status', r.status, r.text);
  check('publish scale refused', r.status === 422 && r.json.error === 'scale_unconfirmed', r.text);

  // confirm scale then publish
  r = await req('PATCH', `/api/guides/${myGuide}/working`, { field: 'model_scale_confirmed', value: true, based_on: 0 }, { cookie: signupCookies });
  check('confirm scale', r.status === 200, r.text);
  r = await req('POST', `/api/guides/${myGuide}/publish`, {}, { cookie: signupCookies });
  check('publish 200', r.status === 200 && r.json.state === 'published', r.text);

  // search finds it
  r = await req('GET', '/api/search?q=first');
  check('search finds guide', r.status === 200 && r.json.items.some((i) => i.id === myGuide), r.text);

  // ask a question (confirmed user on own guide)
  r = await req('POST', `/api/guides/${myGuide}/questions`, { step: 1, text: 'How do I do this?' }, { cookie: signupCookies });
  check('ask question 201', r.status === 201, r.text);
  const questionId = r.json.id;

  // answer it
  r = await req('POST', `/api/questions/${questionId}/answer`, { text: 'Just follow along.' }, { cookie: signupCookies });
  check('answer 201', r.status === 201 && r.json.answer.text === 'Just follow along.', r.text);

  // answer again: already answered
  r = await req('POST', `/api/questions/${questionId}/answer`, { text: 'Twice.' }, { cookie: signupCookies });
  check('second answer 409', r.status === 409 && r.json.error === 'already_answered', r.text);

  // private guide: sign out and try to read it
  const worldResponse = await req('POST', '/api/grading/world');
  const world = worldResponse.json;
  r = await req('GET', `/api/guides/${world.guides.private.id}`);
  check('private guide 404 signed out', r.status === 404, r.status + ' ' + r.text);

  // withdrawn guide: 410 to others
  r = await req('GET', `/api/guides/${world.guides.withdrawn.id}`);
  check('withdrawn guide 410', r.status === 410 && r.json.error === 'withdrawn', r.status + ' ' + r.text);

  // fork the public guide as the confirmed user
  r = await req('POST', `/api/guides/${world.guides.public.id}/forks`, {}, { cookie: signupCookies });
  check('fork 201', r.status === 201 && r.json.slug.includes('fork'), r.text);
  const forkId = r.json.id;

  // fork credit in reading JSON
  r = await req('GET', `/api/guides/${forkId}`, undefined, { cookie: signupCookies });
  check('fork credit', r.status === 200 && r.json.forked_from !== null && r.json.forked_from.version === 3, r.text);

  // cannot fork a private guide
  r = await req('POST', `/api/guides/${world.guides.private.id}/forks`, {}, { cookie: signupCookies });
  check('private fork 404', r.status === 404, r.text);

  // dashboard
  r = await req('GET', '/api/dashboard', undefined, { cookie: signupCookies });
  check('dashboard 200', r.status === 200 && Array.isArray(r.json.forks), r.text);
  check('dashboard fork listed', r.json.forks.some((f) => f.id === forkId), r.text);

  // search page limits
  r = await req('GET', '/api/search?q=' + 'a'.repeat(201));
  check('search query too long 422', r.status === 422 && r.json.error === 'query_too_long', r.text);
  const tooManyTags = Array.from({ length: 9 }, (_, i) => `tag=${i}`).join('&');
  r = await req('GET', '/api/search?' + tooManyTags);
  check('search too many tags 422', r.status === 422 && r.json.error === 'too_many_tags', r.text);

  console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
}
import { readFileSync } from 'node:fs';
main().catch((e) => { console.log('TEST ERROR', e); });
