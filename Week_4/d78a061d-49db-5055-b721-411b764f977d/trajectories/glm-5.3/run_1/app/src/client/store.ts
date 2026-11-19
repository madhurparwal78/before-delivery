import { getJson, type Account, type Character, type SessionSnapshot, type Party, type ChatMessage, type Story } from './api-client.js';

export type Store = {
  account: Account | null;
  equippedCharacter: Character | null;
  party: Party | null;
  stories: Story[];
  notifications: string;
  chat: {
    draft: string;
    open: boolean;
    messages: ChatMessage[];
    status: string;
    lastSeq: Record<string, number>;
    pending: { channel: string; clientMessageId: string; body: string }[];
  };
};

export const store: Store = {
  account: null,
  equippedCharacter: null,
  party: null,
  stories: [],
  notifications: '',
  chat: { draft: '', open: false, messages: [], status: '', lastSeq: {}, pending: [] },
};

export async function loadMe(): Promise<void> {
  const me = await getJson<{ account: Account; equipped_character_id: string | null }>('/api/me');
  store.account = me?.account ?? null;
  if (me?.equipped_character_id) {
    const res = await getJson<{ character: Character }>(`/api/characters/${me.equipped_character_id}`);
    store.equippedCharacter = res?.character ?? null;
  } else {
    const list = await getJson<{ characters: Character[] }>('/api/characters');
    store.equippedCharacter = list?.characters.find((c) => c.equipped) ?? null;
  }
}

export async function loadParty(): Promise<void> {
  const res = await getJson<{ party: Party | null }>('/api/parties/current');
  store.party = res?.party ?? null;
}

export async function loadStories(): Promise<void> {
  const res = await getJson<{ stories: Story[] }>('/api/stories');
  store.stories = res?.stories ?? [];
}

export function notify(text: string): void {
  store.notifications = text;
  const region = document.getElementById('notifications');
  if (region) region.textContent = text;
}
