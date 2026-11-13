import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Round, RoundsResponse, Table } from "../shared/api-types";
import tokens from "../shared/tokens.json";
import { Unreachable, get } from "./api";
import { COPY } from "./copy";
import { useMessages } from "./messages";

interface League {
  rounds: Round[] | null;
  night: number | null;
  table: Table | null;
  /** Counts completed polls; countdowns re-sync from the server on every change. */
  syncs: number;
  /** An action response is as good as a poll for the round it names. */
  takeRound: (round: Round) => void;
  takeTable: (table: Table) => void;
  refresh: () => Promise<void>;
}

const LeagueContext = createContext<League | null>(null);

export function useLeague(): League {
  const league = useContext(LeagueContext);
  if (league === null) throw new Error("LeagueProvider is missing");
  return league;
}

/** Runs `load` now and then at the polling delay, never overlapping itself. */
export function usePolling(load: () => Promise<void>, deps: readonly unknown[] = []): void {
  const running = useRef(false);
  useEffect(() => {
    const run = async () => {
      if (running.current) return;
      running.current = true;
      try {
        await load();
      } finally {
        running.current = false;
      }
    };
    void run();
    const timer = window.setInterval(() => void run(), tokens.ms.poll);
    return () => window.clearInterval(timer);
  }, deps);
}

export function LeagueProvider({ children }: { children: ReactNode }) {
  const [rounds, setRounds] = useState<Round[] | null>(null);
  const [night, setNight] = useState<number | null>(null);
  const [table, setTable] = useState<Table | null>(null);
  const [syncs, setSyncs] = useState(0);
  const messages = useMessages();

  const takeTable = useCallback((incoming: Table) => {
    setTable((existing) => (existing !== null && incoming.version < existing.version ? existing : incoming));
  }, []);
  const takeRound = useCallback((round: Round) => {
    setRounds((existing) => existing?.map((entry) => (entry.number === round.number ? round : entry)) ?? existing);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [roundsReply, tableReply] = await Promise.all([
        get<RoundsResponse>("/api/rounds"),
        get<Table>("/api/table"),
      ]);
      if (!roundsReply.ok || !tableReply.ok) {
        messages.say(COPY.unreachable, "error");
        return;
      }
      setRounds(roundsReply.data.rounds);
      setNight(roundsReply.data.night);
      takeTable(tableReply.data);
      setSyncs((count) => count + 1);
    } catch (error) {
      if (!(error instanceof Unreachable)) throw error;
      messages.say(COPY.unreachable, "error");
    }
  }, [messages, takeTable]);

  usePolling(refresh, [refresh]);

  const value = useMemo(
    () => ({ rounds, night, table, syncs, takeRound, takeTable, refresh }),
    [rounds, night, table, syncs, takeRound, takeTable, refresh],
  );
  return <LeagueContext.Provider value={value}>{children}</LeagueContext.Provider>;
}
