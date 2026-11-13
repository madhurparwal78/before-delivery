import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { COPY } from "../../shared/messages";
import type { Program, ProgramDetail } from "../../shared/types";
import { useSelect } from "../lib/store";
import { Unreachable, api } from "../lib/api";
import { accountId, app, isOffline } from "../state/model";
import { commit, refreshPrograms } from "../state/refresh";
import { localProgress } from "../state/effective";
import { useEffective } from "../state/lookup";
import { RingIcon } from "../ui/icons";
import { Skeleton, WorkingScreen } from "../ui/layout";
import { handleUnauthorized } from "../state/unauth";

/** Counts for a program: the server's answer, or the device's own computation while offline or with changes queued. */
function useProgramCounts() {
  const eff = useEffective();
  const details = useSelect(app, (s) => s.server.programDetails);
  const offline = useSelect(app, (s) => isOffline(s));
  const waiting = useSelect(app, (s) => s.journal.length);
  const local = offline || waiting > 0;
  return (program: Program) => {
    const detail: ProgramDetail | undefined = details[program.id];
    if (local && detail) {
      const computed = localProgress(detail, eff);
      return { qualifying: computed.qualifying, total: program.progress.total, required: program.progress.required };
    }
    return program.progress;
  };
}

export function ProgramsScreen() {
  const programs = useSelect(app, (s) => s.server.programs);
  const counts = useProgramCounts();
  const [message, setMessage] = useState("");
  const [wanted, setWanted] = useState<Record<string, boolean>>({});
  const inflight = useRef<Record<string, boolean>>({});
  const wantedRef = useRef<Record<string, boolean>>({});
  const press = useRef(0);
  const lastPress = useRef<Record<string, number>>({});

  useLayoutEffect(() => {
    void refreshPrograms();
  }, []);

  const following = (p: Program) => (p.id in wanted ? wanted[p.id]! : p.following);

  const send = async (program: Program) => {
    const account = accountId();
    if (inflight.current[program.id] || !account) return;
    inflight.current[program.id] = true;
    const mine = lastPress.current[program.id] ?? 0;
    const want = wantedRef.current[program.id] ?? program.following;
    try {
      const answer = await api<{ following?: boolean }>(want ? "POST" : "DELETE", `/api/programs/${program.id}/follow`);
      if (!app.get().reachable) app.set({ reachable: true });
      if (answer.status === 401) handleUnauthorized();
      const confirmed = answer.status === 200 ? Boolean(answer.body.following) : null;
      if (confirmed !== null) {
        await commit(
          account,
          (s) => ({ ...s, programs: (s.programs ?? []).map((p) => (p.id === program.id ? { ...p, following: confirmed } : p)) }),
          { singles: ["programs"] },
        );
      }
      const newest = wantedRef.current[program.id] ?? want;
      inflight.current[program.id] = false;
      if (confirmed !== null && newest !== confirmed) return void send(app.get().server.programs!.find((p) => p.id === program.id) ?? program);
      if (confirmed !== null) {
        if (lastPress.current[program.id] === mine) setMessage(confirmed ? COPY.following(program.name) : COPY.unfollowed(program.name));
        setWanted((w) => {
          const { [program.id]: _gone, ...rest } = w;
          return rest;
        });
        delete wantedRef.current[program.id];
      } else {
        delete wantedRef.current[program.id];
        setWanted((w) => {
          const { [program.id]: _gone, ...rest } = w;
          return rest;
        });
        setMessage(COPY.serverError);
      }
    } catch (error) {
      if (!(error instanceof Unreachable)) throw error;
      app.set({ reachable: false });
      inflight.current[program.id] = false;
      delete wantedRef.current[program.id];
      setWanted((w) => {
        const { [program.id]: _gone, ...rest } = w;
        return rest;
      });
      setMessage(COPY.followNoSignal(program.name));
    }
  };

  const toggle = (program: Program) => {
    const next = !following(program);
    press.current += 1;
    lastPress.current[program.id] = press.current;
    wantedRef.current[program.id] = next;
    setWanted((w) => ({ ...w, [program.id]: next }));
    setMessage("");
    void send(program);
  };

  const mine = (programs ?? []).filter(following);
  const others = (programs ?? []).filter((p) => !following(p));

  const row = (p: Program) => {
    const c = counts(p);
    return (
      <li key={p.id} class="program-row">
        <div class="program-main">
          <a class="row-link ink" href={`/programs/${p.id}`}>
            {p.name}
          </a>
          <span class="muted">{COPY.counts(c.qualifying, c.total, c.required)}</span>
        </div>
        <button type="button" class="btn row-action" onClick={() => toggle(p)}>
          {following(p) ? `Unfollow ${p.name}` : `Follow ${p.name}`}
        </button>
      </li>
    );
  };

  return (
    <WorkingScreen heading="Programs">
      <div role="status" aria-label="Programs status" class="sentences">
        {message ? <p class="sentence">{message}</p> : null}
      </div>
      <h2>Your programs</h2>
      {programs === null ? (
        <Skeleton rows={2} />
      ) : mine.length > 0 ? (
        <ul class="rows" aria-label="Your programs">
          {mine.map(row)}
        </ul>
      ) : (
        <div class="empty">
          <RingIcon />
          <p class="sentence">{COPY.emptyPrograms}</p>
        </div>
      )}
      <h2>All programs</h2>
      {programs === null ? (
        <Skeleton rows={2} />
      ) : (
        <ul class="rows" aria-label="All programs">
          {others.map(row)}
        </ul>
      )}
    </WorkingScreen>
  );
}

