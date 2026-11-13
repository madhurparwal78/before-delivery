/**
 * The screens. Every address below, reloaded cold or opened in a fresh browser, shows the
 * same screen in the same state, because each one is rendered from the records on request.
 */

import * as catalogue from '../db/catalogue';
import * as claims from '../db/claims';
import * as copy from '../shared/copy';
import { bilingual, bilingualLabel, h, pick, text } from '../shared/html';
import { CONTROL_NAMES, PAGE_HEADINGS } from '../shared/copy';
import { isReference, normaliseReference } from '../domain/references';
import { renderFan } from '../shared/fan-view';
import { renderOperatorSlip, renderShareSlip } from './slip';
import { icon } from './icons';
import { renderShell } from './shell';
import { shareRecord } from '../api/routes';
import type { Language } from '../shared/format';
import type { Reply, RequestContext, Route } from '../http/router';
import type { ClaimStanding } from '../domain/state';

function page(body: string, context: RequestContext, title: string, pageData?: Record<string, unknown>): Reply {
  return {
    status: 200,
    body: renderShell({
      title,
      language: context.language,
      audience: context.audience,
      body,
      pageData,
    }),
  };
}

function heading(pair: { 'en-GB': string; 'pl-PL': string }, language: Language): string {
  return h('h1', { class: 'page-heading', ...bilingual(pair) }, text(pick(pair, language)));
}

function field(
  id: string,
  label: { 'en-GB': string; 'pl-PL': string },
  language: Language,
  control: string,
): string {
  return h(
    'div',
    { class: 'form-field' },
    h('label', { for: id, ...bilingual(label) }, text(pick(label, language))),
    control,
    h('p', { class: 'field-error', 'data-field-error': id }),
  );
}

/* ------------------------------------------------------------------------ owner pages */

