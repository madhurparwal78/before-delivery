import { html } from '../html.js';
import { htmlReply, type Reply } from '../reply.js';
import type { Ctx } from '../server.js';
import { navModels, page } from './layout.js';
import { resendForm } from './public.js';

type Payload = {
  readonly error?: string;
  readonly message?: string;
  readonly fields?: Record<string, string>;
  readonly application?: { readonly reference?: string };
};

/** The same answer as the API, rendered for a browser that posted the form without scripts. */
export async function candidateFormPage(
  ctx: Ctx,
  reply: Reply,
  context: { readonly email: string; readonly backHref: string; readonly backLabel: string },
): Promise<Reply> {
  const payload = (reply.json ?? {}) as Payload;
  const received = reply.status === 200 || reply.status === 201;
  const heading = received
    ? 'Application received'
    : reply.status === 202
      ? 'Tracking links'
      : 'We could not take that just yet';
  const body = received
    ? html`
        <p>Application received. Your receipt and tracking link are on their way to
        ${context.email}.</p>
        ${payload.application?.reference === undefined
          ? html``
          : html`<p class="meta">Your reference is
              <span class="mono">${payload.application.reference}</span>.</p>`}
      `
    : html`
        <p>${payload.message ?? ''}</p>
        ${payload.fields === undefined
          ? html``
          : html`<ul>
              ${Object.entries(payload.fields).map(
                ([field, message]) => html`<li>${field}: ${message}</li>`,
              )}
            </ul>`}
      `;
  return htmlReply(
    reply.status,
    page({
      title: heading,
      nonce: ctx.nonce,
      models: await navModels(),
      body: html`
        <section class="status-page">
          <h1 class="display">${heading}</h1>
          ${body}
          <p><a href="${context.backHref}">${context.backLabel}</a></p>
          ${reply.status === 202 ? html`` : resendForm()}
        </section>
      `,
    }),
    reply.headers,
  );
}
