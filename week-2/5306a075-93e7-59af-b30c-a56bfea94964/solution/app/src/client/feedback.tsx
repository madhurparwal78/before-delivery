// The page's live regions (brief: Feedback states): "Save status", "Evidence announcements",
// "Board announcements" and the one alert, shown in a reserved slot under the top bar.
import { AlertCircle, Check } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiFailure, onPendingChange } from "./api.js";
import { prefersReducedMotion } from "./motion.js";

type Channel = "save" | "evidence" | "board";
const GENERIC_FAILURE = "Something went wrong on our side. Nothing was saved.";

interface Messages {
  messages: Record<Channel, { text: string; n: number }>;
  latest: Channel;
  alertText: { text: string; n: number };
}

interface Feedback {
  say(channel: Channel, text: string): void;
  warn(text: string): void;
  clearAlert(): void;
  /** Puts a failed request's message in the alert: a 5xx gets the generic copy, any other refusal its own words. */
  fail(error: unknown, copy?: (failure: ApiFailure) => string | null): void;
}

const FeedbackContext = createContext<Feedback | null>(null);
const MessagesContext = createContext<Messages | null>(null);

export function useFeedback(): Feedback {
  const feedback = useContext(FeedbackContext);
  if (!feedback) throw new Error("FeedbackProvider is missing");
  return feedback;
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<Record<Channel, { text: string; n: number }>>({
    save: { text: "", n: 0 }, evidence: { text: "", n: 0 }, board: { text: "", n: 0 },
  });
  const [latest, setLatest] = useState<Channel>("save");
  const [alertText, setAlertText] = useState({ text: "", n: 0 });

  const say = useCallback((channel: Channel, text: string) => {
    setMessages((m) => ({ ...m, [channel]: { text, n: m[channel].n + 1 } }));
    setLatest(channel);
  }, []);
  const warn = useCallback((text: string) => setAlertText((a) => ({ text, n: a.n + 1 })), []);
  const clearAlert = useCallback(() => setAlertText((a) => (a.text === "" ? a : { text: "", n: a.n + 1 })), []);
  const fail = useCallback((error: unknown, copy?: (failure: ApiFailure) => string | null) => {
    if (error instanceof ApiFailure) {
      if (error.status === 401) return;
      warn(error.status >= 500 && error.code !== "storage_unavailable" ? GENERIC_FAILURE : copy?.(error) ?? error.message);
    } else {
      warn(GENERIC_FAILURE);
    }
  }, [warn]);
  const value = useMemo(() => ({ say, warn, clearAlert, fail }), [say, warn, clearAlert, fail]);

  const shown = useMemo(() => ({ messages, latest, alertText }), [messages, latest, alertText]);
  return (
    <FeedbackContext.Provider value={value}>
      <MessagesContext.Provider value={shown}>{children}</MessagesContext.Provider>
    </FeedbackContext.Provider>
  );
}

const LABELS: Record<Channel, string> = { save: "Save status", evidence: "Evidence announcements", board: "Board announcements" };

/** The reserved, fixed-height slot under the top bar; every layout renders it once. */
export function MessageSlot() {
  const shown = useContext(MessagesContext);
  if (!shown) return null;
  const { messages, latest, alertText } = shown;
  return (
    <div className="message-slot">
      {(["save", "evidence", "board"] as const).map((channel) => (
        <p key={channel} role="status" aria-label={LABELS[channel]}
          className={`message ${latest === channel && messages[channel].text && !alertText.text ? "" : "visually-hidden"}`}>
          {messages[channel].text && <Check aria-hidden="true" size={16} />}
          <span key={messages[channel].n}>{messages[channel].text}</span>
        </p>
      ))}
      <p role="alert" className={`message message-alert ${alertText.text ? "" : "visually-hidden"}`}>
        {alertText.text && <AlertCircle aria-hidden="true" size={16} />}
        <span key={alertText.n}>{alertText.text}</span>
      </p>
    </div>
  );
}

/** The thin cobalt bar under the top bar while any request has taken longer than 0.3 s. */
export function ProgressBar() {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return onPendingChange((pending) => {
      clearTimeout(timer);
      if (pending === 0) setBusy(false);
      else timer = setTimeout(() => setBusy(true), 300);
    });
  }, []);
  if (!busy || prefersReducedMotion()) return null;
  return <div className="progress" aria-hidden="true"><span /></div>;
}