const ownerPages: Route[] = [
  {
    method: 'GET',
    pattern: '/',
    audience: 'owner',
    handler: async (context) =>
      page(
        h(
          'section',
          { class: 'home' },
          heading(PAGE_HEADINGS.home, context.language),
          h(
            'p',
            {
              class: 'home-explanation',
              ...bilingual({
                'en-GB': 'Holmgarth Aftercare finds, prices and posts replacement numbered parts for flat-pack furniture.',
                'pl-PL': 'Holmgarth Aftercare znajduje, wycenia i wysyła zamienne części do mebli do samodzielnego montażu.',
              }),
            },
            text(
              context.language === 'en-GB'
                ? 'Holmgarth Aftercare finds, prices and posts replacement numbered parts for flat-pack furniture.'
                : 'Holmgarth Aftercare znajduje, wycenia i wysyła zamienne części do mebli do samodzielnego montażu.',
            ),
          ),
          h(
            'nav',
            { class: 'home-links' },
            h(
              'a',
              { href: '/claim/new', class: 'button-link' },
              icon('wrench'),
              h('span', bilingual(CONTROL_NAMES.startAClaim), text(pick(CONTROL_NAMES.startAClaim, context.language))),
            ),
            h(
              'a',
              { href: '/find', class: 'button-link' },
              icon('package-search'),
              h('span', bilingual(CONTROL_NAMES.findMyClaim), text(pick(CONTROL_NAMES.findMyClaim, context.language))),
            ),
          ),
        ),
        context,
        'Holmgarth Aftercare',
      ),
  },

  {
    method: 'GET',
    pattern: '/claim/new',
    audience: 'owner',
    handler: async (context) => {
      const models = await catalogue.listModels();
      const chosen = models[0] ?? null;
      const parts = chosen === null ? [] : await catalogue.listParts(chosen.slug);
      const language = context.language;

      const form = h(
        'form',
        { class: 'claim-form', id: 'claim-form', novalidate: true },
        field(
          'model',
          CONTROL_NAMES.model,
          language,
          h(
            'select',
            { id: 'model', name: 'model', class: 'form-control' },
            ...models.map((model) => h('option', { value: model.slug }, text(model.name))),
          ),
        ),
        h('div', { class: 'selected-part', id: 'selected-part' }),
        field('name', CONTROL_NAMES.yourName, language, h('input', { id: 'name', name: 'name', type: 'text', class: 'form-control' })),
        field('email', CONTROL_NAMES.email, language, h('input', { id: 'email', name: 'email', type: 'email', class: 'form-control' })),
        field('postcode', CONTROL_NAMES.postcode, language, h('input', { id: 'postcode', name: 'postcode', type: 'text', class: 'form-control' })),
        // The date field takes no earliest or latest date from the device clock.
        field('purchase_date', CONTROL_NAMES.purchaseDate, language, h('input', { id: 'purchase_date', name: 'purchase_date', type: 'date', class: 'form-control' })),
        field('quantity', CONTROL_NAMES.quantity, language, h('input', { id: 'quantity', name: 'quantity', type: 'number', min: 1, max: 20, value: 1, class: 'form-control' })),
        field('description', CONTROL_NAMES.whatHappened, language, h('textarea', { id: 'description', name: 'description', rows: 4, class: 'form-control' })),
        field('photos', CONTROL_NAMES.damagePhotos, language, h('input', { id: 'photos', name: 'photos', type: 'file', multiple: true, class: 'form-control' })),
        h(
          'section',
          {
            role: 'region',
            class: 'estimate-region',
            'aria-label': pick(CONTROL_NAMES.carriageEstimate, language),
            ...bilingualLabel(CONTROL_NAMES.carriageEstimate),
          },
          h(
            'button',
            { type: 'button', id: 'estimate-carriage', class: 'secondary-action', ...bilingual(CONTROL_NAMES.estimateCarriage) },
            text(pick(CONTROL_NAMES.estimateCarriage, language)),
          ),
          h('p', { class: 'estimate-value', id: 'estimate-value' }),
        ),
        h(
          'button',
          { type: 'submit', id: 'start-claim', class: 'primary-action', ...bilingual(CONTROL_NAMES.startClaim) },
          text(pick(CONTROL_NAMES.startClaim, language)),
        ),
      );

      return page(
        h(
          'section',
          { class: 'claim-page' },
          heading(PAGE_HEADINGS.claimForm, language),
          h(
            'div',
            { class: 'claim-layout' },
            renderFan({ parts, axis: chosen?.axis ?? null, language, selected: null, value: 0, readOnly: false }),
            form,
          ),
        ),
        context,
        'Claim a part',
      );
    },
  },

  {
    method: 'GET',
    pattern: '/claim/:reference/sent',
    audience: 'owner',
    handler: async (context) => {
      const reference = normaliseReference(context.params['reference'] ?? '');
      const language = context.language;
      const sentText = {
        'en-GB': copy.sentPageText(reference, 'en-GB'),
        'pl-PL': copy.sentPageText(reference, 'pl-PL'),
      };

      return page(
        h(
          'section',
          { class: 'sent-page', 'data-reference': reference },
          heading(PAGE_HEADINGS.sent, language),
          h('p', { class: 'sent-text', ...bilingual(sentText) }, text(pick(sentText, language))),
          // The link-lifetime line is filled in from the server's confirmation status.
          h('p', { class: 'link-lifetime', id: 'link-lifetime' }),
        ),
        context,
        'Check your email',
        { sentReference: reference },
      );
    },
  },

  {
    method: 'GET',
    pattern: '/confirm/:token',
    audience: 'owner',
    handler: async (context) => {
      const language = context.language;
      return page(
        h(
          'section',
          { class: 'confirm-page' },
          heading(PAGE_HEADINGS.confirmation, language),
          h(
            'button',
            { type: 'button', id: 'confirm-claim', class: 'primary-action', ...bilingual(CONTROL_NAMES.confirmMyClaim) },
            text(pick(CONTROL_NAMES.confirmMyClaim, language)),
          ),
        ),
        context,
        'Confirm your claim',
        { confirmToken: context.params['token'] ?? '' },
      );
    },
  },

  {
    method: 'GET',
    pattern: '/s/:token',
    audience: 'owner',
    handler: async (context) => {
      const token = context.params['token'] ?? '';
      const record = await shareRecord(token);
      const language = record.claim.language ?? context.language;
      const part =
        record.claim.model_slug === null || record.claim.booklet_number === null
          ? null
          : await catalogue.findPart(record.claim.model_slug, record.claim.booklet_number);
      const parts = record.claim.model_slug === null ? [] : await catalogue.listParts(record.claim.model_slug);
      const model = record.claim.model_slug === null ? null : await catalogue.findModel(record.claim.model_slug);
      const headingPair = {
        'en-GB': copy.sharePageHeading(record.claim.reference, 'en-GB'),
        'pl-PL': copy.sharePageHeading(record.claim.reference, 'pl-PL'),
      };

      return page(
        h(
          'section',
          { class: 'share-page', 'data-share-token': token },
          heading(headingPair, language),
          h(
            'div',
            { class: 'share-layout' },
            // The fan shows the claimed part selected and the owner cannot change it.
            renderFan({
              parts,
              axis: model?.axis ?? null,
              language,
              selected: part?.bookletNumber ?? null,
              value: part === null ? 0 : 100,
              readOnly: true,
            }),
            renderShareSlip({ record, part, language }),
          ),
        ),
        { ...context, language },
        `Claim ${record.claim.reference}`,
        { shareToken: token },
      );
    },
  },

  {
    method: 'GET',
    pattern: '/find',
    audience: 'owner',
    handler: async (context) => {
      const language = context.language;
      return page(
        h(
          'section',
          { class: 'find-page' },
          heading(PAGE_HEADINGS.find, language),
          h(
            'form',
            { class: 'find-form', id: 'find-form', novalidate: true },
            field('reference', CONTROL_NAMES.claimReference, language, h('input', { id: 'reference', name: 'reference', type: 'text', class: 'form-control' })),
            field('email', CONTROL_NAMES.email, language, h('input', { id: 'email', name: 'email', type: 'email', class: 'form-control' })),
            h(
              'button',
              { type: 'submit', id: 'find-claim', class: 'primary-action', ...bilingual(CONTROL_NAMES.findClaim) },
              text(pick(CONTROL_NAMES.findClaim, language)),
            ),
          ),
        ),
        context,
        'Find my claim',
      );
    },
  },
];

