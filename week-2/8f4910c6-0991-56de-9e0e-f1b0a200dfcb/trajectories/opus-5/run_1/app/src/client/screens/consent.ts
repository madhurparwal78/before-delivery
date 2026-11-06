import { call } from '../lib/api.js';
import { clear, el, focus } from '../lib/dom.js';
import { liveRegion, pending } from '../lib/forms.js';
import { pageHeading, type RenderContext, type Screen, type ScreenResult } from '../lib/router.js';
import { copy } from '../lib/copy.js';

const OFFICE_LABELS: Record<string, string> = { toronto: 'Toronto', vancouver: 'Vancouver' };

export const consentScreen: Screen = {
  pattern: '/consent/:token',
  async render(ctx: RenderContext): Promise<ScreenResult> {
    const token = ctx.params.token;
    const result = await call<{ applicantFirstName: string; office: string }>('GET', `/api/consents/${token}`);
    if (!result.body) {
      return {
        node: el('main', { class: 'page page-gone' }, [
          pageHeading(copy.deadConsentHeading),
          el('p', { class: 'lede', text: copy.deadConsentBody }),
        ]),
        chrome: 'plain',
      };
    }
    const { applicantFirstName, office } = result.body;
    const live = liveRegion('Application announcements');
    const approve = el('button', { type: 'button', class: 'button', text: 'Approve application' });
    const decline = el('button', { type: 'button', class: 'button button-quiet', text: 'Decline application' });

    const node = el('main', { class: 'page page-consent' }, [
      pageHeading('Guardian consent'),
      el('p', { class: 'lede', text: `${applicantFirstName} has applied to the ${OFFICE_LABELS[office] ?? office} office of Vesper & Rowe Talent.` }),
      el('div', { class: 'dialog-actions' }, [approve, decline]),
      live.node,
    ]);

    const decide = async (decision: 'approve' | 'decline', button: HTMLButtonElement): Promise<void> => {
      const spinner = pending(button, 'Saving…');
      spinner.start();
      const saved = await call<{ decision: string }>('POST', `/api/consents/${token}`, { body: { decision } });
      spinner.stop();
      if (!saved.body) {
        clear(node);
        node.append(
          el('h1', { class: 'page-title display', text: copy.deadConsentHeading }),
          el('p', { class: 'lede', text: copy.deadConsentBody }),
          live.node,
        );
        return;
      }
      const message = decision === 'approve'
        ? `Thank you. You approved ${applicantFirstName}'s application.`
        : `You declined ${applicantFirstName}'s application. We will not contact them again.`;
      const heading = el('h1', { class: 'page-title display', text: 'Thank you' });
      clear(node);
      node.append(heading, el('p', { class: 'lede', text: message }), live.node);
      live.announce(message);
      focus(heading);
    };

    approve.addEventListener('click', () => void decide('approve', approve));
    decline.addEventListener('click', () => void decide('decline', decline));

    return { node, chrome: 'plain' };
  },
};
