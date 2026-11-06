import { feedback, refusals } from '../shared/copy.js';

/**
 * One JSON call to the desk's own API. Answers `{ status, body }`, or a generic
 * refusal when no answer came back at all.
 */
export async function call(method, path, { body, headers } = {}) {
  try {
    const response = await fetch(path, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
    if (response.status === 204) return { status: 204, body: null, headers: response.headers };
    const text = await response.text();
    let parsed = null;
    try {
      parsed = text === '' ? null : JSON.parse(text);
    } catch {
      parsed = null;
    }
    if (parsed === null && !response.ok) {
      return { status: response.status, body: { error: feedback.noServer }, headers: response.headers };
    }
    return { status: response.status, body: parsed, headers: response.headers };
  } catch {
    return { status: 0, body: { error: feedback.noServer }, headers: new Headers() };
  }
}

export function refusalWording(answer) {
  return answer.body?.error ?? feedback.noServer;
}

export function isEndedSession(answer) {
  return answer.status === 401 && answer.body?.error === refusals.sessionEnded;
}
