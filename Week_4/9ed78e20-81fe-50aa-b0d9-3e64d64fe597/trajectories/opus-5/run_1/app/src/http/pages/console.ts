import { pool } from '../../db/pool.js';
import { verifyChain } from '../../domain/audit.js';
import { DISCIPLINES, OFFICES, REGIONS } from '../../domain/careers.js';
import {
  CONTENT_COLUMNS,
  NEWS_SUBJECTS,
  allBenchmarkRows,
  loadContentById,
  type ContentRow,
} from '../../domain/content.js';
import {
  APPLICATION_STAGES,
  STAGE_LABELS,
  type ApplicationStage,
  type ContentStatus,
} from '../../domain/lifecycle.js';
import { formatLondonDateTime } from '../../domain/london.js';
import { loadReleaseRecord, type ReleaseRecordRow } from '../../domain/releaserecord.js';
import { ROLE_LABELS, STAFF_ROLES, activeGrants, grantStatus } from '../../domain/roles.js';
import { errors } from '../errors.js';
import { html, raw, type Html } from '../html.js';
import { htmlReply, redirectReply, type Reply } from '../reply.js';
import { loadSession, type SignedInStaff } from '../session.js';
import { route, type Ctx } from '../server.js';
import { actionForm, dialogAction, selectField, textField } from './consoleparts.js';
import { page } from './layout.js';

type ConsoleView = {
  readonly staff: SignedInStaff;
  readonly roles: ReadonlySet<string>;
};

async function consolePage(
  ctx: Ctx,
  title: string,
  render: (view: ConsoleView) => Promise<Html>,
): Promise<Reply> {
  const staff = await loadSession(pool, ctx.headers);
  if (staff === null) return redirectReply('/console/sign-in');
  const grants = await activeGrants(pool, staff.email);
  const view: ConsoleView = { staff, roles: new Set(grants.map((grant) => grant.role)) };
  return htmlReply(
    200,
    page({
      title,
      nonce: ctx.nonce,
      console: true,
      bodyClass: 'console',
      body: html`
        <p class="console-whoami">Signed in as ${view.staff.name}
        (${[...view.roles].map((role) => ROLE_LABELS[role as 'editor']).join(', ') || 'no roles'})</p>
        ${await render(view)}
      `,
    }),
  );
}

function statusLabel(status: ContentStatus): string {
  return status.replace('_', ' ');
}

function contentRowLine(item: ContentRow): Html {
  return html`
    <li>
      <a href="/console/content/${item.id}">${item.title}</a>
      <span class="meta">${item.kind} · ${statusLabel(item.status)} ·
      v<span class="mono">${item.version}</span></span>
    </li>
  `;
}

function releasePanel(item: ContentRow, record: ReleaseRecordRow | undefined): Html {
  if (item.kind !== 'model' || record === undefined) return html``;
  return html`
    <section class="panel" aria-label="Release record">
      <h3>Release record</h3>
      <p>Status: <strong>${record.status}</strong></p>
      <p class="meta">Safety: ${record.safety_by ?? 'not recorded'} · Legal:
      ${record.legal_by ?? 'not recorded'} · Cleared by: ${record.cleared_by ?? 'not cleared'}</p>
      ${record.last_validation === null
        ? html``
        : html`
            <ul class="validation">
              ${record.last_validation.map(
                (verdict) => html`<li>${verdict.claim}: ${verdict.ok ? 'ok' : verdict.reason}</li>`,
              )}
            </ul>
          `}
      ${actionForm({
        label: 'Record safety sign-off',
        path: `/api/console/content/${item.id}/release-record/signoffs`,
        success: 'Safety sign-off recorded.',
        submit: 'Record safety sign-off',
        fields: html`<input type="hidden" name="kind" value="safety">
          ${textField({
            id: 'safety-note',
            name: 'note',
            label: 'Safety note',
          })}`,
      })}
      ${actionForm({
        label: 'Record legal sign-off',
        path: `/api/console/content/${item.id}/release-record/signoffs`,
        success: 'Legal sign-off recorded.',
        submit: 'Record legal sign-off',
        fields: html`<input type="hidden" name="kind" value="legal">
          ${textField({ id: 'legal-note', name: 'note', label: 'Legal note' })}`,
      })}
      ${actionForm({
        label: 'Validate claims',
        path: `/api/console/content/${item.id}/release-record/validate-claims`,
        success: 'Claims validated.',
        submit: 'Validate claims',
      })}
      ${actionForm({
        label: 'Clear release record',
        path: `/api/console/content/${item.id}/release-record/clear`,
        success: 'Release record cleared.',
        submit: 'Clear release record',
      })}
    </section>
  `;
}

