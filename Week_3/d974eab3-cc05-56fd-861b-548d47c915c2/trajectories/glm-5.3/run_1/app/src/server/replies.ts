export function json<T>(status: number, body: T): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export function notFound(): Response {
  return json(404, { error: 'not_found', message: 'Not found.' });
}

export const BODY_LIMIT = 262144;

export function tooLarge(): Response {
  return json(413, { error: 'too_large', message: 'The request body is too large.' });
}

export function invalid(): Response {
  return json(422, { error: 'invalid', message: 'The content does not match the published shape.' });
}

export function sheetUnavailable(): Response {
  return json(503, {
    error: 'sheet_unavailable',
    message: 'The product sheet cannot be prepared right now. Please try again in a few minutes.',
  });
}
