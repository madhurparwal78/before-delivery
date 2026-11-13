import { useLayoutEffect, useState } from "preact/hooks";
import type { Level } from "../shared/levels";
import type { Game } from "../shared/protocol";
import { announce } from "./announcer";
import { ApiFailure, post } from "./api";
import { failureSentence, M56 } from "./messages";
import { navigate } from "./router";

type Loaded<Value> = { status: "loading" } | { status: "failed"; error: ApiFailure } | { status: "ready"; value: Value };

/** Runs `load` when the page mounts or `key` changes; layout effects, because the page clock may be paused. */
export function useLoad<Value>(load: () => Promise<Value>, key: string): Loaded<Value> {
  const [loaded, setLoaded] = useState<Loaded<Value>>({ status: "loading" });
  useLayoutEffect(() => {
    let current = true;
    setLoaded({ status: "loading" });
    load().then(
      (value) => current && setLoaded({ status: "ready", value }),
      (error: unknown) => current && setLoaded({ status: "failed", error: error instanceof ApiFailure ? error : new ApiFailure(0, "NETWORK") }),
    );
    return () => {
      current = false;
    };
  }, [key]);
  return loaded;
}

interface StartGame {
  pending: boolean;
  failure: string | null;
  start: (level: Level) => void;
}

/** Starts a new solo game at a level and opens it; a second press while the request is in flight sends nothing. */
export function useStartGame(): StartGame {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const start = (level: Level): void => {
    if (pending) return;
    setPending(true);
    setFailure(null);
    post<{ game: Game }>("/api/games", { level }).then(
      ({ game }) => navigate(`/play/${game.id}`),
      (error: unknown) => {
        const sentence = error instanceof ApiFailure ? failureSentence(error) : M56;
        setPending(false);
        setFailure(sentence);
        announce(sentence);
      },
    );
  };
  return { pending, failure, start };
}
