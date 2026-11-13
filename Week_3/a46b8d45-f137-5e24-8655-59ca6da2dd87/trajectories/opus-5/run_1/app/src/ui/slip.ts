/**
 * The claim slip: a ruled card where every figure carries a small mono caption naming its
 * source. The share page shows only the current quote revision; void revisions live in the
 * operator's Earlier revisions disclosure.
 */

import * as copy from '../shared/copy';
import { bilingual, bilingualLabel, h, pick, text, type Pair } from '../shared/html';
import { currentQuote, voidQuotes, type ClaimRecord, type QuoteRow } from '../db/claims';
import { allows, type ClaimStanding } from '../domain/state';
import type { CataloguePart } from '../db/catalogue';
import type { Language } from '../shared/format';

type Caption = 'carrier' | 'billing' | 'edition';

/** One slip line, with the caption that names where its figure came from. */
function line(both: Pair, language: Language, caption?: Caption, extraClass = ''): string {
  const captionPair = caption === undefined ? null : copy.SOURCE_CAPTIONS[caption];
  return h(
    'p',
    { class: `slip-line ${extraClass}`.trim() },
    h('span', { class: 'slip-value', ...bilingual(both) }, text(pick(both, language))),
    captionPair === null
      ? ''
      : h('span', { class: 'slip-caption', ...bilingual(captionPair) }, text(pick(captionPair, language))),
  );
}

function both(build: (language: Language) => string): Pair {
  return { 'en-GB': build('en-GB'), 'pl-PL': build('pl-PL') };
}

function statePair(record: ClaimRecord): Pair {
  return both((language) => copy.stateName(record.claim.state, language));
}

function partLines(part: CataloguePart | null, language: Language): string {
  if (part === null) return '';
  return (
    line(both((inner) => copy.partLine(part.bookletNumber, part.name, inner)), language) +
    h(
      'p',
      { class: 'slip-line' },
      h(
        'span',
        { class: 'slip-value mono', ...bilingual(both((inner) => copy.partNumberLine(part.partNumber, inner))) },
        text(pick(both((inner) => copy.partNumberLine(part.partNumber, inner)), language)),
      ),
    )
  );
}

function rulingLines(record: ClaimRecord, language: Language): string {
  const ruling = record.ruling;
  if (ruling === null) return line(copy.NOT_YET_RULED, language, 'edition');
  return (
    line(both((inner) => copy.rulingLine(ruling.inside, inner)), language, 'edition') +
    line(both((inner) => copy.coverEndLine(ruling.cover_ends_at.toISOString(), inner)), language) +
    line(both((inner) => copy.editionLine(ruling.edition_code, inner)), language)
  );
}

function quoteLines(quote: QuoteRow, language: Language): string {
  return (
    h(
      'h3',
      { class: 'slip-heading', ...bilingual(both((inner) => copy.revisionHeading(quote.revision, inner))) },
      text(pick(both((inner) => copy.revisionHeading(quote.revision, inner)), language)),
    ) +
    line(both((inner) => copy.partAmountLine(quote.part_line_minor, inner)), language, 'billing') +
    line(both((inner) => copy.carriageAmountLine(quote.band, quote.carriage_minor, inner)), language, 'carrier') +
    line(both((inner) => copy.totalLine(quote.total_minor, inner)), language, 'billing') +
    line(both((inner) => copy.promiseLine(quote.promise_kind, quote.promise_date, inner)), language)
  );
}

function paymentLines(record: ClaimRecord, language: Language): string {
  const payment = record.payment;
  const decline = record.decline;
  let markup = '';
  if (payment !== null) {
    markup += line(both((inner) => copy.paidLine(payment.paid_minor, inner)), language, 'billing');
  }
  if (decline !== null) {
    markup +=
      decline.refunded_minor === 0
        ? line(copy.NOTHING_CHARGED, language, 'billing')
        : line(both((inner) => copy.refundedLine(decline.refunded_minor, inner)), language, 'billing');
  }
  return markup;
}

/** A disclosure, collapsed when the page opens, holding nothing in the tree while closed. */
function disclosure(id: string, label: Pair, language: Language, contents: string): string {
  return h(
    'div',
    { class: 'disclosure' },
    h(
      'button',
      {
        type: 'button',
        class: 'disclosure-toggle',
        'aria-expanded': 'false',
        'aria-controls': id,
        ...bilingual(label),
      },
      text(pick(label, language)),
    ),
    h('div', { id, class: 'disclosure-panel', hidden: true }, contents),
  );
}

export interface SlipOptions {
  record: ClaimRecord;
  part: CataloguePart | null;
  language: Language;
}

/** The owner's read-only slip. */
export function renderShareSlip(options: SlipOptions): string {
  const { record, language } = options;
  const quote = currentQuote(record);

  const history = h(
    'ul',
    { class: 'history-list' },
    ...record.history.map((entry) => {
      const pair = both((inner) => copy.historyEntry(entry.state, entry.at.toISOString(), inner));
      return h('li', { class: 'history-entry', ...bilingual(pair) }, text(pick(pair, language)));
    }),
  );

  return h(
    'section',
    {
      role: 'region',
      class: 'claim-slip',
      'aria-label': pick(copy.CONTROL_NAMES.claimSlip, language),
      ...bilingualLabel(copy.CONTROL_NAMES.claimSlip),
    },
    line(statePair(record), language),
    partLines(options.part, language),
    rulingLines(record, language),
    quote === null ? '' : quoteLines(quote, language),
    paymentLines(record, language),
    disclosure('claim-history', copy.CONTROL_NAMES.claimHistory, language, history),
  );
}

