import { STATUS_COPY } from '../../domain/copy.ts';
import { formatCopenhagenInstant, parseInstant } from '../../domain/time.ts';
import { setDeadline } from '../countdown.ts';
import { announce } from '../feedback.ts';
import { request, RequestFailed } from '../net.ts';
import { onAction, onOpen, onSubmit, pageData } from '../ui.ts';

function fieldIn(scope: ParentNode, name: string): string {
  const node = scope.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    `[data-field-control="${name}"]`,
  );
  return node?.value ?? '';
}

function checkedIn(scope: ParentNode, name: string): boolean {
  const node = scope.querySelector<HTMLInputElement>(`[data-field-control="${name}"]`);
  return node !== null && node.checked;
}

interface DropData {
  screen: 'drop';
  slug: string;
  looks: number;
}

interface AvailabilityMarket {
  market: string;
  status: string;
  piecesLeft: number;
}

interface ClaimAnswer {
  claim: { reference: string };
}

export function startDropScreen(): void {
  const data = pageData<DropData>();

  onSubmit(
    '[data-form="waitlist"]',
    async (form) =>
      request(`/api/public/drops/${encodeURIComponent(data.slug)}/waitlist`, {
        method: 'POST',
        body: {
          market: fieldIn(form, 'market'),
          name: fieldIn(form, 'name'),
          email: fieldIn(form, 'email').trim(),
          consent: checkedIn(form, 'consent'),
        },
      }),
    {
      region: 'Waitlist status',
      stickyTrigger: 'join-waitlist',
      success: STATUS_COPY.waitlistJoined,
      own: (failure) =>
        failure.status === 429
          ? STATUS_COPY.waitlistRateLimited(failure.retryAfterSeconds ?? 1)
          : null,
    },
  );

  onSubmit(
    '[data-form="claim-open"]',
    async (form) =>
      request<ClaimAnswer>(
        `/api/public/drops/${encodeURIComponent(data.slug)}/claims`,
        {
          method: 'POST',
          headers: { 'idempotency-key': crypto.randomUUID() },
          body: {
            market: fieldIn(form, 'market'),
            name: fieldIn(form, 'name'),
            email: fieldIn(form, 'email').trim(),
          },
        },
      ),
    {
      region: 'Claim status',
      success: (result) => STATUS_COPY.claimed((result as ClaimAnswer).claim.reference),
      own: claimFailureCopy,
      after: () => void refreshAvailability(data.slug),
    },
  );

  startCarousel(data.looks);
  window.setInterval(() => void refreshAvailability(data.slug), 5000);
}

export function claimFailureCopy(failure: {
  code: string;
  claimedAt?: string;
}): string | null {
  if (failure.code !== 'sold_out') return null;
  const at = failure.claimedAt === undefined ? null : parseInstant(failure.claimedAt);
  return STATUS_COPY.lostRace(at === null ? '' : formatCopenhagenInstant(at));
}

async function refreshAvailability(slug: string): Promise<void> {
  try {
    const data = await request<{ markets: AvailabilityMarket[] }>(
      `/api/public/drops/${encodeURIComponent(slug)}`,
    );
    for (const market of data.markets) {
      const cell = document.querySelector<HTMLElement>(
        `[data-market-row="${market.market}"] [data-pieces-left]`,
      );
      if (cell !== null) cell.textContent = String(market.piecesLeft);
    }
  } catch {
    // The next poll tries again.
  }
}

function startCarousel(total: number): void {
  const track = document.querySelector<HTMLElement>('[data-carousel-track]');
  if (track === null || total === 0) return;
  let index = 0;
  const show = (): void => {
    track.style.setProperty('--carousel-index', String(index));
    announce('Look position', `${index + 1} / ${total}`);
  };
  const move = (delta: number): void => {
    index = Math.max(0, Math.min(total - 1, index + delta));
    show();
  };
  onOpen('carousel-previous', () => move(-1));
  onOpen('carousel-next', () => move(1));

  let startX = 0;
  track.addEventListener('pointerdown', (event) => {
    startX = event.clientX;
  });
  track.addEventListener('pointerup', (event) => {
    const delta = event.clientX - startX;
    if (Math.abs(delta) < 30) return;
    move(delta < 0 ? 1 : -1);
  });
  show();
}

interface ClaimData {
  screen: 'claim';
  token: string;
  expiresAt: string;
}

export function startClaimScreen(): void {
  const data = pageData<ClaimData>();
  const countdown = document.querySelector<HTMLElement>('[data-countdown="hold"]');
  if (countdown !== null) setDeadline(countdown, data.expiresAt);

  onAction(
    'claim-hold',
    async () => {
      const slug = await slugOf(data.token);
      return request<ClaimAnswer>(`/api/public/drops/${encodeURIComponent(slug)}/claims`, {
        method: 'POST',
        headers: { 'idempotency-key': crypto.randomUUID() },
        body: { holdToken: data.token },
      });
    },
    {
      region: 'Claim status',
      success: (result) => STATUS_COPY.claimed((result as ClaimAnswer).claim.reference),
      own: claimFailureCopy,
    },
  );

  window.setInterval(() => void recheckHold(data.token), 5000);
}