function editorScreen(
  item: ContentRow,
  comments: readonly { id: string; author: string; body: string; created_at: Date }[],
  record: ReleaseRecordRow | undefined,
): Html {
  return html`
    <div class="console-detail">
      <h2>${item.title}</h2>
      <p class="meta">${item.kind} · ${statusLabel(item.status)} ·
      version <span class="mono">${item.version}</span> · author ${item.author}
      ${item.release_at_local === null
        ? html``
        : html`· release <span class="mono">${item.release_at_local}</span> London`}</p>

      ${actionForm({
        label: 'Save draft',
        path: `/api/console/content/${item.id}`,
        method: 'PATCH',
        success: 'Draft saved.',
        submit: 'Save draft',
        version: item.version,
        fields: html`
          ${textField({ id: 'content-title', name: 'title', label: 'Title', value: item.title })}
          ${textField({ id: 'content-slug', name: 'slug', label: 'Slug', value: item.slug })}
          ${textField({
            id: 'content-summary',
            name: 'summary',
            label: 'Summary',
            value: item.summary,
          })}
          ${textField({
            id: 'content-body',
            name: 'body',
            label: 'Body',
            multiline: true,
            value: item.body,
          })}
          ${item.kind === 'news'
            ? html`
                ${selectField({
                  id: 'content-subject',
                  name: 'subject',
                  label: 'Subject',
                  options: NEWS_SUBJECTS.map((entry) => ({
                    value: entry.value,
                    label: entry.label,
                  })),
                })}
                ${textField({
                  id: 'content-tags',
                  name: 'tags',
                  label: 'Tags',
                  value: (item.tags ?? []).join(', '),
                })}
              `
            : html`
                ${textField({
                  id: 'content-claims',
                  name: 'claims',
                  label: 'Claims',
                  multiline: true,
                  value: JSON.stringify(item.claims ?? [], null, 2),
                })}
                ${textField({
                  id: 'content-linked',
                  name: 'linked_news_slug',
                  label: 'Linked announcement slug',
                  value: item.linked_news_slug ?? '',
                })}
              `}
        `,
      })}

      ${actionForm({
        label: 'Submit for review',
        path: `/api/console/content/${item.id}/submit`,
        success: 'Submitted for review.',
        submit: 'Submit for review',
        version: item.version,
      })}
      ${actionForm({
        label: 'Approve',
        path: `/api/console/content/${item.id}/approve`,
        success: 'Approved.',
        submit: 'Approve',
        version: item.version,
      })}
      ${dialogAction({
        openLabel: 'Return to author',
        dialogLabel: 'Return to author',
        heading: 'Return to author',
        action: {
          label: 'Return to author',
          path: `/api/console/content/${item.id}/return`,
          success: 'Returned to author.',
          submit: 'Return',
          version: item.version,
          fields: textField({ id: 'return-reason', name: 'reason', label: 'Reason' }),
        },
      })}
      ${dialogAction({
        openLabel: 'Schedule release',
        dialogLabel: 'Schedule release',
        heading: 'Schedule release',
        action: {
          label: 'Schedule release',
          path: `/api/console/content/${item.id}/schedule`,
          success: 'Release scheduled for {release} London.',
          submit: 'Confirm schedule',
          version: item.version,
          fields: html`
            ${textField({
              id: 'release-local',
              name: 'release_at_local',
              label: 'Release time (London)',
              placeholder: 'YYYY-MM-DDTHH:mm',
            })}
            <p class="meta" data-local-preview></p>
          `,
        },
      })}
      ${actionForm({
        label: 'Release now',
        path: `/api/console/content/${item.id}/release`,
        success: 'Released.',
        submit: 'Release now',
        version: item.version,
      })}
      ${dialogAction({
        openLabel: 'Withdraw',
        dialogLabel: 'Withdraw this item?',
        heading: 'Withdraw this item?',
        action: {
          label: 'Withdraw this item?',
          path: `/api/console/content/${item.id}/withdraw`,
          success: 'Withdrawn.',
          submit: 'Confirm withdrawal',
          version: item.version,
        },
      })}

      ${releasePanel(item, record)}

      <section class="panel">
        <h3>Comments</h3>
        <ul class="comments">
          ${comments.map(
            (comment) => html`
              <li>
                <p>${comment.body}</p>
                <p class="meta">${comment.author} ·
                <span class="mono">${formatLondonDateTime(comment.created_at)}</span> London</p>
              </li>
            `,
          )}
        </ul>
        ${actionForm({
          label: 'Add comment',
          path: `/api/console/content/${item.id}/comments`,
          success: 'Comment added.',
          submit: 'Add comment',
          fields: textField({
            id: 'comment-body',
            name: 'body',
            label: 'Comment',
            multiline: true,
          }),
        })}
      </section>
    </div>
  `;
}

