import { useEffect, useRef, useState, createContext, useContext, type ReactNode } from 'react';
import { api, type Player, type TasksBody, type Party, type Quest, type ChatMessage, type ImportRecord, type Notice } from './api.js';

export interface Store {
  player: Player | null;
  tasks: TasksBody;
  party: Party | null;
  quest: Quest | null;
  invites: { id: string; partyId: string; partyName: string; from: string }[];
  chat: ChatMessage[];
  feed: string;
  notices: Notice[];
  setFeed: (s: string) => void;
  refreshAll: () => Promise<void>;
}

const StoreCtx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(StoreCtx);
  if (!s) throw new Error('store missing');
  return s;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [player, setPlayer] = useState<Player | null>(null);
  const [tasks, setTasks] = useState<TasksBody>({ habits: [], dailies: [], todos: [], rewards: [] });
  const [party, setParty] = useState<Party | null>(null);
  const [quest, setQuest] = useState<Quest | null>(null);
  const [invites, setInvites] = useState<{ id: string; partyId: string; partyName: string; from: string }[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [feed, setFeed] = useState('');
  const [noticeQueue, setNoticeQueue] = useState<Notice[]>([]);
  const seenNotices = useRef<Set<string>>(new Set());
  const booted = useRef(false);

  const refreshAll = async () => {
    const me = await api.me();
    setPlayer(me);
    const t = await api.tasks();
    setTasks(t);
    const p = await api.party();
    setParty(p.party);
    const inv = await api.invites();
    setInvites(inv.invites);
    if (p.party) {
      const c = await api.chat(p.party.id);
      setChat(c.messages);
      if (p.party.questId) {
        const q = await api.quest(p.party.questId);
        setQuest(q);
      } else {
        setQuest(null);
      }
    } else {
      setChat([]);
      setQuest(null);
    }
  };

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void refreshAll().catch(() => {
      // unauthenticated: stay signed out
    });
  }, []);

  // The live stream: every published change arrives here.
  useEffect(() => {
    if (!player) return;
    const es = new EventSource('/api/live');
    es.addEventListener('player', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as Player;
      setPlayer(data);
    });
    es.addEventListener('tasks', (e) => {
      setTasks(JSON.parse((e as MessageEvent).data) as TasksBody);
    });
    es.addEventListener('party', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { party: Party | null };
      setParty(data.party);
      if (data.party) {
        void api.chat(data.party.id).then((c) => setChat(c.messages));
        if (data.party.questId) {
          void api.quest(data.party.questId).then((q) => setQuest(q));
        } else {
          setQuest(null);
        }
      } else {
        setQuest(null);
        setChat([]);
      }
    });
    es.addEventListener('invite', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { invites: typeof invites };
      setInvites(data.invites);
    });
    es.addEventListener('quest', (e) => {
      setQuest(JSON.parse((e as MessageEvent).data) as Quest);
    });
    es.addEventListener('chat', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as ChatMessage & { partyId: string };
      setChat((prev) => (prev.some((m) => m.id === data.id) ? prev : [...prev, data]));
    });
    es.addEventListener('banner', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { partyId: string; bannerUrl: string };
      setParty((prev) => (prev && prev.id === data.partyId ? { ...prev, bannerUrl: data.bannerUrl } : prev));
    });
    es.addEventListener('strike', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as Quest['events'][number] & { questId: string };
      // strike events arrive with the quest event; refresh quest to get events
      void api.quest(data.questId).then((q) => setQuest(q)).catch(() => {});
      if (data.username !== player.username) {
        setFeed(`${data.username} hit the boss for ${data.amount.toFixed(1)} damage`);
      }
    });
    es.addEventListener('notice', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as Notice;
      setNoticeQueue((prev) => [...prev, data]);
    });
    return () => es.close();
  }, [player?.id]);

  // Notices from the player payload (page load or live)
  useEffect(() => {
    if (!player) return;
    const fresh = player.notices.filter((n) => !seenNotices.current.has(n.id));
    for (const n of fresh) seenNotices.current.add(n.id);
    if (fresh.length > 0) setNoticeQueue((prev) => [...prev, ...fresh]);
  }, [player?.notices]);

  const store: Store = {
    player,
    tasks,
    party,
    quest,
    invites,
    chat,
    feed,
    notices: noticeQueue,
    setFeed,
    refreshAll,
  };
  return <StoreCtx.Provider value={store}>{children}</StoreCtx.Provider>;
}
