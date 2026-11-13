import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Dispute } from "../shared/api-types";
import { Unreachable, get } from "./api";
import { COPY, disputeRuled } from "./copy";
import { usePolling } from "./league";
import { useMessages } from "./messages";
import { useSession } from "./session";

interface Disputes {
  disputes: Dispute[] | null;
  /** An action response is as good as a poll for the dispute it names. */
  take: (dispute: Dispute) => void;
  refresh: () => Promise<void>;
}

const DisputesContext = createContext<Disputes | null>(null);

export function useDisputes(): Disputes {
  const disputes = useContext(DisputesContext);
  if (disputes === null) throw new Error("DisputesProvider is missing");
  return disputes;
}

const HEARD_KEY = "rulings-heard";

/** Rulings this screen has already announced; they survive a reload of the tab. */
function heardRulings(): Set<number> {
  return new Set(JSON.parse(sessionStorage.getItem(HEARD_KEY) ?? "[]") as number[]);
}

/**
 * A captain's disputes, read at the polling delay. The dispute-ruled copy shows once per ruling:
 * the first time a poll finds a ruling this screen has not announced (the latest, when several arrive).
 */
export function DisputesProvider({ children }: { children: ReactNode }) {
  const { state } = useSession();
  const messages = useMessages();
  const [disputes, setDisputes] = useState<Dispute[] | null>(null);
  const captain = state.status === "in" && state.info.role === "captain";

  const merge = useCallback(
    (incoming: Dispute[]) => {
      const heard = heardRulings();
      const fresh = incoming.filter((dispute) => dispute.status !== "raised" && !heard.has(dispute.id));
      const latest = fresh[fresh.length - 1];
      if (latest !== undefined) {
        messages.say(disputeRuled(latest.status, latest.round, latest.question));
        for (const dispute of fresh) heard.add(dispute.id);
        sessionStorage.setItem(HEARD_KEY, JSON.stringify([...heard]));
      }
      setDisputes(incoming);
    },
    [messages],
  );

  const refresh = useCallback(async () => {
    if (!captain) return;
    try {
      const reply = await get<{ disputes: Dispute[] }>("/api/disputes");
      if (reply.ok) merge(reply.data.disputes);
      else if (reply.status >= 500) messages.say(COPY.unreachable, "error");
    } catch (error) {
      if (!(error instanceof Unreachable)) throw error;
      messages.say(COPY.unreachable, "error");
    }
  }, [captain, merge, messages]);

  usePolling(refresh, [refresh]);

  const take = useCallback((dispute: Dispute) => {
    setDisputes((existing) => [...(existing ?? []).filter((entry) => entry.id !== dispute.id), dispute]);
  }, []);

  const value = useMemo(() => ({ disputes, take, refresh }), [disputes, take, refresh]);
  return <DisputesContext.Provider value={value}>{children}</DisputesContext.Provider>;
}
