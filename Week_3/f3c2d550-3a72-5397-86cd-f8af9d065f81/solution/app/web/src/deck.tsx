import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Settings, Status } from "../../shared/api";
import type { SizeUnit } from "../../shared/sizes";
import { api } from "./api";

const STATUS_POLL_MS = 5_000;

export const COPY = {
  capturePending: "Saving the original to storage.",
  captureSaved: "Saved to your deck.",
  checkFields: "Check the highlighted fields.",
  captureInFlight: "This save is still in progress. Wait for it to finish.",
  storageRefused: "The photograph could not be stored, so nothing was saved. Try again when storage returns.",
  factsPending: "Saving facts.",
  factsSaved: "Facts saved.",
  factsConflict: "This reference changed in another window. Reloaded the latest facts.",
  measuring: "Measuring the swatch.",
  swatchSet: "Swatch set from the photo.",
  swatchReset: "Swatch reset to the measured colour.",
  reelFull: "A reel holds at most 60 stops.",
  reelConflict: "This reel changed in another window. Reloaded the latest order.",
  reelCreated: "Reel created.",
  sheetQueued: "Contact sheet queued.",
  sheetReady: "Contact sheet ready.",
  sheetFailed: "The contact sheet could not be rendered.",
  sheetEmpty: "Add at least one reference before printing.",
  restoreClosed: "The restore window for this reference has closed. It has been purged from your library.",
  generic: "Something went wrong. Try again.",
  noMatches: "No references match that search.",
  emptyReel: "This reel has no stops yet. Add references from your library.",
  emptyLibrary: "Your deck is empty. Capture your first object to start.",
  emptyTrash: "The trash is empty.",
  loading: "Opening your deck.",
  unknown: "This reference isn't in your deck.",
  photoUnavailable: "Photo unavailable while storage is offline.",
} as const;

export const BANNERS = {
  search: "Search is offline. Showing simple matches from your library until it returns.",
  storage: "Storage is offline. New captures can't be saved until it returns.",
  printing: "Printing is offline. Contact sheets wait in the queue until it returns.",
} as const;

interface DeckContext {
  message: string;
  say: (message: string) => void;
  unit: SizeUnit;
  setUnit: (unit: SizeUnit) => void;
  services: Status["services"] | null;
}

const Deck = createContext<DeckContext | null>(null);

export function DeckProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  const [unit, setUnit] = useState<SizeUnit>("mm");
  const [services, setServices] = useState<Status["services"] | null>(null);
  const say = useCallback((next: string) => setMessage(next), []);

  useEffect(() => {
    api<Settings>("GET", "/settings").then(
      (settings) => setUnit(settings.unit),
      () => undefined,
    );
  }, []);

  useEffect(() => {
    const poll = () => {
      api<Status>("GET", "/status").then(
        (status) => setServices(status.services),
        () => undefined,
      );
    };
    poll();
    const timer = window.setInterval(poll, STATUS_POLL_MS);
    return () => window.clearInterval(timer);
  }, []);

  const value = useMemo(() => ({ message, say, unit, setUnit, services }), [message, say, unit, services]);
  return <Deck.Provider value={value}>{children}</Deck.Provider>;
}

export function useDeck(): DeckContext {
  const value = useContext(Deck);
  if (!value) throw new Error("DeckProvider is missing");
  return value;
}
