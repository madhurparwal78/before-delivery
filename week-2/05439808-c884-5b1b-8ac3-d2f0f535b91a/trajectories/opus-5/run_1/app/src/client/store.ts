import { ApiRequestError, request, setCsrfToken } from './api.js';
import { noticeCopy, OUTAGE_COPY } from './copy.js';
import { setDisplayZone } from './format.js';
import { alertNotice, notice, showOutageBanner } from './regions.js';
import { BUILDINGS } from '../shared/catalog.js';
import type {
  Catalog,
  ChatMessage,
  ClanBody,
  Invitation,
  Me,
  RaidListRow,
  Rewards,
  UnitRequest,
  Village
} from './apitypes.js';

export type PanelName =
  | 'building'
  | 'train'
  | 'scout'
  | 'raidResult'
  | 'raidLog'
  | 'rewards'
  | 'clan'
  | 'league'
  | 'profile';

export type State = {
  user: Me | null;
  csrfToken: string | null;
  village: Village | null;
  catalog: Catalog | null;
  rewards: Rewards | null;
  clan: ClanBody | null;
  invitations: Invitation[];
  messages: ChatMessage[];
  requests: { requests: UnitRequest[]; mine: UnitRequest | null };
  defences: RaidListRow[];
  attacks: RaidListRow[];
  panel: PanelName | null;
  chatVisible: boolean;
  unread: number;
  skewMs: number;
  dbDown: boolean;
};

export const state: State = {
  user: null,
  csrfToken: null,
  village: null,
  catalog: null,
  rewards: null,
  clan: null,
  invitations: [],
  messages: [],
  requests: { requests: [], mine: null },
  defences: [],
  attacks: [],
  panel: null,
  chatVisible: false,
  unread: 0,
  skewMs: 0,
  dbDown: false
};

const subscribers: (() => void)[] = [];

export function subscribe(listener: () => void): void {
  subscribers.push(listener);
}

export function emit(): void {
  for (const listener of subscribers) listener();
}

export function serverNow(): number {
  return Date.now() + state.skewMs;
}

async function guarded<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    const result = await run();
    if (state.dbDown) {
      state.dbDown = false;
      showOutageBanner(null);
    }
    return result;
  } catch (error) {
    if (error instanceof ApiRequestError && error.failure.code === 'database_unavailable') {
      state.dbDown = true;
      showOutageBanner(OUTAGE_COPY);
      alertNotice(OUTAGE_COPY);
    }
    return null;
  }
}

export async function loadSession(): Promise<void> {
  const body = await guarded(() =>
    request<{ user: Me | null; csrfToken: string }>('GET', '/api/session')
  );
  if (body === null) return;
  state.user = body.user;
  state.csrfToken = body.csrfToken;
  setCsrfToken(body.csrfToken);
  if (body.user) setDisplayZone(body.user.timeZone);
}

export async function loadCatalog(): Promise<void> {
  if (state.catalog !== null) return;
  const catalog = await guarded(() => request<Catalog>('GET', '/api/catalog'));
  if (catalog) state.catalog = catalog;
}

async function refreshMe(): Promise<void> {
  const me = await guarded(() => request<Me>('GET', '/api/me'));
  if (me) {
    state.user = me;
    setDisplayZone(me.timeZone);
  }
}

function announceVillageChanges(previous: Village | null, next: Village): void {
  if (previous === null) return;
  for (const building of next.buildings) {
    const before = previous.buildings.find((entry) => entry.id === building.id);
    if (!before) continue;
    if (before.upgrade !== null && building.upgrade === null && building.level > before.level) {
      notice(noticeCopy.jobComplete(BUILDINGS[building.type].name, building.level));
    }
  }
  if (!previous.underAttack && next.underAttack) notice(noticeCopy.underAttack);
}

export async function refreshVillage(): Promise<void> {
  if (state.user === null || state.user.villageId === null) return;
  const village = await guarded(() => request<Village>('GET', '/api/village'));
  if (!village) return;
  state.skewMs = new Date(village.serverTime).getTime() - Date.now();
  announceVillageChanges(state.village, village);
  state.village = village;
}

