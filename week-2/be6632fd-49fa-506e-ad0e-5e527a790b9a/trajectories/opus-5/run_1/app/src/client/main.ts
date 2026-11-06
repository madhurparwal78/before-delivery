import { SHARED_COPY } from '../domain/copy.ts';
import { startCalendar, type CalendarOptions } from './calendar.ts';
import { startCountdowns } from './countdown.ts';
import { wireDialogs } from './dialogs.ts';
import { applyValues, collectValues, keepDraft, readDraft, writeDraft } from './drafts.ts';
import { announce, onEndedSession } from './feedback.ts';
import { routeWipe } from './motion.ts';
import { pageData, takeCarriedAnnouncement, useDraft } from './ui.ts';
import {
  startForgotPasswordScreen,
  startInviteScreen,
  startResetPasswordScreen,
  startSignInScreen,
  wireSignOut,
} from './screens/accountscreens.ts';
import {
  startMembersScreen,
  startStockistScreen,
  startStockistsScreen,
} from './screens/directoryscreens.ts';
import { startNewDropScreen } from './screens/newdropscreen.ts';
import { startPlannerScreen } from './screens/plannerscreen.ts';
import {
  startLookbookScreen,
  startPreviewsScreen,
  startStoryScreen,
} from './screens/pressscreens.ts';
import {
  startClaimScreen,
  startDropScreen,
  startOptInScreen,
  startPressScreen,
} from './screens/publicscreens.ts';
import {
  startAllocationScreen,
  startDropAllocationsScreen,
  startLineSheetScreen,
  startMyStoreScreen,
  startPriceListsScreen,
} from './screens/tradescreens.ts';

interface BaseData {
  screen?: string;
  memberId?: string;
}

const STARTERS: Record<string, () => void> = {
  drop: startDropScreen,
  claim: startClaimScreen,
  optin: startOptInScreen,
  press: startPressScreen,
  'sign-in': startSignInScreen,
  'forgot-password': startForgotPasswordScreen,
  'reset-password': startResetPasswordScreen,
  invite: startInviteScreen,
  'new-drop': startNewDropScreen,
  planner: startPlannerScreen,
  'drop-allocations': startDropAllocationsScreen,
  allocation: startAllocationScreen,
  'price-lists': startPriceListsScreen,
  'line-sheet': startLineSheetScreen,
  lookbook: startLookbookScreen,
  story: startStoryScreen,
  previews: startPreviewsScreen,
  stockists: startStockistsScreen,
  stockist: startStockistScreen,
  members: startMembersScreen,
  'my-store': startMyStoreScreen,
};

const DRAFT_SCREENS = new Set([
  'planner',
  'allocation',
  'story',
  'stockists',
  'stockist',
  'members',
  'price-lists',
  'drop-allocations',
  'my-store',
  'previews',
  'lookbook',
  'line-sheet',
]);

/** Each screen's own status region, used for the ended-session and restored-draft copy. */
function primaryRegion(): string {
  const node = document.querySelector<HTMLElement>('[data-status-region]');
  return node?.dataset['statusRegion'] ?? '';
}

function wireEndedSessions(): void {
  onEndedSession((copy) => {
    const region = document.querySelector<HTMLElement>(`[data-status-region="${primaryRegion()}"]`);
    if (region === null) return;
    region.textContent = copy;
    if (copy === SHARED_COPY.accessRemoved) return;
    const link = document.createElement('a');
    link.className = 'link';
    link.href = `/sign-in?next=${encodeURIComponent(window.location.pathname)}`;
    link.textContent = 'Sign in again';
    region.append(' ', link);
  });
}

/** A sticky bar never covers the control that has focus or was just tapped. */
function keepClearOfStickyBar(): void {
  document.addEventListener('focusin', (event) => {
    const bar = document.querySelector<HTMLElement>('[data-sticky-bar]');
    if (bar === null || bar.offsetParent === null) return;
    const target = event.target as HTMLElement | null;
    if (target === null || bar.contains(target)) return;
    const box = target.getBoundingClientRect();
    if (box.bottom > bar.getBoundingClientRect().top) {
      target.scrollIntoView({ block: 'center' });
    }
  });
}

function wireRouteWipe(): void {
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const anchor = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[href]');
    if (anchor === null || anchor === undefined) return;
    if (anchor.target === '_blank' || anchor.hasAttribute('download')) return;
    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin) return;
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/assets/')) return;
    if (url.pathname === window.location.pathname && url.search === window.location.search) return;
    event.preventDefault();
    void routeWipe('up', async () => {
      window.location.assign(url.href);
    });
  });

  window.addEventListener('popstate', () => {
    void routeWipe('down', async () => undefined);
  });
}

function focusHeadingAfterWipe(): void {
  const heading = document.querySelector<HTMLElement>('h1');
  if (heading === null) return;
  heading.tabIndex = -1;
  if (window.performance.getEntriesByType('navigation').length === 0) return;
  const entry = window.performance.getEntriesByType('navigation')[0] as
    | PerformanceNavigationTiming
    | undefined;
  if (entry?.type === 'navigate' && document.referrer !== '') heading.focus();
}

function start(): void {
  const data = pageData<BaseData & CalendarOptions>();
  wireDialogs();
  wireSignOut();
  wireEndedSessions();
  startCountdowns();
  wireRouteWipe();
  keepClearOfStickyBar();
  focusHeadingAfterWipe();

  if (data.screen === 'calendar') {
    startCalendar({
      weeks: data.weeks ?? [],
      currentWeek: data.currentWeek ?? '',
      today: data.today ?? '',
    });
  }

  const starter = data.screen === undefined ? undefined : STARTERS[data.screen];
  starter?.();

  const memberId = document.body.dataset['memberId'];
  if (data.screen !== undefined && memberId !== undefined && DRAFT_SCREENS.has(data.screen)) {
    const key = { memberId, screen: data.screen };
    useDraft(key);
    const kept = readDraft(key);
    if (kept !== null) {
      applyValues(document, kept);
      announce(primaryRegion(), SHARED_COPY.draftRestored);
    }
    keepDraft(key);
    window.addEventListener('beforeunload', () => writeDraft(key, collectValues(document)));
  }

  const carried = takeCarriedAnnouncement();
  if (carried !== null) {
    announce(carried.region, carried.copy);
    if (carried.focus !== null) {
      const target = document.querySelector<HTMLElement>(carried.focus);
      if (target !== null) {
        target.tabIndex = target.tabIndex < 0 ? -1 : target.tabIndex;
        target.focus();
      }
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
