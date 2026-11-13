import { Store, useStore } from "./store";

type BannerKind = "storage" | "queue" | "mail";

interface NoticeState {
  message: string;
  banners: Record<BannerKind, string | null>;
}

const store = new Store<NoticeState>({ message: "", banners: { storage: null, queue: null, mail: null } });

/** The result of the person's own action, shown in the Notices strip. */
export function notify(message: string): void {
  store.update((state) => ({ ...state, message }));
}

export function setBanner(kind: BannerKind, text: string | null): void {
  store.update((state) => ({ ...state, banners: { ...state.banners, [kind]: text } }));
}

export function clearNotices(): void {
  store.set({ message: "", banners: { storage: null, queue: null, mail: null } });
}

export const useNotices = (): NoticeState => useStore(store);
