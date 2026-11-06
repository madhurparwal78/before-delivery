import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { createReadableStreamFromReadable } from '@react-router/node';
import { ServerRouter } from 'react-router';
import { renderToPipeableStream } from 'react-dom/server';

export const streamTimeout = 5_000;

/**
 * Render the whole document before answering, so every route arrives fully
 * drawn by the server. No dependency on a bot-detection library.
 */
export default function handleRequest(
  request,
  responseStatusCode,
  responseHeaders,
  routerContext,
) {
  if (request.method.toUpperCase() === 'HEAD') {
    return new Response(null, {
      status: responseStatusCode,
      headers: responseHeaders,
    });
  }

  return new Promise((resolve, reject) => {
    let shellRendered = false;
    const timeoutId = setTimeout(() => abort(), streamTimeout + 1_000);

    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={routerContext} url={request.url} />,
      {
        onAllReady() {
          shellRendered = true;
          clearTimeout(timeoutId);
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);
          responseHeaders.set('content-type', 'text/html; charset=utf-8');
          resolve(
            new Response(stream, {
              status: responseStatusCode,
              headers: responseHeaders,
            })
          );
          pipe(body);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          if (shellRendered) {
            console.error(error);
          }
        },
      }
    );
  });
}
