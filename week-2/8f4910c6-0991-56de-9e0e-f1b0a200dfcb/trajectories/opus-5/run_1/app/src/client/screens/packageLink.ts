import { call } from '../lib/api.js';
import { el } from '../lib/dom.js';
import { liveRegion, pending } from '../lib/forms.js';
import { pageHeading, type RenderContext, type Screen, type ScreenResult } from '../lib/router.js';
import { copy } from '../lib/copy.js';
import { formatCompactReach, formatHeight, formatMeasurement } from '../../shared/format.js';
import type { PackageDecision, PackageView } from '../../shared/types.js';

const OFFICE_LABELS: Record<string, string> = { toronto: 'Toronto', vancouver: 'Vancouver' };

function deadLinkPage(): ScreenResult {
  return {
    node: el('main', { class: 'page page-gone' }, [
      pageHeading(copy.deadPackageHeading),
      el('p', { class: 'lede', text: copy.deadPackageBody }),
    ]),
    chrome: 'plain',
  };
}

export const packageScreen: Screen = {
  pattern: '/p/:token',
  async render(ctx: RenderContext): Promise<ScreenResult> {
    const token = ctx.params.token;
    const result = await call<PackageView>('GET', `/api/p/${token}`);
    if (!result.body) return deadLinkPage();
    const view = result.body;
    const live = liveRegion('Package announcements');
    const countNode = el('p', { role: 'status', class: 'shortlist-count tabular', text: `${view.shortlistedCount} shortlisted` });
    let shortlisted = view.shortlistedCount;

    const cards = view.talent.map((entry) => {
      const shortlist = el('button', {
        type: 'button',
        class: 'button button-quiet',
        text: 'Shortlist',
        'aria-pressed': entry.decision === 'shortlisted' ? 'true' : 'false',
      });
      const pass = el('button', {
        type: 'button',
        class: 'button button-quiet',
        text: 'Pass',
        'aria-pressed': entry.decision === 'passed' ? 'true' : 'false',
      });
      let decision: PackageDecision = entry.decision;

      const paint = (): void => {
        shortlist.setAttribute('aria-pressed', decision === 'shortlisted' ? 'true' : 'false');
        pass.setAttribute('aria-pressed', decision === 'passed' ? 'true' : 'false');
        countNode.textContent = `${shortlisted} shortlisted`;
      };

      const choose = async (wanted: PackageDecision): Promise<void> => {
        const previous = decision;
        const previousCount = shortlisted;
        const next: PackageDecision = previous === wanted ? 'undecided' : wanted;
        decision = next;
        shortlisted += (next === 'shortlisted' ? 1 : 0) - (previous === 'shortlisted' ? 1 : 0);
        paint();
        const saved = await call<{ shortlistedCount: number }>('PUT', `/api/p/${token}/decisions/${entry.slug}`, {
          body: { decision: next },
        });
        if (saved.body) {
          shortlisted = saved.body.shortlistedCount;
          paint();
          live.announce(
            next === 'shortlisted'
              ? `Shortlisted ${entry.displayName}.`
              : next === 'passed'
                ? `Passed on ${entry.displayName}.`
                : `Cleared your choice for ${entry.displayName}.`,
          );
          return;
        }
        decision = previous;
        shortlisted = previousCount;
        paint();
        const code = saved.error?.error;
        live.announce(
          code === 'link_expired'
            ? `This package link has expired, so your choice for ${entry.displayName} was not saved.`
            : code === 'link_revoked' || code === 'link_replaced'
              ? `This package link was revoked, so your choice for ${entry.displayName} was not saved.`
              : code === 'not_found'
                ? `${entry.displayName} is no longer in this package.`
                : copy.validation(1),
        );
      };

      shortlist.addEventListener('click', () => void choose('shortlisted'));
      pass.addEventListener('click', () => void choose('passed'));

      return el('article', { class: 'card', 'aria-label': entry.displayName }, [
        entry.coverPhotoUrl
          ? el('img', { class: 'portrait', src: entry.coverPhotoUrl, alt: `${entry.displayName}, portfolio cover` })
          : el('div', { class: 'portrait portrait-empty', 'aria-hidden': 'true' }),
        el('h2', { class: 'card-name', text: entry.displayName }),
        el('p', { class: 'card-facts tabular' }, [
          el('span', { text: OFFICE_LABELS[entry.office] ?? entry.office }),
          el('span', {
            text: entry.measurements.heightCm === null ? '' : formatHeight(entry.measurements.heightCm),
          }),
          el('span', {
            text: entry.measurements.waistCm === null ? '' : `Waist ${formatMeasurement(entry.measurements.waistCm)}`,
          }),
          el('span', { text: `${formatCompactReach(entry.reach.total)} reach` }),
        ]),
        el('div', { class: 'card-actions' }, [shortlist, pass]),
      ]);
    });

    const download = el('button', { type: 'button', class: 'button', text: 'Download photos' });
    download.addEventListener('click', async () => {
      const spinner = pending(download, 'Preparing photos…');
      spinner.start();
      const response = await fetch(`/api/p/${token}/photos.zip`);
      spinner.stop();
      if (!response.ok) {
        live.announce(
          response.status === 503 ? copy.downloadStorageOutage : copy.deadPackageBody,
        );
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = el('a', { href: url, download: 'package-photos.zip' });
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      live.announce('Your download has started.');
    });

    const node = el('main', { class: 'page page-package' }, [
      pageHeading(view.title),
      el('div', { class: 'card-grid' }, cards),
      el('div', { class: 'sticky-bar' }, [countNode, download]),
      live.node,
    ]);
    return { node, chrome: 'plain' };
  },
};
