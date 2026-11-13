import { useEffect, useRef, useState } from "preact/hooks";
import { request } from "../api.ts";
import { useAnnouncer } from "../announce.ts";
import { leagueStamp, statusLine } from "../format.ts";
import { useLive } from "../live.ts";
import { linkClick, navigate, useLocation } from "../router.ts";
import { getState, refreshNotices, setState, useApp } from "../store.ts";
import { Modal } from "./Dialog.tsx";
import { BallMark, BellIcon, SignOutIcon } from "./Icons.tsx";

const MANAGER_LINKS = [
  { to: "/team", label: "Pick Team" },
  { to: "/transfers", label: "Transfers" },
  { to: "/leagues", label: "Leagues" },
  { to: "/history", label: "History" },
];

export function Header() {
  const { me, gameweek, notices, inboxDown } = useApp();
  const { path } = useLocation();
  const [open, setOpen] = useState(false);
  const [marking, setMarking] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [announcement, announce] = useAnnouncer();
  const known = useRef<Set<string> | null>(null);

  const load = async () => {
    const view = await refreshNotices();
    if (!view) return;
    if (known.current) {
      for (const notice of [...view.notices].reverse()) {
        if (!known.current.has(notice.id)) announce(notice.message);
      }
    }
    known.current = new Set(view.notices.map((notice) => notice.id));
  };

  useEffect(() => {
    if (me) void load();
  }, [me?.id]);
  useLive((message) => {
    if (message.t === "notice" || (message.t === "gameweek" && getState().inboxDown)) void load();
  });

  if (!me) {
    return (
      <header class="site-header">
        <div class="header-inner">
          <span class="wordmark">
            <BallMark />
            Elevens
          </span>
        </div>
      </header>
    );
  }

  const links = me.role === "operator" ? [{ to: "/operator", label: "Operator" }] : MANAGER_LINKS;
  const unread = notices?.unread ?? 0;
  const signOut = async () => {
    setSigningOut(true);
    await request("POST", "/api/auth/signout");
    setState({ me: null, notices: null });
    setSigningOut(false);
    navigate("/signin");
  };
  const markAll = async () => {
    setMarking(true);
    const result = await request("POST", "/api/notices/read-all");
    setMarking(false);
    if (!result.ok && result.status === 503) setState({ inboxDown: true });
    await load();
  };

  return (
    <header class="site-header">
      <div class="header-inner">
        <a class="wordmark" href={links[0]!.to} onClick={(event) => linkClick(event, links[0]!.to)}>
          <BallMark />
          Elevens
        </a>
        <nav class="nav" aria-label="Main">
          {links.map((link) => (
            <a href={link.to} aria-current={path === link.to || path.startsWith(`${link.to}/`) ? "page" : undefined} onClick={(event) => linkClick(event, link.to)}>
              {link.label}
            </a>
          ))}
        </nav>
        <div class="header-tools">
          <p class="status-line" role="status" aria-label="Gameweek status">
            {gameweek ? statusLine(gameweek.number, gameweek.status, gameweek.deadline_local) : ""}
          </p>
          <button type="button" class="btn btn-quiet notices-button" aria-label={unread > 0 ? `Notices, ${unread} unread` : "Notices"} onClick={() => setOpen(true)}>
            <BellIcon />
            {unread > 0 && (
              <span class="count" aria-hidden="true">
                {unread}
              </span>
            )}
          </button>
          <button type="button" class="btn btn-quiet" aria-label="Sign out" disabled={signingOut} onClick={() => void signOut()}>
            <SignOutIcon />
          </button>
        </div>
      </div>
      <p class="sr-only" role="status" aria-label="Notices">
        {announcement.text}
      </p>
      {open && (
        <Modal title="Notices" onClose={() => setOpen(false)}>
          {(close) => (
            <NoticesBody inboxDown={inboxDown} notices={notices?.notices ?? null} marking={marking} onMarkAll={() => void markAll()} onClose={close} onOpen={() => void load()} />
          )}
        </Modal>
      )}
    </header>
  );
}

function NoticesBody(props: {
  inboxDown: boolean;
  notices: { id: string; message: string; read: boolean; created: string }[] | null;
  marking: boolean;
  onMarkAll: () => void;
  onClose: () => void;
  onOpen: () => void;
}) {
  useEffect(() => props.onOpen(), []);
  return (
    <>
      {props.inboxDown ? (
        <p class="result-strip is-error">Notices are delayed. They will appear here when the inbox is back.</p>
      ) : props.notices && props.notices.length > 0 ? (
        <ul class="notice-list" aria-label="Notices">
          {props.notices.map((notice) => (
            <li class={notice.read ? "" : "unread"} key={notice.id}>
              <span>{notice.message}</span>
              <time dateTime={notice.created}>{leagueStamp(notice.created)}</time>
            </li>
          ))}
        </ul>
      ) : (
        <p class="empty-note">
          <BellIcon />
          {props.notices ? "No notices yet." : "Loading notices…"}
        </p>
      )}
      <div class="dialog-actions">
        <button type="button" class="btn" onClick={props.onClose}>
          Close
        </button>
        <button type="button" class="btn btn-primary" disabled={props.marking || props.inboxDown} onClick={props.onMarkAll}>
          {props.marking ? "Marking…" : "Mark all read"}
        </button>
      </div>
    </>
  );
}
