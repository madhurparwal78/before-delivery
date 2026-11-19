import type { ComponentChildren, JSX } from "preact";
import { createPortal } from "preact/compat";
import { useEffect, useRef } from "preact/hooks";
import { townZone } from "../shared/catalog";
import type { SupplierRequest } from "../shared/api";
import { REFRESH_FAILED_COPY } from "../shared/copy";
import { wallTime } from "../shared/time";
import { announce, navigate, post, refreshFailed, saveDraft, sessionEnded, useResource } from "./lib";
import { Button, Modal, useDialog } from "./ui";
import { signOutRefusal, waitingReadings } from "./screens/visits";

/** The single line under the heading while a refresh fails. */
export function RefreshLine({ copy = REFRESH_FAILED_COPY }: { copy?: string }): JSX.Element | null {
  return refreshFailed.use() ? (
    <p class="refresh-line" data-part="refresh-line">
      {copy}
    </p>
  ) : null;
}

const DESK_LINKS = [
  { name: "Styles", href: "/styles" },
  { name: "Labels", href: "/labels" },
  { name: "Requests", href: "/requests" },
  { name: "Visits", href: "/visits" },
  { name: "Passports", href: "/passports" },
];

function DeskLinks({ current }: { current: string }): JSX.Element {
  const signOut = (): void => {
    const waiting = waitingReadings();
    if (waiting) {
      announce(signOutRefusal(waiting));
      return;
    }
    void post("/api/sign-out", undefined, { noSessionWatch: true })
      .catch(() => undefined)
      .then(() => navigate("/sign-in"));
  };
  return (
    <nav class="desk-links" aria-label="Desk">
      <ul>
        {DESK_LINKS.map((link) => (
          <li key={link.name}>
            <a class="desk-link" href={link.href} aria-current={current.startsWith(link.href) ? "page" : undefined}>
              {link.name}
            </a>
          </li>
        ))}
      </ul>
      <Button onPress={signOut}>Sign out</Button>
    </nav>
  );
}

/** Answers reach every open screen within the refresh, announced with the supplier's name and local time. */
function AnswerWatch(): null {
  const requests = useResource<{ requests: SupplierRequest[] }>("/api/requests");
  const known = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!requests.data) return;
    const answered = requests.data.requests.filter((request) => request.answeredAt);
    if (known.current) {
      for (const request of answered) {
        if (!known.current.has(request.id)) {
          announce(`${request.supplierName} answered at ${wallTime(request.answeredAt as string, townZone(request.town))} ${request.townName} time.`);
        }
      }
    }
    known.current = new Set(answered.map((request) => request.id));
  }, [requests.data]);
  return null;
}

function SessionBand(): JSX.Element | null {
  const ended = sessionEnded.use();
  if (!ended) return null;
  return createPortal(
    <div class="session-band">
      <p>Your session ended.</p>
      <a
        class="cell-link"
        data-session-link
        href={`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`}
        onClick={() => saveDraft()}
      >
        Sign in again
      </a>
    </div>,
    document.getElementById("overlays") as HTMLElement,
  );
}

export function DeskFrame({ current, children }: { current: string; children: ComponentChildren }): JSX.Element {
  const menu = useDialog();
  return (
    <div class="desk">
      <AnswerWatch />
      <SessionBand />
      <header class="desk-top" role="banner">
        <a class="brand" href="/styles">
          Fio Contado Desk
        </a>
        <Button class="menu-button" onPress={menu.show}>
          Menu
        </Button>
      </header>
      <aside class="desk-rail" aria-label="Side rail">
        <a class="brand" href="/styles">
          Fio Contado Desk
        </a>
        <DeskLinks current={current} />
      </aside>
      {children}
      <Modal name="Menu" control={menu} kind="menu-sheet" dismissOutside>
        <div onClick={(event) => (event.target as Element).closest("a") && menu.hide()}>
          <DeskLinks current={current} />
        </div>
      </Modal>
    </div>
  );
}
