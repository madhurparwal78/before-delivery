import { BLOCKER_COPY, LISTING_WORD, NOTHING_BLOCKING, OUTAGE, PENDING, SUCCESS, publishedAs } from '../../shared/copy';
import { ApiRefusal, ApiUnreachable, request } from '../shared/api';
import { clearNotice, showNotice } from '../shared/chrome';
import { el, focusTarget, onPress, setPending } from '../shared/dom';
import { announce } from '../shared/live';
import { sectionShell, type SectionContext, type SectionView } from './sectionKit';
import { ownerAction, sessionEnded } from './session';
import type { CarFileState } from './state';

/** Publish: live blockers, the publish and withdraw controls, and the sale. */
export const publishSection = (context: SectionContext): SectionView => {
  const { section, heading } = sectionShell('publish', 'Publish');

  const statusWord = el('p', { class: 'listing-word' });
  const blockers = el('ul', { class: 'blocker-list', role: 'list', 'aria-label': 'Publish blockers' });
  const nothingBlocking = el('p', { class: 'nothing-blocking', text: NOTHING_BLOCKING });
  const publish = el('button', { type: 'button', class: 'pill-solid', text: 'Publish' });
  const withdraw = el('button', { type: 'button', class: 'pill-outline', text: 'Withdraw listing' });
  const complete = el('button', { type: 'button', class: 'pill-solid', text: 'Complete sale' });
  const handover = el('a', {
    class: 'underline-link',
    href: `/api/owner/cars/${context.carId}/handover`,
    text: 'Download handover record',
  });
  const report = el('a', { class: 'underline-link', text: 'Download condition report' });
  const actions = el('div', { class: 'publish-actions' });

  onPress(publish, () => {
    void ownerAction(async () => {
      setPending(publish, true);
      announce(context.status, PENDING.publish);
      try {
        const result = await request<{ version: number }>(`/api/owner/cars/${context.carId}/publish`, {
          method: 'POST',
        });
        clearNotice(context.notice);
        await context.refresh(['publish', 'people', 'offers', 'record']);
        announce(context.status, publishedAs(result.version));
      } catch (error) {
        // An ended session is the sign-in dialog’s business, not this handler’s.
        if (sessionEnded(error)) throw error;
        if (error instanceof ApiRefusal) {
          if (error.code === 'report_render_failed') {
            showNotice(context.notice, OUTAGE.reportRender);
            await context.refresh(['publish']);
            return;
          }
          if (error.code === 'report_store_failed') {
            showNotice(context.notice, OUTAGE.reportStore);
            await context.refresh(['publish']);
            return;
          }
          await context.refresh(['publish']);
          announce(context.status, error.body.message);
          return;
        }
        if (error instanceof ApiUnreachable) {
          showNotice(context.notice, OUTAGE.reportRender);
          await context.refresh(['publish']);
          return;
        }
        throw error;
      } finally {
        setPending(publish, false);
      }
    }, publish);
  });

  onPress(withdraw, () => {
    void ownerAction(async () => {
      setPending(withdraw, true);
      announce(context.status, PENDING.withdraw);
      try {
        await request(`/api/owner/cars/${context.carId}/withdraw`, { method: 'POST' });
        await context.refresh(['publish', 'offers', 'people']);
        announce(context.status, SUCCESS.withdraw);
      } catch (error) {
        // An ended session is the sign-in dialog’s business, not this handler’s.
        if (sessionEnded(error)) throw error;
        if (error instanceof ApiRefusal) {
          announce(context.status, error.body.message);
          return;
        }
        throw error;
      } finally {
        if (withdraw.isConnected) setPending(withdraw, false);
      }
    }, withdraw);
  });

  onPress(complete, () => {
    void ownerAction(async () => {
      setPending(complete, true);
      announce(context.status, PENDING.complete);
      try {
        await request(`/api/owner/cars/${context.carId}/complete`, { method: 'POST' });
        clearNotice(context.notice);
        await context.refresh(['publish', 'offers']);
        announce(context.status, SUCCESS.complete);
      } catch (error) {
        // An ended session is the sign-in dialog’s business, not this handler’s.
        if (sessionEnded(error)) throw error;
        if (error instanceof ApiRefusal) {
          if (error.code === 'report_render_failed' || error.code === 'report_store_failed') {
            showNotice(context.notice, OUTAGE.handover);
            focusTarget(complete);
            return;
          }
          announce(context.status, error.body.message);
          return;
        }
        if (error instanceof ApiUnreachable) {
          showNotice(context.notice, OUTAGE.handover);
          focusTarget(complete);
          return;
        }
        throw error;
      } finally {
        if (complete.isConnected) setPending(complete, false);
      }
    }, complete);
  });

  const paint = (state: CarFileState): void => {
    statusWord.textContent = LISTING_WORD[state.car.listingStatus];
    const reasons = state.car.publishBlockers;
    blockers.replaceChildren(
      ...reasons.map((reason) => el('li', { class: 'blocker-item', text: BLOCKER_COPY[reason] })),
    );
    nothingBlocking.hidden = reasons.length > 0;

    const parts: Node[] = [];
    if (state.car.listingStatus === 'draft' || state.car.listingStatus === 'live') parts.push(publish);
    if (state.car.listingStatus === 'under_offer') parts.push(complete);
    if (
      state.car.listingStatus === 'draft' ||
      state.car.listingStatus === 'live' ||
      state.car.listingStatus === 'under_offer'
    ) {
      parts.push(withdraw);
    }
    if (state.car.listingStatus === 'sold') parts.push(handover);
    if (state.car.currentVersion !== null) {
      report.setAttribute('href', `/api/owner/cars/${context.carId}/report/${state.car.currentVersion}`);
      parts.push(report);
    }
    actions.replaceChildren(...parts);
  };

  section.append(el('div', { class: 'card' }, [statusWord, blockers, nothingBlocking, actions]));

  return { id: 'publish', heading, node: section, paint };
};
