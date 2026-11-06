import { ERROR_COPY, STATE_COPY } from '../../shared/copy';
import { get, RequestFailed } from '../api';
import { element, heading } from '../dom';
import { showDate, showMoney } from '../format';
import { Cleanup, RouteContext } from '../router';
import { publicFrame } from '../ui/publicframe';
import { exchangeCard, STATUS_TEXT } from './publichome';

interface JurisdictionPage {
  jurisdiction: {
    code: string;
    name: string;
    region: string;
    currency: string;
    status: string;
    thresholdCents: number | null;
    inForceSince: string | null;
    announcedChange: { thresholdCents: number; takesEffectOn: string } | null;
  };
  exchanges: Array<{
    slug: string;
    name: string;
    jurisdictionCode: string;
    region: string;
    status: string;
    onNetwork: boolean;
  }>;
}

export async function jurisdictionScreen(
  host: HTMLElement,
  context: RouteContext,
): Promise<Cleanup> {
  const frame = await publicFrame(host);
  try {
    const body = await get<JurisdictionPage>(`/api/public/jurisdictions/${context.params.code}`);
    const rule = body.jurisdiction;
    frame.main.append(
      heading(1, rule.name, 'public-title'),
      element('div', {
        className: 'two-panel',
        children: [
          element('section', {
            className: 'panel',
            children: [
              element('h2', { text: 'Rule' }),
              element('p', { text: STATUS_TEXT[rule.status] ?? rule.status }),
              element('p', {
                className: 'mono',
                text:
                  rule.thresholdCents === null
                    ? 'No threshold in force'
                    : showMoney(rule.currency, rule.thresholdCents),
              }),
              element('p', {
                className: 'mono',
                text: rule.inForceSince === null ? 'Not in force' : `Since ${showDate(rule.inForceSince)}`,
              }),
              element('p', {
                className: 'mono',
                text:
                  rule.announcedChange === null
                    ? 'No announced change'
                    : `Announced: ${showMoney(rule.currency, rule.announcedChange.thresholdCents)} from ${showDate(rule.announcedChange.takesEffectOn)}`,
              }),
            ],
          }),
          element('section', {
            className: 'panel',
            children: [
              element('h2', { text: 'Listed exchanges' }),
              element('ul', {
                className: 'card-list',
                attributes: { role: 'list', 'aria-label': 'Listed exchanges' },
                children: body.exchanges.map(exchangeCard),
              }),
            ],
          }),
        ],
      }),
    );
  } catch (error) {
    frame.main.append(heading(1, 'Page not found', 'public-title'));
    frame.main.append(element('p', { text: STATE_COPY.unknownPage }));
    if (!(error instanceof RequestFailed)) throw error;
  }
  return () => frame.destroy();
}

interface ExchangePage {
  exchange: {
    slug: string;
    name: string;
    jurisdictionCode: string;
    region: string;
    status: string;
    onNetwork: boolean;
  };
}

export async function exchangeScreen(host: HTMLElement, context: RouteContext): Promise<Cleanup> {
  const frame = await publicFrame(host);
  try {
    const body = await get<ExchangePage>(`/api/public/exchanges/${context.params.listingSlug}`);
    frame.main.append(
      heading(1, body.exchange.name, 'public-title'),
      element('section', {
        className: 'panel',
        children: [
          element('h2', { text: 'Details' }),
          element('p', { text: body.exchange.jurisdictionCode, className: 'mono' }),
          element('p', { text: STATUS_TEXT[body.exchange.status] ?? body.exchange.status }),
          element('p', {
            text: body.exchange.onNetwork ? 'On the message network' : 'Off the message network',
          }),
        ],
      }),
    );
  } catch (error) {
    if (error instanceof RequestFailed && error.failure.code === 'listing_withdrawn') {
      frame.main.append(
        heading(1, 'Listing withdrawn', 'public-title'),
        element('p', { text: ERROR_COPY.listing_withdrawn }),
      );
    } else {
      frame.main.append(
        heading(1, 'Page not found', 'public-title'),
        element('p', { text: STATE_COPY.unknownPage }),
      );
    }
  }
  return () => frame.destroy();
}

export async function notFoundScreen(host: HTMLElement): Promise<Cleanup> {
  const frame = await publicFrame(host);
  frame.main.append(
    heading(1, 'Page not found', 'public-title'),
    element('p', { text: STATE_COPY.unknownPage }),
  );
  return () => frame.destroy();
}