/* --------------------------------------------------------------------- operator pages */

function toQueue(): Reply {
  return { status: 302, headers: { location: '/ops/claims' }, body: '' };
}

function queueTable(entries: readonly claims.QueueEntry[]): string {
  return h(
    'div',
    { role: 'region', class: 'table-region', 'aria-label': 'Claims' },
    h(
      'table',
      { class: 'claims-table', 'aria-label': 'Claims' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Reference'), h('th', {}, 'State'), h('th', {}, 'Model'), h('th', {}, 'Confirmed'))),
      h(
        'tbody',
        {},
        ...entries.map((entry) =>
          h(
            'tr',
            {},
            h('td', { class: 'mono' }, h('a', { href: `/ops/claims/${entry.reference}` }, text(entry.reference))),
            h('td', {}, text(copy.stateName(entry.state, 'en-GB'))),
            h('td', {}, text(entry.modelName ?? '')),
            h('td', { class: 'mono' }, text(entry.confirmedAt === null ? '' : entry.confirmedAt.toISOString())),
          ),
        ),
      ),
    ),
  );
}

const operatorPages: Route[] = [
  {
    method: 'GET',
    pattern: '/ops/sign-in',
    audience: 'operator',
    handler: async (context) =>
      page(
        h(
          'section',
          { class: 'sign-in-page' },
          h('h1', { class: 'page-heading' }, 'Sign in'),
          h(
            'form',
            { class: 'sign-in-form', id: 'sign-in-form', novalidate: true },
            h(
              'div',
              { class: 'form-field' },
              h('label', { for: 'ops-email' }, 'Email'),
              h('input', { id: 'ops-email', type: 'email', class: 'form-control' }),
            ),
            h(
              'div',
              { class: 'form-field' },
              h('label', { for: 'ops-password' }, 'Password'),
              h('input', { id: 'ops-password', type: 'password', class: 'form-control' }),
            ),
            h('button', { type: 'submit', id: 'sign-in', class: 'primary-action' }, 'Sign in'),
          ),
        ),
        context,
        'Sign in',
      ),
  },

  {
    method: 'GET',
    pattern: '/ops/claims',
    audience: 'operator',
    session: true,
    signInRedirect: true,
    handler: async (context) => {
      const entries = await claims.listQueue(null);
      const counts = await catalogue.decidedCounts();
      return page(
        h(
          'section',
          { class: 'queue-page' },
          h('h1', { class: 'page-heading' }, 'Claim queue'),
          h(
            'div',
            { role: 'status', class: 'decided-count', 'aria-label': 'Decided claims' },
            text(copy.decidedCount(counts.decidedClaims, counts.decidedInside, counts.decidedOutside)),
          ),
          queueTable(entries),
        ),
        context,
        'Claim queue',
      );
    },
  },

  {
    method: 'GET',
    pattern: '/ops/imports',
    audience: 'operator',
    session: true,
    signInRedirect: true,
    handler: async (context) =>
      page(
        h(
          'section',
          { class: 'imports-page' },
          h('h1', { class: 'page-heading' }, 'Supplier parts file'),
          h(
            'div',
            { class: 'form-field' },
            h('label', { for: 'supplier-file' }, 'Supplier parts file'),
            h('input', { id: 'supplier-file', type: 'file', class: 'form-control' }),
          ),
          h('button', { type: 'button', id: 'import-file', class: 'primary-action' }, 'Import file'),
          h(
            'div',
            { role: 'region', class: 'table-region', 'aria-label': 'Unmatched rows' },
            h(
              'table',
              { class: 'unmatched-table', 'aria-label': 'Unmatched rows' },
              h('thead', {}, h('tr', {}, h('th', {}, 'Line'), h('th', {}, 'Reason'))),
              h('tbody', { id: 'unmatched-rows' }),
            ),
          ),
        ),
        context,
        'Imports',
      ),
  },

  {
    method: 'GET',
    pattern: '/ops/editions',
    audience: 'operator',
    session: true,
    signInRedirect: true,
    handler: async (context) => {
      const editions = await catalogue.listEditions();
      const numberField = (id: string, label: string, value: number): string =>
        h(
          'div',
          { class: 'form-field' },
          h('label', { for: id }, label),
          h('input', { id, type: 'number', min: 0, value, class: 'form-control' }),
          h('p', { class: 'field-error', 'data-field-error': id }),
        );

      return page(
        h(
          'section',
          { class: 'editions-page' },
          h('h1', { class: 'page-heading' }, 'Aftercare editions'),
          h(
            'form',
            { class: 'edition-form', id: 'edition-form', novalidate: true },
            h(
              'div',
              { class: 'form-field' },
              h('label', { for: 'edition-code' }, 'Edition code'),
              h('input', { id: 'edition-code', type: 'text', class: 'form-control' }),
              h('p', { class: 'field-error', 'data-field-error': 'edition-code' }),
            ),
            h(
              'div',
              { class: 'form-field' },
              h('label', { for: 'edition-title' }, 'Title'),
              h('input', { id: 'edition-title', type: 'text', class: 'form-control' }),
              h('p', { class: 'field-error', 'data-field-error': 'edition-title' }),
            ),
            h(
              'div',
              { class: 'form-field' },
              h('label', { for: 'edition-starts-on' }, 'Starts on'),
              h('input', { id: 'edition-starts-on', type: 'date', class: 'form-control' }),
              h('p', { class: 'field-error', 'data-field-error': 'edition-starts-on' }),
            ),
            numberField('edition-standard-months', 'Standard months', 24),
            numberField('edition-club-months', 'Club months', 36),
            numberField('edition-owner-contribution-percent', 'Owner contribution percent', 25),
            h('button', { type: 'submit', id: 'save-edition', class: 'primary-action' }, 'Save edition'),
          ),
          h(
            'div',
            { role: 'region', class: 'table-region', 'aria-label': 'Editions' },
            h(
              'table',
              { class: 'editions-table', 'aria-label': 'Editions' },
              h('thead', {}, h('tr', {}, h('th', {}, 'Code'), h('th', {}, 'Title'), h('th', {}, 'Starts on'))),
              h(
                'tbody',
                { id: 'editions-rows' },
                ...editions.map((edition) =>
                  h(
                    'tr',
                    {},
                    h('td', { class: 'mono' }, text(edition.code)),
                    h('td', {}, text(edition.title)),
                    h('td', { class: 'mono' }, text(edition.startsOn)),
                  ),
                ),
              ),
            ),
          ),
        ),
        context,
        'Editions',
      );
    },
  },
];

/**
 * The two workspace dialogs. Both are rendered closed: hidden, unfocusable and absent from
 * the accessibility tree until the operator opens them.
 */
function dialogShell(id: string, label: string, contents: string, actionLabel: string, actionId: string): string {
  return h(
    'div',
    { class: 'dialog-backdrop', id, hidden: true },
    h(
      'div',
      { role: 'dialog', 'aria-modal': 'true', class: 'dialog', 'aria-label': label },
      h('h2', { class: 'dialog-heading' }, text(label)),
      contents,
      h(
        'div',
        { class: 'dialog-actions' },
        h('button', { type: 'button', id: actionId, class: 'primary-action' }, text(actionLabel)),
        h('button', { type: 'button', class: 'secondary-action', 'data-dialog-cancel': 'true' }, 'Cancel'),
      ),
    ),
  );
}

function declineDialog(): string {
  const reason = (id: string, value: string, label: string, first: boolean): string =>
    h(
      'span',
      { class: 'dialog-radio' },
      h('input', {
        type: 'radio',
        id,
        name: 'decline-reason',
        value,
        'data-dialog-first': first ? 'true' : undefined,
      }),
      h('label', { for: id }, text(label)),
    );

  return dialogShell(
    'decline-dialog',
    'Decline claim',
    h(
      'div',
      { role: 'radiogroup', 'aria-label': 'Reason', class: 'dialog-reasons' },
      reason('reason-owner-declined', 'owner_declined', 'Owner declined the quote', true),
      reason('reason-cannot-send', 'cannot_send', 'Part cannot be sent', false),
    ),
    'Confirm decline',
    'confirm-decline',
  );
}

function eraseDialog(): string {
  return dialogShell(
    'erase-dialog',
    'Erase owner data',
    h(
      'div',
      { class: 'form-field' },
      h('label', { for: 'erase-reference' }, 'Type the reference to confirm'),
      h('input', {
        id: 'erase-reference',
        type: 'text',
        class: 'form-control mono',
        'data-dialog-first': 'true',
      }),
    ),
    'Erase everything',
    'erase-everything',
  );
}

/** Every workspace address shows the full workspace for the claim in its current state. */
function workspaceRoute(pattern: string): Route {
  return {
    method: 'GET',
    pattern,
    audience: 'operator',
    session: true,
    signInRedirect: true,
    handler: async (context) => {
      const reference = normaliseReference(context.params['reference'] ?? '');
      if (!isReference(reference)) return toQueue();
      const record = await claims.loadClaim(reference);
      if (record === null) return toQueue();

      const standing: ClaimStanding = { state: record.claim.state, paid: record.payment !== null };
      const models = await catalogue.listModels();
      const modelSlug = record.claim.model_slug;
      const parts = modelSlug === null ? [] : await catalogue.listParts(modelSlug);
      const model = modelSlug === null ? null : await catalogue.findModel(modelSlug);
      const part =
        modelSlug === null || record.claim.booklet_number === null
          ? null
          : await catalogue.findPart(modelSlug, record.claim.booklet_number);
      const entries = await claims.listQueue(null);

      return page(
        h(
          'section',
          { class: 'workspace', 'data-reference': reference, 'data-state': record.claim.state },
          h('a', { href: '/ops/claims', class: 'all-claims-link' }, 'All claims'),
          h(
            'div',
            { class: 'workspace-layout' },
            h('nav', { class: 'queue-pane', 'aria-label': 'Claim queue' }, queueTable(entries)),
            renderFan({
              parts,
              axis: model?.axis ?? null,
              language: 'en-GB',
              selected: part?.bookletNumber ?? null,
              value: part === null ? 0 : 100,
              readOnly: false,
            }),
            renderOperatorSlip({ record, part, language: 'en-GB', standing, modelName: model?.name ?? null, models }),
          ),
          declineDialog(),
          eraseDialog(),
        ),
        context,
        `Claim ${reference}`,
        { reference, noticesPending: record.noticesPending },
      );
    },
  };
}

export const pageRoutes: readonly Route[] = [
  ...ownerPages,
  ...operatorPages,
  workspaceRoute('/ops/claims/:reference'),
  workspaceRoute('/ops/claims/:reference/quote'),
  workspaceRoute('/ops/claims/:reference/quote/:revision'),
  workspaceRoute('/ops/claims/:reference/declined'),
  workspaceRoute('/ops/claims/:reference/dispatched'),
];