/* --------------------------------------------------------------- the operator's slip */

function englishLine(value: string, caption?: Caption): string {
  return line({ 'en-GB': value, 'pl-PL': value }, 'en-GB', caption);
}

function actionButton(name: string, action: string, enabled: boolean, extra: Record<string, string> = {}): string {
  return h(
    'button',
    {
      type: 'button',
      class: 'slip-action',
      'data-action': action,
      disabled: !enabled,
      ...extra,
    },
    text(name),
  );
}

export interface OperatorSlipOptions extends SlipOptions {
  standing: ClaimStanding;
  modelName: string | null;
  models: readonly { slug: string; name: string }[];
}

/**
 * Each action button is enabled only in the states the state machine allows, so no screen
 * can offer a move the server refuses.
 */
export function renderOperatorSlip(options: OperatorSlipOptions): string {
  const { record, standing } = options;
  const claim = record.claim;
  const quote = currentQuote(record);
  const earlier = voidQuotes(record);
  const quoteName = record.quotes.length > 0 ? 'Re-quote' : 'Get quote';

  const identify = h(
    'div',
    { class: 'identify-controls' },
    h('label', { for: 'identify-model' }, 'Model'),
    h(
      'select',
      { id: 'identify-model', class: 'identify-model', disabled: !allows('identify', standing) },
      ...options.models.map((model) =>
        h('option', { value: model.slug, selected: model.slug === claim.model_slug }, text(model.name)),
      ),
    ),
    h('label', { for: 'identify-quantity' }, 'Quantity'),
    h('input', {
      id: 'identify-quantity',
      class: 'identify-quantity',
      type: 'number',
      min: 1,
      max: 20,
      value: claim.quantity ?? 1,
      disabled: !allows('identify', standing),
    }),
    actionButton('Identify part', 'identify', allows('identify', standing)),
  );

  const photos = h(
    'div',
    { class: 'slip-photos' },
    ...record.photos.map((photo) =>
      h('img', {
        class: 'slip-photo',
        src: `/api/ops/claims/${claim.reference}/photos/${photo.photo_index}`,
        alt: `Damage photo ${photo.photo_index}`,
        width: 160,
      }),
    ),
  );

  const earlierPanel = h(
    'ul',
    { class: 'earlier-list' },
    ...earlier.map((revision) =>
      h('li', { class: 'earlier-entry mono' }, text(copy.voidRevisionLine(revision.revision, revision.total_minor))),
    ),
  );

  const shareLink = record.shareLink;

  return h(
    'section',
    { role: 'region', class: 'claim-slip', 'aria-label': 'Claim slip' },
    h('p', { class: 'slip-reference mono' }, text(claim.reference)),
    englishLine(copy.stateName(claim.state, 'en-GB')),
    h(
      'div',
      { class: 'slip-owner' },
      h('p', { class: 'slip-line' }, text(claim.owner_name ?? '')),
      h('p', { class: 'slip-line' }, text(claim.owner_email ?? '')),
      h('p', { class: 'slip-line mono' }, text(claim.owner_postcode ?? '')),
      h('p', { class: 'slip-line' }, text(claim.purchase_date ?? '')),
      h('p', { class: 'slip-line' }, text(claim.description ?? '')),
    ),
    photos,
    options.part === null ? '' : englishLine(copy.partLine(options.part.bookletNumber, options.part.name, 'en-GB')),
    options.part === null ? '' : englishLine(copy.partNumberLine(options.part.partNumber, 'en-GB')),
    record.ruling === null
      ? englishLine(copy.NOT_YET_RULED['en-GB'], 'edition')
      : englishLine(copy.rulingLine(record.ruling.inside, 'en-GB'), 'edition') +
        englishLine(copy.coverEndLine(record.ruling.cover_ends_at.toISOString(), 'en-GB')) +
        englishLine(copy.editionLine(record.ruling.edition_code, 'en-GB')),
    identify,
    quote === null ? '' : quoteLines(quote, 'en-GB'),
    earlier.length === 0
      ? ''
      : disclosure(
          'earlier-revisions',
          { 'en-GB': `Earlier revisions (${earlier.length})`, 'pl-PL': `Earlier revisions (${earlier.length})` },
          'en-GB',
          earlierPanel,
        ),
    record.payment === null ? '' : englishLine(copy.paidLine(record.payment.paid_minor, 'en-GB'), 'billing'),
    record.decline === null
      ? ''
      : record.decline.refunded_minor === 0
        ? englishLine(copy.NOTHING_CHARGED['en-GB'], 'billing')
        : englishLine(copy.refundedLine(record.decline.refunded_minor, 'en-GB'), 'billing'),
    shareLink === null
      ? ''
      : h('p', { class: 'slip-line mono share-link' }, text(`/s/${shareLink.token}`)),
    h(
      'div',
      { class: 'slip-actions' },
      actionButton(quoteName, 'quote', allows('quote', standing)),
      actionButton('Record payment', 'payment', allows('payment', standing)),
      actionButton('Decline', 'decline', allows('decline', standing)),
      actionButton('Dispatch', 'dispatch', allows('dispatch', standing)),
      actionButton('Close claim', 'close', allows('close', standing)),
      actionButton('Withdraw share link', 'withdraw-link', allows('share_link', standing)),
      actionButton('Send new share link', 'new-link', allows('share_link', standing)),
      actionButton('Erase owner data', 'erase', allows('erase', standing)),
      claim.state === 'dispatched' || claim.state === 'closed'
        ? h('a', { class: 'slip-note-link', href: `/api/ops/claims/${claim.reference}/dispatch-note` }, 'Dispatch note')
        : '',
    ),
  );
}
