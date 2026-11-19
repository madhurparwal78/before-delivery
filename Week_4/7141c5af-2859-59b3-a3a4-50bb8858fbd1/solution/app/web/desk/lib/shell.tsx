import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { copy } from "../../../server/domain/copy.ts";
import { glyph } from "../../shared/dots.ts";
import { onFocusTaken } from "../../shared/focusView.ts";
import { announce } from "./announce.ts";
import { ApiFailure, api, get, onSessionEnded, post } from "./api.ts";
import { Dialog, useDialog } from "./dialog.tsx";
import { keepDrafts } from "./drafts.ts";
import { AsyncButton, Field, Problems, useForm } from "./forms.tsx";
import { onRefreshState, useLive } from "./live.ts";
import { currentAddress, useLocation } from "./router.tsx";
import { type DeskSession, SessionContext } from "./screen.tsx";

const LINKS = [
  ["/pieces", "Pieces"],
  ["/clients", "Clients"],
  ["/library", "Library"],
  ["/bench", "Bench"],
  ["/workbook", "Workbook"],
  ["/rates", "Rates"],
] as const;

interface SessionAnswer {
  session: DeskSession & { latestAnswer: { id: string; message: string; at: string } | null };
}

interface SearchResult {
  kind: string;
  id: string;
  label: string;
  href: string;
}

const SEARCH_PAUSE_MS = 300;

