// <main> for every page.
//   <Main band? hero? class? project? pageKeys?>   <main tabIndex={-1}> without data attributes. `band` puts the page on the light
//       band (settings, issues, boards, wiki editor ...). With `project={id}` it also loads the project (useProject, useRole),
//       follows its live socket for `role` messages and announcements, and swaps the content for the access-lost text.
//   <LiveMain project pageKeys? band? ...>        same, plus data-seq and data-pending. Use it on merge request pages, board,
//       pipeline and job pages, editor, train and wiki.
//         data-seq      highest live seq whose effects are applied: every reload started by a message with a seq at or below
//                       it (useLiveResource, useLivePage().begin) has finished
//         data-pending  number of non-GET requests in flight
//   pageKeys declare which announcements this page shows: a message's `say` entries are announced when they have no `pages`, or
//   one of their `pages` is listed here, and `to` is absent or is the signed-in username.
//   Live roles: a `role` message for the signed-in user announces `Your role in <path> is now <role>.` (controls follow
//   useRole()), or with role null replaces the content with `You no longer have access to <path>.` and announces it. If the
//   focused control disappears, <main> takes focus.
import type { ComponentChildren } from "preact";
import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { announce } from "../announce.tsx";
import { usePending } from "../api.ts";
import { LivePageContext, type LiveMessage, startChannel, subscribeProject } from "../live.ts";
import { applyRole, loadProject, projectStore, resetProject } from "../role.ts";
import { useUser } from "../session.ts";
import { useStore } from "../store.ts";
import { asString } from "../util.ts";

interface MainProps {
  band?: boolean;
  class?: string;
  project?: string | number;
  pageKeys?: readonly string[];
  children?: ComponentChildren;
}

function classes(props: MainProps): string {
  return `sp-main${props.band ? " sp-main--band sp-light" : ""}${props.class ? ` ${props.class}` : ""}`;
}

function createTracker(apply: (seq: number) => void) {
  let received = 0;
  let applied = 0;
  const inflight = new Map<number, number>();
  const recompute = () => {
    let next = received;
    for (const seq of inflight.keys()) next = Math.min(next, seq - 1);
    if (next > applied) {
      applied = next;
      apply(applied);
    }
  };
  return {
    snapshot(seq: number) {
      received = Math.max(received, seq);
      recompute();
    },
    received(seq: number) {
      received = Math.max(received, seq);
      recompute();
    },
    begin(seq: number) {
      inflight.set(seq, (inflight.get(seq) ?? 0) + 1);
      let finished = false;
      return () => {
        if (finished) return;
        finished = true;
        const left = (inflight.get(seq) ?? 1) - 1;
        if (left <= 0) inflight.delete(seq);
        else inflight.set(seq, left);
        recompute();
      };
    },
  };
}

function ProjectMain(props: MainProps & { project: string | number; live: boolean }) {
  const id = String(props.project);
  const pending = usePending();
  const me = useUser();
  const state = useStore(projectStore);
  const [applied, setApplied] = useState(0);
  const main = useRef<HTMLElement>(null);
  const tracker = useMemo(() => createTracker(setApplied), [id]);
  const latest = useRef({ keys: props.pageKeys ?? [], username: me?.username ?? null });
  latest.current = { keys: props.pageKeys ?? [], username: me?.username ?? null };
  const refocus = useRef(false);
  const denied = state.denied && state.id === id;
  const stop = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    let alive = true;
    resetProject(id);
    const unsubscribe = subscribeProject(id, {
      onMessage(message: LiveMessage) {
        if (projectStore.get().denied) return;
        const { keys, username } = latest.current;
        for (const say of message.data.say ?? []) {
          if (say.to !== undefined && say.to !== username) continue;
          if (say.pages !== undefined && say.pages.length > 0 && !say.pages.some((key) => keys.includes(key))) continue;
          announce(say.text);
        }
        if (message.type === "role" && "role" in message.data && username !== null && asString(message.data.username) === username) {
          const role = message.data.role === null ? null : asString(message.data.role);
          const path = asString(message.data.path) ?? projectStore.get().path;
          refocus.current = main.current?.contains(document.activeElement) ?? false;
          applyRole(role, asString(message.data.path));
          if (role === null) {
            announce(`You no longer have access to ${path ?? "this project"}.`);
            stop.current?.();
            stop.current = null;
          } else {
            announce(`Your role in ${path ?? "this project"} is now ${role}.`);
            void loadProject(id);
          }
        }
      },
      onDispatched(message) {
        if (message.seq !== null) tracker.received(message.seq);
      },
    });
    void loadProject(id).then((seq) => {
      if (!alive || projectStore.get().error || projectStore.get().denied) return;
      if (seq !== null) tracker.snapshot(seq);
      stop.current = startChannel(id, seq);
    });
    return () => {
      alive = false;
      unsubscribe();
      stop.current?.();
      stop.current = null;
    };
  }, [id]);

  // When the focused control leaves the page because the role shrank, <main> takes focus (Mutation callbacks are microtasks).
  useLayoutEffect(() => {
    const element = main.current;
    if (!element) return;
    const check = () => {
      if (!refocus.current) return;
      const active = document.activeElement;
      if (!active || active === document.body || !element.contains(active)) {
        refocus.current = false;
        element.focus();
      }
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(element, { childList: true, subtree: true });
    const clear = () => {
      refocus.current = false;
    };
    document.addEventListener("focusin", clear);
    return () => {
      observer.disconnect();
      document.removeEventListener("focusin", clear);
    };
  }, []);

  const page = useMemo(() => ({ project: id, begin: tracker.begin }), [id, tracker]);
  const live = props.live;
  return (
    <LivePageContext.Provider value={page}>
      <main ref={main} tabIndex={-1} class={classes(props)} data-seq={live ? applied : undefined} data-pending={live ? pending : undefined}>
        {denied ? <p class="sp-denied">{`You no longer have access to ${state.path ?? "this project"}.`}</p> : props.children}
      </main>
    </LivePageContext.Provider>
  );
}

export function Main(props: MainProps) {
  if (props.project !== undefined) return <ProjectMain {...props} project={props.project} live={false} />;
  return (
    <main tabIndex={-1} class={classes(props)}>
      {props.children}
    </main>
  );
}

export function LiveMain(props: MainProps & { project: string | number }) {
  return <ProjectMain {...props} live />;
}
