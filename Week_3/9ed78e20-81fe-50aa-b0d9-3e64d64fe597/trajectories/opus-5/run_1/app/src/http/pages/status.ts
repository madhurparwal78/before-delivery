import type { ApiError } from '../errors.js';
import { html, type Html } from '../html.js';
import { navModels, page } from './layout.js';
import { resendForm } from './public.js';
import type { Ctx } from '../server.js';

function goneHeading(path: string, message: string): string {
  if (path.startsWith('/news/')) return 'This post has been withdrawn.';
  if (path.startsWith('/models/')) return 'This model route has been withdrawn.';
  if (path.startsWith('/careers/')) return 'This role has closed.';
  return message;
}

export async function statusPage(ctx: Ctx, error: ApiError): Promise<Html> {
  const models = await navModels();
  if (error.status === 404 && ctx.path.startsWith('/track/')) {
    return page({
      title: 'This tracking link is not valid',
      nonce: ctx.nonce,
      models,
      body: html`
        <section class="status-page">
          <h1 class="display">This tracking link is not valid.</h1>
          <p>Links stop working when a newer one is sent, and when a role's retention period
          has ended.</p>
          ${resendForm()}
        </section>
      `,
    });
  }
  if (error.status === 404) {
    return page({
      title: 'Nothing is published here',
      nonce: ctx.nonce,
      models,
      body: html`
        <section class="status-page">
          <h1 class="display">Nothing is published here</h1>
          <p><a href="/">Back to the open record</a></p>
        </section>
      `,
    });
  }
  if (error.status === 410) {
    const heading = goneHeading(ctx.path, error.message);
    return page({
      title: heading,
      nonce: ctx.nonce,
      models,
      body: html`
        <section class="status-page">
          <h1 class="display">${heading}</h1>
          <p><a href="/">Back to the open record</a></p>
        </section>
      `,
    });
  }
  return page({
    title: error.message,
    nonce: ctx.nonce,
    models,
    body: html`
      <section class="status-page">
        <h1 class="display">${error.message}</h1>
        <p><a href="/">Back to the open record</a></p>
      </section>
    `,
  });
}