function SearchBox(): JSX.Element {
  const [text, setText] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const turn = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const box = useRef<HTMLDivElement>(null);

  const close = (): void => {
    turn.current += 1;
    clearTimeout(timer.current);
    setResults(null);
    setNotice(null);
  };

  const ask = (value: string): void => {
    setText(value);
    clearTimeout(timer.current);
    const mine = (turn.current += 1);
    if (value.trim() === "") {
      setResults(null);
      setNotice(null);
      return;
    }
    timer.current = setTimeout(() => {
      get<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(value)}`)
        .then((answer) => {
          if (mine !== turn.current) return;
          setResults(answer.results);
          setNotice(answer.results.length === 0 ? copy("F-18", { text: value }) : null);
        })
        .catch((error: unknown) => {
          if (mine !== turn.current) return;
          setResults([]);
          setNotice(error instanceof ApiFailure ? error.message : copy("F-17"));
        });
    }, SEARCH_PAUSE_MS);
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && results !== null) {
      event.preventDefault();
      event.stopPropagation();
      close();
      box.current?.querySelector("input")?.focus();
    }
  };

  return (
    <div class="search" ref={box} onKeyDown={onKey} role="search">
      <span class="search-mark" aria-hidden="true" dangerouslySetInnerHTML={{ __html: glyph("search", 24) }} />
      <input class="input" type="search" aria-label="Search the desk" placeholder="Search the desk" autocomplete="off" value={text} onInput={(event) => ask(event.currentTarget.value)} />
      {results !== null ? (
        <div class="search-panel">
          {notice ? <p>{notice}</p> : null}
          {results.length > 0 ? (
            <ul aria-label="Search results">
              {results.map((result) => (
                <li key={`${result.kind}-${result.id}`}>
                  <a class="link-row" href={result.href} onClick={close}>
                    {result.label}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PasswordDialog({ control }: { control: ReturnType<typeof useDialog> }): JSX.Element {
  const form = useForm({ currentPassword: "", newPassword: "" }, control);
  return (
    <Dialog control={control} title="Change password">
      <Problems form={form} firstField="currentPassword" />
      <Field form={form} name="currentPassword" label="Current password" type="password" autocomplete="current-password" />
      <Field form={form} name="newPassword" label="New password" type="password" autocomplete="new-password" />
      <AsyncButton
        label="Change password"
        primary
        onPress={async () => {
          const saved = await form.submit(() => post("/api/password", form.values));
          if (!saved) return;
          form.replace({ currentPassword: "", newPassword: "" });
          control.done();
          announce(copy("F-101"));
        }}
      />
    </Dialog>
  );
}

function SignOut(): JSX.Element {
  return (
    <AsyncButton
      label="Sign out"
      onPress={async () => {
        await api("DELETE", "/api/session");
        window.location.assign("/sign-in");
      }}
    />
  );
}

function trackHover(): void {
  const mark = (event: PointerEvent, on: boolean): void => {
    if (event.pointerType !== "mouse") return;
    const control = (event.target as Element).closest?.(".button,.tile--link");
    if (control) control.toggleAttribute("data-hover", on);
  };
  document.addEventListener("pointerover", (event) => mark(event, true));
  document.addEventListener("pointerout", (event) => mark(event, false));
}

/** A control given focus by Tab or tap is scrolled fully into view between the top bar and the bottom bar (SR6). */
function keepFocusInView(): void {
  onFocusTaken((node) => {
    if (node.closest(".panel")) {
      node.scrollIntoView({ block: "nearest", behavior: "instant" });
      return;
    }
    if (node.closest(".topbar,.main-action") || node.matches("h1")) return;
    const top = document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? 0;
    const bar = document.querySelector<HTMLElement>(".main-action");
    const bottom = bar && getComputedStyle(bar).position === "fixed" ? bar.getBoundingClientRect().top : innerHeight;
    const box = node.getBoundingClientRect();
    if (box.height > bottom - top - 16 || box.top < top + 8) scrollBy({ top: box.top - top - 8, behavior: "instant" });
    else if (box.bottom > bottom - 8) scrollBy({ top: box.bottom - bottom + 8, behavior: "instant" });
  });
}

export function Shell({ children }: { children: ComponentChildren }): JSX.Element {
  const location = useLocation();
  const [failed, setFailed] = useState(false);
  const [ended, setEnded] = useState(false);
  const password = useDialog("Change password");
  const menu = useDialog("Menu");
  const seenAnswer = useRef<string | null | undefined>(undefined);
  const live = useLive(() => get<SessionAnswer>("/api/session"), []);
  const session = live.data?.session;

  useEffect(() => {
    trackHover();
    keepFocusInView();
    const unsubscribe = [
      onRefreshState(setFailed),
      onSessionEnded(() => {
        keepDrafts();
        setEnded(true);
        announce(copy("F-03"));
      }),
    ];
    return () => unsubscribe.forEach((stop) => stop());
  }, []);

  useEffect(() => {
    if (!session) return;
    const latest = session.latestAnswer;
    if (seenAnswer.current !== undefined && latest && latest.id !== seenAnswer.current) announce(latest.message);
    seenAnswer.current = latest?.id ?? null;
  }, [session === undefined, session?.latestAnswer?.id]);

  const signInAgain = `/sign-in?returnTo=${encodeURIComponent(currentAddress())}`;
  const links = (
    <>
      {LINKS.map(([href, label]) => (
        <a key={href} class="nav-link" href={href} aria-current={location.path === href || location.path.startsWith(`${href}/`) ? "page" : undefined}>
          {label}
        </a>
      ))}
    </>
  );

  return (
    <SessionContext.Provider value={session ?? null}>
      <header class="topbar">
        <div class="topbar-row page">
          <a class="wordmark" href="/pieces" aria-label="Semenza Desk">
            <span class="wordmark-full">Semenza Desk</span>
            <svg class="wordmark-short" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
              <circle cx="5" cy="12" r="3.5" />
              <circle cx="12" cy="12" r="3.5" />
              <circle cx="19" cy="12" r="3.5" />
            </svg>
          </a>
          <nav class="topbar-links" aria-label="Desk">
            {links}
          </nav>
          <SearchBox />
          <div class="topbar-actions">
            <button type="button" class="button" onClick={(event) => password.show(event.currentTarget)}>
              Change password
            </button>
            <SignOut />
          </div>
          <button type="button" class="button topbar-menu" onClick={(event) => menu.show(event.currentTarget)}>
            Menu
          </button>
        </div>
      </header>
      <div class="refresh-line page">
        <div role="status" aria-label="Refresh state">
          {failed && !ended ? copy("F-02") : ""}
        </div>
        {ended ? <a href={signInAgain}>Sign in again</a> : null}
      </div>
      <main id="main" class="page desk-main">
        {session ? children : null}
      </main>
      <Dialog control={menu} title="Menu" kind="sheet">
        <nav class="menu-links" aria-label="Desk menu">
          {links}
        </nav>
        <button
          type="button"
          class="button"
          onClick={() => {
            const opener = menu.opener.current;
            menu.hide();
            password.show(opener);
          }}
        >
          Change password
        </button>
        <SignOut />
      </Dialog>
      <PasswordDialog control={password} />
    </SessionContext.Provider>
  );
}
