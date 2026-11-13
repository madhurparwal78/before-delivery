import type { ChatMessage, Invite, Party, Player, Quest, StrikeEvent, TaskLists } from "../shared/api";
import { api } from "./api";
import { say } from "./feed";
import { hundredths, tenths } from "./format";
import { getState, setState } from "./store";

const announced = new Set<string>();
/** Own strikes that arrived while this device's own action was still waiting for its reply. */
let deferred: (StrikeEvent & { questId: string })[] = [];
let strikingActions = 0;

export function announceOwnStrike(event: StrikeEvent): void {
  if (announced.has(event.id)) return;
  announced.add(event.id);
  say(`Boss took ${tenths(event.amount)} damage`);
}

export function beginStrikingAction(): void {
  strikingActions += 1;
}

export const strikeInFlight = (): boolean => strikingActions > 0;

export function endStrikingAction(): void {
  strikingActions -= 1;
  if (strikingActions > 0) return;
  const rest = deferred;
  deferred = [];
  for (const event of rest) announceOwnStrike(event);
}

function onStrike(event: StrikeEvent & { questId: string }): void {
  const { me, quest } = getState();
  if (!me || announced.has(event.id)) return;
  if (event.kind === "strikeback") {
    announced.add(event.id);
    if (!me.resting && quest) say(`${quest.boss} struck back: you lost ${tenths(event.amount)} health`);
    return;
  }
  if (event.username !== me.username) {
    announced.add(event.id);
    say(`${event.username} hit the boss for ${tenths(event.amount)} damage`);
  } else if (strikingActions > 0) deferred.push(event);
  else announceOwnStrike(event);
}

function onQuest(next: Quest): void {
  const { quest: previous, fixtures } = getState();
  setState({ quest: next.state === "abandoned" ? null : next });
  if (previous?.id === next.id && previous.state === "active" && next.state === "defeated") {
    const fixture = fixtures.find((candidate) => candidate.name === next.name);
    if (fixture) say(`Quest complete: +${hundredths(fixture.rewardGold)} gold, +${fixture.rewardExperience} experience`);
  }
}

function onChat(message: ChatMessage & { partyId: string }): void {
  const { chat, party } = getState();
  if (party && party.id === message.partyId && !chat.some((known) => known.id === message.id)) setState({ chat: [...chat, message] });
}

/** Open the one live stream: every change to this player's lists, totals, party and quest arrives here. */
export function connectLive(): () => void {
  const source = new EventSource("/api/live");
  const on = <T>(name: string, handle: (data: T) => void): void =>
    source.addEventListener(name, (event) => handle(JSON.parse((event as MessageEvent<string>).data) as T));
  on<Player>("player", (me) => setState({ me }));
  on<TaskLists>("tasks", (tasks) => setState({ tasks }));
  on<Party | { party: null }>("party", (data) => {
    const party = "party" in data ? null : data;
    setState((current) => ({ party, ...(party === null ? { quest: null, chat: [] } : current.party?.id === party.id ? {} : { chat: [] }) }));
  });
  on<{ invites: Invite[] }>("invite", ({ invites }) => setState({ invites }));
  on<Quest>("quest", onQuest);
  on<StrikeEvent & { questId: string }>("strike", onStrike);
  on<ChatMessage & { partyId: string }>("chat", onChat);
  on<{ partyId: string; bannerUrl: string | null }>("banner", ({ partyId, bannerUrl }) =>
    setState((current) => (current.party && current.party.id === partyId ? { party: { ...current.party, bannerUrl } } : {})),
  );
  return () => source.close();
}

export async function loadChat(partyId: string): Promise<void> {
  const { messages } = await api<{ messages: ChatMessage[] }>("GET", `/api/parties/${partyId}/chat`);
  setState((current) => {
    const fresh = current.chat.filter((live) => !messages.some((known) => known.id === live.id));
    return current.party?.id === partyId ? { chat: [...messages, ...fresh] } : {};
  });
}