export function registerConsolePages(): void {
  route(
    'GET',
    '/console/sign-in',
    null,
    async (ctx) =>
      htmlReply(
        200,
        page({
          title: 'Console sign-in',
          nonce: ctx.nonce,
          bodyClass: 'console',
          body: html`
            <section class="sign-in">
              <h1 class="display">Sign in to the console</h1>
              <form data-sign-in-form method="post" action="/api/console/session">
                <p class="field">
                  <label for="sign-in-email">Email</label>
                  <input id="sign-in-email" name="email" type="email" aria-label="Email"
                    autocomplete="username">
                </p>
                <p class="field">
                  <label for="sign-in-password">Password</label>
                  <input id="sign-in-password" name="password" type="password"
                    autocomplete="current-password">
                </p>
                <button type="submit">Sign in</button>
                <span class="status-line" role="status" aria-live="polite"
                  aria-label="Sign-in status" data-sign-in-status></span>
              </form>
            </section>
          `,
        }),
      ),
    { page: true },
  );

  route(
    'GET',
    '/console',
    null,
    async (ctx) =>
      consolePage(ctx, 'Work queue', async (view) => {
        const groups: ContentStatus[] = [];
        if (view.roles.has('editor')) groups.push('draft', 'returned');
        if (view.roles.has('approver')) {
          groups.push('in_review', 'approved', 'scheduled', 'published');
        }
        const items =
          groups.length === 0
            ? []
            : (
                await pool.query<ContentRow>(
                  `SELECT ${CONTENT_COLUMNS} FROM content_items WHERE status = ANY($1::text[])
                    ORDER BY created_at DESC`,
                  [groups],
                )
              ).rows;
        return html`
          <h1 class="display">Work queue</h1>
          ${groups.length === 0
            ? html`<p class="notice">Your current roles do not act on content.</p>`
            : html`
                <p><a href="/console/content/new?kind=model">New model route</a> ·
                <a href="/console/content/new?kind=news">New news post</a></p>
                ${groups.map(
                  (status) => html`
                    <section class="panel">
                      <h2>${statusLabel(status)}</h2>
                      ${items.filter((item) => item.status === status).length === 0
                        ? html`<p class="notice">Nothing here.</p>`
                        : html`<ul class="console-list">
                            ${items
                              .filter((item) => item.status === status)
                              .map((item) => contentRowLine(item))}
                          </ul>`}
                    </section>
                  `,
                )}
              `}
        `;
      }),
    { page: true },
  );

  route(
    'GET',
    '/console/content/new',
    null,
    async (ctx) =>
      consolePage(ctx, 'New item', async () => {
        const kind = ctx.url.searchParams.get('kind') === 'news' ? 'news' : 'model';
        return html`
          <h1 class="display">New ${kind === 'news' ? 'news post' : 'model route'}</h1>
          ${actionForm({
            label: 'Save draft',
            path: '/api/console/content',
            success: 'Draft saved.',
            submit: 'Save draft',
            fields: html`
              <input type="hidden" name="kind" value="${kind}">
              ${textField({ id: 'new-title', name: 'title', label: 'Title' })}
              ${textField({ id: 'new-slug', name: 'slug', label: 'Slug' })}
              ${textField({ id: 'new-summary', name: 'summary', label: 'Summary' })}
              ${textField({ id: 'new-body', name: 'body', label: 'Body', multiline: true })}
              ${kind === 'news'
                ? html`
                    ${selectField({
                      id: 'new-subject',
                      name: 'subject',
                      label: 'Subject',
                      options: NEWS_SUBJECTS.map((entry) => ({
                        value: entry.value,
                        label: entry.label,
                      })),
                    })}
                    ${textField({ id: 'new-tags', name: 'tags', label: 'Tags' })}
                  `
                : html`
                    ${textField({
                      id: 'new-claims',
                      name: 'claims',
                      label: 'Claims',
                      multiline: true,
                      value: '[]',
                    })}
                    ${textField({
                      id: 'new-linked',
                      name: 'linked_news_slug',
                      label: 'Linked announcement slug',
                    })}
                  `}
            `,
          })}
        `;
      }),
    { page: true },
  );

  route(
    'GET',
    '/console/content/:id',
    null,
    async (ctx) =>
      consolePage(ctx, 'Editor', async () => {
        const item = await loadContentById(pool, ctx.params.id as string);
        if (item === undefined) throw errors.consoleNotFound();
        const comments = await pool.query<{
          id: string;
          author: string;
          body: string;
          created_at: Date;
        }>(
          `SELECT id, author, body, created_at FROM content_comments
            WHERE content_id = $1 ORDER BY created_at`,
          [item.id],
        );
        const record = item.kind === 'model' ? await loadReleaseRecord(pool, item.id) : undefined;
        return editorScreen(item, comments.rows, record);
      }),
    { page: true },
  );

  route(
    'GET',
    '/console/rows',
    null,
    async (ctx) =>
      consolePage(ctx, 'Benchmark rows', async () => {
        const rows = await allBenchmarkRows(pool);
        return html`
          <h1 class="display">Benchmark rows</h1>
          <table class="record-table" aria-label="Benchmark rows">
            <thead>
              <tr>
                <th scope="col">Subject</th>
                <th scope="col">Benchmark</th>
                <th scope="col">Evaluation date</th>
                <th scope="col">Score</th>
                <th scope="col">Source note</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(
                (row) => html`
                  <tr>
                    <td data-label="Subject">${row.subject}</td>
                    <td data-label="Benchmark">${row.benchmark}</td>
                    <td data-label="Evaluation date" class="mono">${row.eval_date}</td>
                    <td data-label="Score" class="mono">${row.score_text}</td>
                    <td data-label="Source note">${row.source_note}</td>
                  </tr>
                `,
              )}
            </tbody>
          </table>
          ${actionForm({
            label: 'Record a benchmark row',
            path: '/api/console/benchmark-rows',
            success: 'Row recorded.',
            submit: 'Record row',
            fields: html`
              ${textField({ id: 'row-subject', name: 'subject', label: 'Subject' })}
              ${textField({ id: 'row-benchmark', name: 'benchmark', label: 'Benchmark' })}
              ${textField({
                id: 'row-date',
                name: 'eval_date',
                label: 'Evaluation date',
                placeholder: 'YYYY-MM-DD',
              })}
              ${textField({ id: 'row-score', name: 'score', label: 'Score' })}
              ${textField({ id: 'row-note', name: 'source_note', label: 'Source note' })}
            `,
          })}
        `;
      }),
    { page: true },
  );

  route(
    'GET',
    '/console/requisitions',
    null,
    async (ctx) =>
      consolePage(ctx, 'Requisitions', async (view) => {
        const result = await pool.query<{
          id: string;
          slug: string;
          title: string;
          status: string;
          discipline: string;
          office: string;
          version: number;
        }>(
          `SELECT id, slug, title, status, discipline, office, version FROM requisitions
            WHERE $1 = ANY(recruiters) ORDER BY created_at DESC`,
          [view.staff.email],
        );
        return html`
          <h1 class="display">Requisitions</h1>
          <ul class="console-list">
            ${result.rows.map(
              (requisition) => html`
                <li>
                  <a href="/console/requisitions/${requisition.id}">${requisition.title}</a>
                  <span class="meta">${requisition.status} · ${requisition.discipline} ·
                  ${requisition.office}</span>
                </li>
              `,
            )}
          </ul>
          ${actionForm({
            label: 'Create a requisition',
            path: '/api/console/requisitions',
            success: 'Requisition created.',
            submit: 'Create requisition',
            fields: html`
              ${textField({ id: 'req-title', name: 'title', label: 'Title' })}
              ${textField({ id: 'req-slug', name: 'slug', label: 'Slug' })}
              ${selectField({
                id: 'req-discipline',
                name: 'discipline',
                label: 'Discipline',
                options: DISCIPLINES.map((entry) => ({
                  value: entry.value,
                  label: entry.label,
                })),
              })}
              ${selectField({
                id: 'req-office',
                name: 'office',
                label: 'Office',
                options: OFFICES.map((entry) => ({ value: entry.value, label: entry.label })),
              })}
              ${textField({
                id: 'req-description',
                name: 'description',
                label: 'Description',
                multiline: true,
              })}
            `,
          })}
        `;
      }),
    { page: true },
  );

  route(
    'GET',
    '/console/requisitions/:id',
    null,
    async (ctx) =>
      consolePage(ctx, 'Requisition', async (view) => {
        const result = await pool.query<{
          id: string;
          slug: string;
          title: string;
          status: string;
          discipline: string;
          office: string;
          description: string;
          recruiters: string[];
          version: number;
        }>(
          `SELECT id, slug, title, status, discipline, office, description, recruiters, version
             FROM requisitions WHERE id = $1`,
          [ctx.params.id as string],
        );
        const requisition = result.rows[0];
        if (requisition === undefined || !requisition.recruiters.includes(view.staff.email)) {
          throw errors.consoleNotFound();
        }
        const applications = await pool.query<{
          id: string;
          reference: string;
          name: string;
          stage: ApplicationStage;
          version: number;
        }>(
          `SELECT id, reference, name, stage, version FROM applications
            WHERE requisition_id = $1 ORDER BY submitted_at`,
          [requisition.id],
        );
        return html`
          <h1 class="display">${requisition.title}</h1>
          <p class="meta">${requisition.status} · ${requisition.discipline} ·
          ${requisition.office} · version <span class="mono">${requisition.version}</span></p>
          <p>${requisition.description}</p>
          ${actionForm({
            label: 'Open requisition',
            path: `/api/console/requisitions/${requisition.id}/open`,
            success: 'Requisition opened.',
            submit: 'Open requisition',
            version: requisition.version,
          })}
          ${dialogAction({
            openLabel: 'Close requisition',
            dialogLabel: 'Close requisition',
            heading: 'Close requisition',
            action: {
              label: 'Close requisition',
              path: `/api/console/requisitions/${requisition.id}/close`,
              success: 'Requisition closed.',
              submit: 'Close requisition',
              version: requisition.version,
              fields: textField({ id: 'close-reason', name: 'reason', label: 'Reason' }),
            },
          })}
          ${APPLICATION_STAGES.map(
            (stage) => html`
              <section class="panel">
                <h2>${STAGE_LABELS[stage]}</h2>
                ${applications.rows.filter((application) => application.stage === stage).length === 0
                  ? html`<p class="notice">No applications at this stage.</p>`
                  : html`<ul class="console-list">
                      ${applications.rows
                        .filter((application) => application.stage === stage)
                        .map(
                          (application) => html`
                            <li>
                              <a href="/console/applications/${application.id}"
                                >${application.name}</a>
                              <span class="meta mono">${application.reference}</span>
                            </li>
                          `,
                        )}
                    </ul>`}
              </section>
            `,
          )}
        `;
      }),
    { page: true },
  );

  route(
    'GET',
    '/console/applications/:id',
    null,
    async (ctx) =>
      consolePage(ctx, 'Application', async (view) => {
        const id = ctx.params.id as string;
        const result = await pool.query<{
          id: string;
          reference: string;
          name: string;
          email: string;
          stage: ApplicationStage;
          version: number;
          submitted_at: Date;
          recruiters: string[];
          title: string;
        }>(
          `SELECT a.id, a.reference, a.name, a.email, a.stage, a.version, a.submitted_at,
                  r.recruiters, r.title
             FROM applications a JOIN requisitions r ON r.id = a.requisition_id
            WHERE a.id = $1`,
          [id],
        );
        const application = result.rows[0];
        if (application === undefined || !application.recruiters.includes(view.staff.email)) {
          throw errors.consoleNotFound();
        }
        const decisions = await pool.query<{
          from_stage: string;
          to_stage: string;
          rationale: string;
          actor: string;
          at: Date;
        }>(
          `SELECT from_stage, to_stage, rationale, actor, at FROM stage_decisions
            WHERE application_id = $1 ORDER BY at`,
          [id],
        );
        const notes = await pool.query<{ id: string; body: string; author: string; at: Date }>(
          `SELECT id, body, author, at FROM application_notes WHERE application_id = $1
            ORDER BY at`,
          [id],
        );
        return html`
          <h1 class="display">${application.name}</h1>
          <p class="meta mono">${application.reference}</p>
          <p class="meta">${application.title} · ${STAGE_LABELS[application.stage]} ·
          version <span class="mono">${application.version}</span></p>
          <p><a href="/api/console/applications/${id}/resume">Download résumé</a></p>
          ${actionForm({
            label: 'Record decision',
            path: `/api/console/applications/${id}/stage`,
            success: 'Decision recorded. The candidate will be told the new stage by email.',
            submit: 'Record decision',
            version: application.version,
            fields: html`
              ${selectField({
                id: 'stage-to',
                name: 'to',
                label: 'Move to stage',
                options: APPLICATION_STAGES.map((stage) => ({
                  value: stage,
                  label: STAGE_LABELS[stage],
                })),
              })}
              ${textField({
                id: 'stage-rationale',
                name: 'rationale',
                label: 'Decision rationale',
                multiline: true,
              })}
            `,
          })}
          ${actionForm({
            label: 'Add note',
            path: `/api/console/applications/${id}/notes`,
            success: 'Note added.',
            submit: 'Add note',
            fields: textField({
              id: 'note-body',
              name: 'body',
              label: 'Interview note',
              multiline: true,
            }),
          })}
          ${actionForm({
            label: 'Reissue tracking link',
            path: `/api/console/applications/${id}/tracking-link/reissue`,
            success: 'A new tracking link is on its way to the candidate.',
            submit: 'Reissue tracking link',
          })}
          <section class="panel">
            <h2>Decisions</h2>
            <ul class="console-list">
              ${decisions.rows.map(
                (decision) => html`
                  <li>${decision.from_stage} → ${decision.to_stage}
                    <span class="meta">${decision.rationale} · ${decision.actor} ·
                    <span class="mono">${formatLondonDateTime(decision.at)}</span> London</span>
                  </li>
                `,
              )}
            </ul>
          </section>
          <section class="panel">
            <h2>Notes</h2>
            <ul class="console-list">
              ${notes.rows.map(
                (note) => html`
                  <li>${note.body}
                    <span class="meta">${note.author} ·
                    <span class="mono">${formatLondonDateTime(note.at)}</span> London</span>
                  </li>
                `,
              )}
            </ul>
          </section>
        `;
      }),
    { page: true },
  );

  route(
    'GET',
    '/console/benefits',
    null,
    async (ctx) =>
      consolePage(ctx, 'Benefits', async () => {
        const entries = await pool.query<{
          id: string;
          region: string;
          effective_from: string;
          summary: string;
        }>(
          `SELECT id, region, effective_from::text AS effective_from, summary
             FROM benefits_entries ORDER BY region, effective_from DESC`,
        );
        return html`
          <h1 class="display">Benefits register</h1>
          <table class="record-table" aria-label="Benefits entries">
            <thead>
              <tr>
                <th scope="col">Region</th>
                <th scope="col">Effective from</th>
                <th scope="col">Summary</th>
              </tr>
            </thead>
            <tbody>
              ${entries.rows.map(
                (entry) => html`
                  <tr>
                    <td data-label="Region">${entry.region}</td>
                    <td data-label="Effective from" class="mono">${entry.effective_from}</td>
                    <td data-label="Summary">${entry.summary}</td>
                  </tr>
                `,
              )}
            </tbody>
          </table>
          ${actionForm({
            label: 'Record a benefits entry',
            path: '/api/console/benefits',
            success: 'Benefits entry recorded.',
            submit: 'Record benefits entry',
            fields: html`
              ${selectField({
                id: 'benefits-region',
                name: 'region',
                label: 'Region',
                options: REGIONS.map((entry) => ({ value: entry.value, label: entry.label })),
              })}
              ${textField({
                id: 'benefits-from',
                name: 'effective_from',
                label: 'Effective from',
                placeholder: 'YYYY-MM-DD',
              })}
              ${textField({
                id: 'benefits-summary',
                name: 'summary',
                label: 'Summary',
                multiline: true,
              })}
            `,
          })}
        `;
      }),
    { page: true },
  );

  route(
    'GET',
    '/console/grants',
    null,
    async (ctx) =>
      consolePage(ctx, 'Grants', async (view) => {
        if (!view.roles.has('administrator')) {
          return html`<p class="notice">Your current roles do not allow this.</p>`;
        }
        const grants = await pool.query<{
          id: string;
          staff_email: string;
          role: 'editor';
          granted_by: string;
          granted_at: Date;
          expires_at: Date;
          revoked_at: Date | null;
          version: number;
        }>(
          `SELECT id, staff_email, role, granted_by, granted_at, expires_at, revoked_at, version
             FROM role_grants ORDER BY granted_at DESC`,
        );
        return html`
          <h1 class="display">Role grants</h1>
          ${actionForm({
            label: 'Grant a role',
            path: '/api/console/grants',
            success: 'Role granted.',
            submit: 'Grant role',
            fields: html`
              ${textField({ id: 'grant-email', name: 'staff_email', label: 'Staff email' })}
              ${selectField({
                id: 'grant-role',
                name: 'role',
                label: 'Role',
                options: STAFF_ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] })),
              })}
              ${textField({
                id: 'grant-expires',
                name: 'expires_at',
                label: 'Expires (London)',
                placeholder: 'YYYY-MM-DDTHH:mm',
              })}
              <p class="meta" data-local-preview></p>
            `,
          })}
          <table class="record-table" aria-label="Grants">
            <thead>
              <tr>
                <th scope="col">Staff</th>
                <th scope="col">Role</th>
                <th scope="col">Granted by</th>
                <th scope="col">Expires</th>
                <th scope="col">Status</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              ${grants.rows.map((grant) => {
                const status = grantStatus(grant);
                return html`
                  <tr>
                    <td data-label="Staff">${grant.staff_email}</td>
                    <td data-label="Role">${ROLE_LABELS[grant.role]}</td>
                    <td data-label="Granted by">${grant.granted_by}</td>
                    <td data-label="Expires" class="mono"
                      >${formatLondonDateTime(grant.expires_at)}</td>
                    <td data-label="Status">${status}</td>
                    <td data-label="Action">
                      ${status === 'active'
                        ? actionForm({
                            label: `Revoke ${grant.role} for ${grant.staff_email}`,
                            path: `/api/console/grants/${grant.id}/revoke`,
                            success: 'Role revoked.',
                            submit: `Revoke ${grant.role} for ${grant.staff_email}`,
                            version: grant.version,
                          })
                        : html``}
                    </td>
                  </tr>
                `;
              })}
            </tbody>
          </table>
        `;
      }),
    { page: true },
  );

  route(
    'GET',
    '/console/audit',
    null,
    async (ctx) =>
      consolePage(ctx, 'Audit record', async (view) => {
        if (!view.roles.has('administrator')) {
          return html`<p class="notice">Your current roles do not allow this.</p>`;
        }
        const beforeRaw = ctx.url.searchParams.get('before_seq');
        const beforeSeq = beforeRaw === null ? null : Number.parseInt(beforeRaw, 10);
        const entries = await pool.query<{
          seq: number;
          at: Date;
          actor: string;
          action: string;
          target_type: string;
          target_id: string;
          detail: unknown;
          prev_hash: string;
          hash: string;
        }>(
          `SELECT seq, at, actor, action, target_type, target_id, detail, prev_hash, hash
             FROM audit_entries
            WHERE ($1::bigint IS NULL OR seq < $1::bigint)
            ORDER BY seq DESC LIMIT 50`,
          [beforeSeq !== null && Number.isFinite(beforeSeq) ? beforeSeq : null],
        );
        const oldest = entries.rows[entries.rows.length - 1];
        const all = await pool.query<{
          seq: number;
          at: Date;
          actor: string;
          action: string;
          target_type: string;
          target_id: string;
          detail: Record<string, unknown>;
          prev_hash: string;
          hash: string;
        }>(
          `SELECT seq, at, actor, action, target_type, target_id, detail, prev_hash, hash
             FROM audit_entries ORDER BY seq`,
        );
        const report = verifyChain(
          all.rows.map((row) => ({ ...row, at: row.at.toISOString() })),
        );
        return html`
          <h1 class="display">Audit record</h1>
          <p class="meta">${report.valid
            ? html`Chain verified: <span class="mono">${report.entries}</span> entries.`
            : html`Chain broken at entry <span class="mono">${report.first_invalid_seq}</span>.`}</p>
          <form data-verify-chain>
            <button type="submit">Verify chain</button>
            <span class="status-line" role="status" aria-live="polite" data-verify-status></span>
          </form>
          <table class="record-table" aria-label="Audit record">
            <thead>
              <tr>
                <th scope="col">Seq</th>
                <th scope="col">When</th>
                <th scope="col">Actor</th>
                <th scope="col">Action</th>
                <th scope="col">Target</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              ${entries.rows.map(
                (entry) => html`
                  <tr>
                    <td data-label="Seq" class="mono">${entry.seq}</td>
                    <td data-label="When" class="mono">${formatLondonDateTime(entry.at)}</td>
                    <td data-label="Actor">${entry.actor}</td>
                    <td data-label="Action">${entry.action}</td>
                    <td data-label="Target">${entry.target_type} ${entry.target_id}</td>
                    <td data-label="Detail" class="detail">${JSON.stringify(entry.detail)}</td>
                  </tr>
                `,
              )}
            </tbody>
          </table>
          ${oldest === undefined || oldest.seq <= 1
            ? html``
            : html`<p><a href="/console/audit?before_seq=${oldest.seq}">Older entries</a></p>`}
        `;
      }),
    { page: true },
  );

  route(
    'GET',
    '/console/jobs',
    null,
    async (ctx) =>
      consolePage(ctx, 'Jobs', async (view) => {
        if (!view.roles.has('administrator')) {
          return html`<p class="notice">Your current roles do not allow this.</p>`;
        }
        const state = ctx.url.searchParams.get('state');
        const jobs = await pool.query<{
          id: string;
          kind: string;
          state: string;
          attempts: number;
          refusals: number;
          last_error: string | null;
          next_attempt_at: Date;
        }>(
          `SELECT id, kind, state, attempts, refusals, last_error, next_attempt_at FROM jobs
            WHERE ($1::text IS NULL OR state = $1::text)
            ORDER BY created_at DESC LIMIT 200`,
          [state === 'pending' || state === 'dead' || state === 'done' ? state : null],
        );
        return html`
          <h1 class="display">Background jobs</h1>
          <nav aria-label="Job states">
            <ul class="inline-list">
              <li><a href="/console/jobs?state=pending"
                ${raw(state === 'pending' ? 'aria-current="true"' : '')}>Pending</a></li>
              <li><a href="/console/jobs?state=dead"
                ${raw(state === 'dead' ? 'aria-current="true"' : '')}>Dead</a></li>
              <li><a href="/console/jobs?state=done"
                ${raw(state === 'done' ? 'aria-current="true"' : '')}>Done</a></li>
            </ul>
          </nav>
          ${jobs.rows.length === 0
            ? html`<p class="notice">No jobs in this state.</p>`
            : html`
                <table class="record-table" aria-label="Jobs">
                  <thead>
                    <tr>
                      <th scope="col">Kind</th>
                      <th scope="col">State</th>
                      <th scope="col">Attempts</th>
                      <th scope="col">Last error</th>
                      <th scope="col">Next attempt</th>
                      <th scope="col">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${jobs.rows.map(
                      (job) => html`
                        <tr>
                          <td data-label="Kind">${job.kind}</td>
                          <td data-label="State">${job.state}</td>
                          <td data-label="Attempts" class="mono">${job.attempts}</td>
                          <td data-label="Last error">${job.last_error ?? '—'}</td>
                          <td data-label="Next attempt" class="mono"
                            >${formatLondonDateTime(job.next_attempt_at)}</td>
                          <td data-label="Action">
                            ${job.state === 'dead'
                              ? actionForm({
                                  label: `Retry job ${job.id}`,
                                  path: `/api/console/jobs/${job.id}/retry`,
                                  success: 'Job queued for retry.',
                                  submit: `Retry job ${job.id}`,
                                })
                              : html``}
                          </td>
                        </tr>
                      `,
                    )}
                  </tbody>
                </table>
              `}
        `;
      }),
    { page: true },
  );
}