export async function refreshRewards(): Promise<void> {
  const rewards = await guarded(() => request<Rewards>('GET', '/api/me/rewards'));
  if (!rewards) return;
  state.rewards = rewards;
  setDisplayZone(rewards.timeZone);
}

let knownClanName: string | null = null;
let removalNotice: string | null = null;

export function clanRemovalNotice(): string | null {
  return removalNotice;
}

export async function refreshClan(): Promise<void> {
  const body = await guarded(() => request<{ clan: ClanBody | null }>('GET', '/api/clan'));
  if (body === null) return;
  if (knownClanName !== null && body.clan === null) {
    removalNotice = knownClanName;
    alertNotice(noticeCopy.removedFromClan(knownClanName));
  }
  if (body.clan !== null) removalNotice = null;
  knownClanName = body.clan === null ? null : body.clan.name;
  state.clan = body.clan;
  if (state.user !== null) state.user.clanId = body.clan === null ? null : body.clan.id;
  if (body.clan === null) {
    state.messages = [];
    state.requests = { requests: [], mine: null };
    state.unread = 0;
  }
}

export async function refreshInvitations(): Promise<void> {
  const body = await guarded(() =>
    request<{ invitations: Invitation[] }>('GET', '/api/me/invitations')
  );
  if (body) state.invitations = body.invitations;
}

let messagesLoaded = false;

export async function refreshMessages(): Promise<void> {
  if (state.clan === null) return;
  const body = await guarded(() =>
    request<{ messages: ChatMessage[] }>('GET', '/api/clan/messages')
  );
  if (!body) return;
  const previousIds = new Set(state.messages.map((message) => message.id));
  state.messages = body.messages;
  const firstLoad = !messagesLoaded;
  messagesLoaded = true;
  if (firstLoad) return;
  if (!state.chatVisible) {
    const fresh = body.messages.filter(
      (message) =>
        !previousIds.has(message.id) && message.author.accountId !== (state.user?.id ?? -1)
    );
    state.unread += fresh.length;
  }
}

export async function refreshRequests(): Promise<void> {
  if (state.clan === null) return;
  const body = await guarded(() =>
    request<{ requests: UnitRequest[]; mine: UnitRequest | null }>('GET', '/api/clan/requests')
  );
  if (body) state.requests = body;
}

const announcedRaids = new Set<number>();
let raidsInitialised = false;

async function refreshRaids(): Promise<void> {
  if (state.user === null || state.user.villageId === null) return;
  const defence = await guarded(() =>
    request<{ raids: RaidListRow[] }>('GET', '/api/raids?role=defence')
  );
  if (defence) {
    for (const raid of defence.raids) {
      const settled = raid.state === 'resolved' || raid.state === 'abandoned';
      if (!settled || announcedRaids.has(raid.id)) continue;
      announcedRaids.add(raid.id);
      if (!raidsInitialised) continue;
      notice(
        raid.state === 'resolved'
          ? noticeCopy.raidedResolved(raid.stars ?? 0, raid.destruction ?? 0)
          : noticeCopy.raidedAbandoned
      );
    }
    raidsInitialised = true;
    state.defences = defence.raids;
  }
  const attack = await guarded(() =>
    request<{ raids: RaidListRow[] }>('GET', '/api/raids?role=attack')
  );
  if (attack) state.attacks = attack.raids;
}

export function showChat(visible: boolean): void {
  state.chatVisible = visible;
  if (visible) state.unread = 0;
}

export async function pollOnce(): Promise<void> {
  if (state.user === null) return;
  if (state.user.role === 'operator') {
    emit();
    return;
  }
  await refreshMe();
  if (state.user === null) return;
  await refreshVillage();
  await refreshRaids();
  if (state.user === null) return;
  if (state.user.clanId !== null || state.clan !== null || state.panel === 'clan') {
    await refreshClan();
    await refreshMessages();
    await refreshRequests();
  }
  if (state.panel === 'clan') await refreshInvitations();
  if (state.panel === 'rewards') await refreshRewards();
  emit();
}

let polling = false;

export function startPolling(): void {
  if (polling) return;
  polling = true;
  const tick = async (): Promise<void> => {
    if (document.visibilityState === 'visible') await pollOnce();
    window.setTimeout(() => void tick(), 1000);
  };
  window.setTimeout(() => void tick(), 1000);
}