let cachedSlug: string | null = null;

async function slugOf(token: string): Promise<string> {
  if (cachedSlug !== null) return cachedSlug;
  const hold = await request<{ dropSlug: string }>(`/api/public/holds/${encodeURIComponent(token)}`);
  cachedSlug = hold.dropSlug;
  return hold.dropSlug;
}

/** Whether the hold is open or ended always comes from the server, never the device clock. */
async function recheckHold(token: string): Promise<void> {
  try {
    const hold = await request<{ status: string; expiresAt: string }>(
      `/api/public/holds/${encodeURIComponent(token)}`,
    );
    const button = document.querySelector<HTMLButtonElement>('[data-action="claim-hold"]');
    if (hold.status === 'expired' || hold.status === 'void') {
      const at = parseInstant(hold.expiresAt);
      announce(
        'Claim status',
        STATUS_COPY.holdExpired(at === null ? '' : formatCopenhagenInstant(at)),
      );
      if (button !== null) button.disabled = true;
    }
    if (hold.status === 'claimed' && button !== null) button.disabled = true;
  } catch {
    // The next re-check tries again.
  }
}

interface OptInData {
  screen: 'optin';
  token: string;
}

export function startOptInScreen(): void {
  const data = pageData<OptInData>();
  onAction(
    'confirm-optin',
    async () =>
      request<{ dropName: string; market: string }>('/api/public/waitlist/confirm', {
        method: 'POST',
        body: { token: data.token },
      }),
    {
      region: 'Waitlist status',
      success: (result) => {
        const answer = result as { dropName: string; market: string };
        return STATUS_COPY.waitlistConfirmed(answer.dropName, cityOf(answer.market));
      },
      own: (failure) =>
        failure.code === 'link_used'
          ? STATUS_COPY.waitlistLinkUsed
          : failure.code === 'link_expired'
            ? STATUS_COPY.waitlistLinkExpired
            : null,
    },
  );
}

const CITY_NAMES: Record<string, string> = {
  copenhagen: 'Copenhagen',
  stockholm: 'Stockholm',
  paris: 'Paris',
  london: 'London',
  new_york: 'New York',
  tokyo: 'Tokyo',
};

function cityOf(market: string): string {
  return CITY_NAMES[market] ?? market;
}

interface PressData {
  screen: 'press';
  token: string;
}

const DEAD_COPY: Record<string, string> = {
  link_revoked: 'This preview link was revoked by the press team.',
  link_expired: 'This preview link has expired.',
  link_replaced: 'This preview link was replaced by a newer one. Check your inbox.',
  drop_withdrawn: 'This drop was withdrawn, so its preview is closed.',
};

export function startPressScreen(): void {
  const data = pageData<PressData>();

  onAction(
    'download-press',
    async () => {
      const response = await fetch(`/api/press/${encodeURIComponent(data.token)}/zip`);
      if (!response.ok) {
        throw new RequestFailed({
          status: response.status,
          code: 'storage_unavailable',
          message: STATUS_COPY.downloadUnavailable,
          fields: {},
        });
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'press-images.zip';
      anchor.click();
      URL.revokeObjectURL(url);
      return null;
    },
    {
      region: 'Download status',
      success: STATUS_COPY.downloadReady,
      own: () => STATUS_COPY.downloadUnavailable,
    },
  );

  window.setInterval(() => {
    void (async (): Promise<void> => {
      try {
        await request(`/api/press/${encodeURIComponent(data.token)}`);
      } catch (error) {
        if (!(error instanceof RequestFailed) || error.failure.status !== 410) return;
        showDeadLink(DEAD_COPY[error.failure.code] ?? error.failure.message);
      }
    })();
  }, 5000);
}

/** Switches an open press page to the matching dead-link screen in place. */
function showDeadLink(copy: string): void {
  const main = document.querySelector<HTMLElement>('[data-main]');
  if (main === null) return;
  const heading = document.createElement('h1');
  heading.className = 'page-heading';
  heading.textContent = 'This preview is no longer available';
  const body = document.createElement('p');
  body.className = 'lead';
  body.dataset['deadLinkCopy'] = '';
  body.textContent = copy;
  const back = document.createElement('a');
  back.className = 'link';
  back.href = '/';
  back.textContent = 'Back to the drop calendar';
  main.replaceChildren(heading, body, back);
  document.title = 'This preview is no longer available · Hourline';
}
