import { useSyncExternalStore } from 'react';
import type {
  ActionResult,
  ChatMessage,
  Invite,
  Notice,
  Party,
  Player,
  Quest,
  QuestFixture,
  Task,
  TaskLists,
  TaskType,
} from '../shared/types.js';
import { gold2, tenths1, MINUS } from '../shared/format.js';
import { ApiFailure, api } from './api.js';
import { flyDamageChip } from './motion.js';

export interface AppState {
  ready: boolean;
  player: Player | null;
  tasks: TaskLists;
  party: Party | null;
  quest: Quest | null;
  invites: Invite[];
  chat: ChatMessage[];
  fixtures: QuestFixture[];
  feed: string[];
  alert: string | null;
  notice: Notice | null;
}

const emptyLists: TaskLists = { habits: [], dailies: [], todos: [], rewards: [] };

let state: AppState = {
  ready: false,
  player: null,
  tasks: emptyLists,
  party: null,
  quest: null,
  invites: [],
  chat: [],
  fixtures: [],
  feed: [],
  alert: null,
  notice: null,
};

const listeners = new Set<() => void>();
const seenStrikes = new Set<string>();
const shownNotices = new Set<string>();

function set(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function useAppState(): AppState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

export function announce(...lines: string[]): void {
  set({ feed: [...state.feed, ...lines].slice(-4) });
}

export function showAlert(message: string | null): void {
  set({ alert: message });
}

export const GENERIC_ERROR = 'Something went wrong. Try again.';

export function reportFailure(error: unknown, known: (failure: ApiFailure) => string | null = () => null): void {
  if (error instanceof ApiFailure) {
    const message = known(error);
    if (message) {
      showAlert(message);
      return;
    }
    const gold = error.fieldErrors.gold;
    if (gold) {
      showAlert(gold);
      return;
    }
  }
  showAlert(GENERIC_ERROR);
}

function nextNotice(player: Player | null): Notice | null {
  if (!player) return null;
  return player.notices.find((notice) => !shownNotices.has(notice.id)) ?? null;
}

function applyPlayer(player: Player): void {
  const notice = state.notice ?? nextNotice(player);
  if (notice) shownNotices.add(notice.id);
  set({ player, notice });
}

export async function loadEverything(): Promise<void> {
  const player = await api.me();
  const [tasks, party, invites, fixtures] = await Promise.all([
    api.tasks(),
    api.party(),
    api.invites(),
    api.questFixtures() as Promise<{ quests: QuestFixture[] }>,
  ]);
  let quest: Quest | null = null;
  let chat: ChatMessage[] = [];
  if (party.party) {
    chat = (await api.chat(party.party.id)).messages;
    if (party.party.questId) quest = await api.quest(party.party.questId);
  }
  set({
    ready: true,
    tasks,
    party: party.party,
    invites: invites.invites,
    fixtures: fixtures.quests,
    quest,
    chat,
  });
  applyPlayer(player);
}

export function closeNotice(): void {
  const notice = state.notice;
  set({ notice: null });
  if (!notice) return;
  void api.ackNotice(notice.id).then(async () => {
    const player = await api.me();
    applyPlayer(player);
  });
}

let stream: EventSource | null = null;

export function connectLive(): void {
  if (stream) return;
  stream = new EventSource('/api/live');
  stream.addEventListener('player', (event) => {
    applyPlayer(JSON.parse((event as MessageEvent<string>).data) as Player);
  });
  stream.addEventListener('tasks', (event) => {
    set({ tasks: JSON.parse((event as MessageEvent<string>).data) as TaskLists });
  });
  stream.addEventListener('party', (event) => {
    const data = JSON.parse((event as MessageEvent<string>).data) as Party | { party: null };
    set({ party: 'party' in data ? null : data });
    if ('party' in data) set({ quest: null, chat: [] });
  });
  stream.addEventListener('invite', (event) => {
    const data = JSON.parse((event as MessageEvent<string>).data) as { invites: Invite[] };
    set({ invites: data.invites });
  });
  stream.addEventListener('quest', (event) => {
    const quest = JSON.parse((event as MessageEvent<string>).data) as Quest;
    const previous = state.quest;
    set({ quest });
    if (previous && previous.id === quest.id && previous.state === 'active' && quest.state === 'defeated') {
      const fixture = state.fixtures.find((entry) => entry.name === quest.name);
      if (fixture) {
        announce(`Quest complete: +${gold2(fixture.rewardGold)} gold, +${fixture.rewardExperience} experience`);
      }
    }
  });
  stream.addEventListener('strike', (event) => {
    const data = JSON.parse((event as MessageEvent<string>).data) as {
      id: string;
      kind: 'strike' | 'strikeback';
      username: string;
      amount: number;
      missed: number | null;
    };
    if (seenStrikes.has(data.id)) return;
    seenStrikes.add(data.id);
    const player = state.player;
    if (data.kind === 'strikeback') {
      const boss = state.quest ? state.quest.boss : '';
      if (player && !player.resting) {
        announce(`${boss} struck back: you lost ${tenths1(data.amount)} health`);
      }
      return;
    }
    if (player && data.username === player.username) announce(`Boss took ${tenths1(data.amount)} damage`);
    else announce(`${data.username} hit the boss for ${tenths1(data.amount)} damage`);
  });
  stream.addEventListener('chat', (event) => {
    const message = JSON.parse((event as MessageEvent<string>).data) as ChatMessage;
    if (state.chat.some((entry) => entry.id === message.id)) return;
    set({ chat: [...state.chat, message] });
  });
  stream.addEventListener('banner', (event) => {
    const data = JSON.parse((event as MessageEvent<string>).data) as { bannerUrl: string | null };
    if (state.party) set({ party: { ...state.party, bannerUrl: data.bannerUrl } });
  });
  stream.addEventListener('notice', (event) => {
    const notice = JSON.parse((event as MessageEvent<string>).data) as Notice;
    if (shownNotices.has(notice.id) || state.notice) return;
    shownNotices.add(notice.id);
    set({ notice });
  });
}

export function disconnectLive(): void {
  if (!stream) return;
  stream.close();
  stream = null;
}

function seamRect(): DOMRect | null {
  const seam = document.querySelector('[data-seam="remaining"]');
  return seam ? seam.getBoundingClientRect() : null;
}

function applyResult(result: ActionResult): void {
  const lists = { ...state.tasks };
  const key: Record<TaskType, keyof TaskLists> = {
    habit: 'habits',
    daily: 'dailies',
    todo: 'todos',
    reward: 'rewards',
  };
  const listKey = key[result.task.type];
  lists[listKey] = lists[listKey].map((task) => (task.id === result.task.id ? result.task : task));
  set({ tasks: lists });
  applyPlayer(result.player);
  if (result.strike) {
    seenStrikes.add(result.strike.id);
    if (state.quest) {
      const quest = state.quest;
      const events = quest.events.some((entry) => entry.id === result.strike?.id)
        ? quest.events
        : [...quest.events, result.strike];
      set({ quest: { ...quest, bossHealth: result.strike.bossHealthAfter, events } });
    }
  }
}

function strikeFlight(row: HTMLElement | null, damage: number): void {
  if (!row || damage <= 0) return;
  const to = seamRect();
  if (!to) return;
  flyDamageChip(row.getBoundingClientRect(), to, `${MINUS}${tenths1(damage)}`);
}

export async function completeTask(task: Task, row: HTMLElement | null): Promise<void> {
  showAlert(null);
  try {
    const result = await api.complete(task.id);
    applyResult(result);
    announce(
      `${task.title} complete: +${result.delta.experience} experience, +${gold2(result.delta.gold)} gold`,
    );
    if (result.strike) {
      strikeFlight(row, result.strike.amount);
      announce(`Boss took ${tenths1(result.strike.amount)} damage`);
    }
  } catch (error) {
    reportFailure(error);
  }
}

export async function uncompleteTask(task: Task): Promise<void> {
  showAlert(null);
  try {
    const result = await api.uncomplete(task.id);
    applyResult(result);
    if (state.quest && state.player) {
      const quest = await api.quest(state.quest.id);
      set({ quest });
    }
    announce(`${task.title} undone`);
  } catch (error) {
    reportFailure(error);
  }
}

export async function scoreTask(task: Task, direction: 'up' | 'down', row: HTMLElement | null): Promise<void> {
  showAlert(null);
  try {
    const result = await api.score(task.id, direction);
    applyResult(result);
    if (direction === 'up') {
      announce(`${task.title} scored: +${result.delta.experience} experience, +${gold2(result.delta.gold)} gold`);
      if (result.strike) {
        strikeFlight(row, result.strike.amount);
        announce(`Boss took ${tenths1(result.strike.amount)} damage`);
      }
    } else {
      announce(`${task.title} scored down: you lost ${tenths1(Math.abs(result.delta.health))} health`);
    }
  } catch (error) {
    reportFailure(error);
  }
}

export async function buyReward(task: Task): Promise<void> {
  showAlert(null);
  try {
    const result = await api.buy(task.id);
    applyResult(result);
    announce(`${task.title} bought for ${gold2(Math.abs(result.delta.gold))} gold`);
  } catch (error) {
    reportFailure(error);
  }
}

export async function moveTask(task: Task, position: number, total: number): Promise<void> {
  showAlert(null);
  try {
    await api.moveTask(task.id, position);
    set({ tasks: await api.tasks() });
    announce(`${task.title} moved to position ${position} of ${total}`);
  } catch (error) {
    reportFailure(error);
  }
}

export async function checkItem(task: Task, itemId: string, checked: boolean): Promise<void> {
  showAlert(null);
  try {
    await api.checkItem(task.id, itemId, checked);
    set({ tasks: await api.tasks() });
  } catch (error) {
    reportFailure(error);
  }
}

export async function refreshTasks(): Promise<void> {
  set({ tasks: await api.tasks() });
}

export async function refreshParty(): Promise<void> {
  const answer = await api.party();
  set({ party: answer.party });
  if (answer.party) {
    set({ chat: (await api.chat(answer.party.id)).messages });
    set({ quest: answer.party.questId ? await api.quest(answer.party.questId) : null });
  } else {
    set({ quest: null, chat: [] });
  }
}

export async function refreshInvites(): Promise<void> {
  set({ invites: (await api.invites()).invites });
}

export async function refreshPlayer(): Promise<void> {
  applyPlayer(await api.me());
}

export function setQuest(quest: Quest | null): void {
  set({ quest });
}

export function resetSession(): void {
  shownNotices.clear();
  seenStrikes.clear();
  state = {
    ready: false,
    player: null,
    tasks: emptyLists,
    party: null,
    quest: null,
    invites: [],
    chat: [],
    fixtures: [],
    feed: [],
    alert: null,
    notice: null,
  };
  for (const listener of listeners) listener();
}
