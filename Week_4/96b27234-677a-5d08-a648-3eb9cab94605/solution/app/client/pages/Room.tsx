import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyEvent } from "react";
import { flushSync } from "react-dom";
import { RANKS, SOMEONE, type Direction, type PersonView, type Rank, type Relations, type SessionDetail } from "../../shared/protocol";
import { call } from "../lib/api";
import { anyLayerOpen, dialogOpen, focusFirst, popLayer, pushLayer, type Layer } from "../lib/layers";
import { navigate } from "../lib/router";
import { account, patchMe, pushed, useStore } from "../lib/store";
import { useAction } from "../lib/useAction";
import { Controls } from "../room/Controls";
import { ActionsDialog, ReportDialog, VotePanel } from "../room/Dialogs";
import { ChatPanel, FeatureList, PeopleList } from "../room/Panels";
import { RoomCanvas } from "../room/RoomCanvas";
import { usePhone, useReducedMotion, useRoom } from "../room/useRoom";
import { Status } from "../ui/Bits";
import { useDialog } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { ScheduleDialog } from "../ui/ScheduleDialog";
import { Denied } from "./NotFound";

type SheetState = "closed" | "open" | "closing";
const SHEET_EXIT_MS = 250;

interface Friend {
  personId: string;
  displayName: string;
}

export function Room({ detail }: { detail: SessionDetail }) {
  const state = useStore(account);
  const me = state.state === "in" ? state.me : null;
  const selfId = me?.personId ?? "";
  const reduced = useReducedMotion();
  const phone = usePhone();
  const room = useRoom(detail, selfId, reduced);
  const { view } = room;
  const region = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const chatField = useRef<HTMLInputElement | null>(null);
  const beforeChat = useRef<HTMLElement | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const sheetEl = useRef<HTMLDivElement>(null);
  const [sheet, setSheet] = useState<SheetState>("closed");
  const sheetToken = useRef(0);
  const sheetTimer = useRef(0);
  const sheetRestore = useRef<HTMLElement | null>(null);
  const safety = useAction("Saving...");
  const actions = useDialog();
  const report = useDialog();
  const schedule = useDialog();
  const scheduling = useAction("Saving...");
  const [target, setTarget] = useState<PersonView | null>(null);
  const [relations, setRelations] = useState<Relations>(view.relations);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [invitee, setInvitee] = useState("");
  const [inviteText, setInviteText] = useState("");
  const [role, setRole] = useState<string | null>(null);
  const [hiding, setHiding] = useState<string | null>(null);
  const scheduleButton = useRef<HTMLButtonElement>(null);
  const roleVersion = useStore(pushed).role;

  useEffect(() => setRelations(view.relations), [view.relations]);

  const host = view.hostId === selfId;
  const canSchedule = detail.communityId !== null && (role === "owner" || role === "steward");

  useEffect(() => {
    if (!detail.communityId) return;
    void call<{ communities: { id: string; role: string }[] }>("GET", "/api/communities").then((reply) => {
      const next = reply.ok ? (reply.data.communities.find((community) => community.id === detail.communityId)?.role ?? null) : null;
      const allowed = next === "owner" || next === "steward";
      if (!allowed && scheduleButton.current && document.activeElement === scheduleButton.current) heading.current?.focus();
      setRole(next);
    });
  }, [detail.communityId, roleVersion]);

  useEffect(() => {
    if (!host) return;
    void call<{ friends: Friend[] }>("GET", "/api/friends").then((reply) => {
      if (reply.ok) {
        setFriends(reply.data.friends);
        setInvitee((current) => current || (reply.data.friends[0]?.personId ?? ""));
      }
    });
  }, [host]);

  // The phone sheet: one cancellable timer decides when it is finally hidden, so a reopen cancels the exit.
  const openSheet = useCallback((from: HTMLElement | null): void => {
    window.clearTimeout(sheetTimer.current);
    sheetToken.current += 1;
    sheetRestore.current = from;
    setSheet("open");
  }, []);

  const closeSheet = useCallback((): void => {
    const token = (sheetToken.current += 1);
    if (reduced) setSheet("closed");
    else {
      setSheet("closing");
      sheetTimer.current = window.setTimeout(() => {
        if (sheetToken.current === token) setSheet("closed");
      }, SHEET_EXIT_MS);
    }
    const back = sheetRestore.current;
    if (back && back.isConnected) back.focus();
  }, [reduced]);

  useEffect(() => {
    const element = sheetEl.current;
    if (sheet !== "open" || !element) return undefined;
    const layer: Layer = { element, close: closeSheet, restore: sheetRestore.current };
    pushLayer(layer);
    if (!element.contains(document.activeElement)) focusFirst(element);
    return () => popLayer(layer);
  }, [sheet, closeSheet]);

  useEffect(() => {
    if (!phone && sheet !== "closed") setSheet("closed");
  }, [phone, sheet]);

  const showActions = (person: PersonView, from: HTMLElement | null): void => {
    setTarget(person);
    actions.show(from);
  };

  const onKey = useCallback(
    (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const element = event.target instanceof HTMLElement ? event.target : null;
      if (element?.closest("input, textarea, select, [contenteditable='true']")) {
        if (event.key === "Escape" && element === chatField.current && !anyLayerOpen()) {
          event.preventDefault();
          const back = beforeChat.current;
          (back && back.isConnected ? back : region.current)?.focus();
        }
        return;
      }
      if (dialogOpen()) return;
      if (element && element !== document.body && element !== document.documentElement && !region.current?.contains(element)) return;
      const arrows: Record<string, Direction> = { ArrowUp: "north", ArrowRight: "east", ArrowDown: "south", ArrowLeft: "west" };
      const direction = arrows[event.key];
      if (direction) {
        event.preventDefault();
        room.enqueue(() => room.step(direction));
        return;
      }
      switch (event.key.toLowerCase()) {
        case "s":
          room.enqueue(() => room.sitOrStand());
          break;
        case "t": {
          event.preventDefault();
          if (phone && sheet !== "open") flushSync(() => openSheet(opener.current));
          chatField.current?.focus();
          break;
        }
        case "n": {
          const names = view.nearby.map((id) => view.people.find((person) => person.personId === id)?.displayName ?? SOMEONE);
          room.announce(names.length > 0 ? `Nearby: ${names.join(", ")}.` : "Nobody is nearby.");
          break;
        }
        case "m": {
          const nearest = view.people.find((person) => person.personId === view.nearest);
          if (!nearest) room.announce("Nobody is nearby.");
          else {
            event.preventDefault();
            showActions(nearest, document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null);
          }
          break;
        }
        default:
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [room.enqueue, room.step, room.sitOrStand, room.announce, view, phone, sheet, openSheet],
  );

  useEffect(() => {
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onKey]);

  if (room.removed) return <Denied heading="This session isn't available." />;

  const hideAbove = hiding ?? me?.hideAbove ?? "";
  const hide = async (value: string): Promise<void> => {
    const next = value === "" ? null : value;
    setHiding(value);
    const reply = await safety.run("PUT", "/api/me/hide-above", { rank: next }, () => (next ? `Avatars above ${next} are hidden.` : "All avatars are shown."));
    if (reply.ok) patchMe({ hideAbove: next as Rank | null });
    setHiding(null);
  };
  /** Native type-ahead only matches the case typed; the rank names are capitalised, so match any case. */
  const typeAhead = (event: ReactKeyEvent<HTMLSelectElement>): void => {
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
    const options = [...event.currentTarget.options];
    const from = event.currentTarget.selectedIndex + 1;
    const found = [...options.slice(from), ...options.slice(0, from)].find((option) => option.label.toLowerCase().startsWith(event.key.toLowerCase()));
    if (!found) return;
    event.preventDefault();
    void hide(found.value);
  };
  const leave = async (): Promise<void> => {
    const reply = await call("POST", `/api/sessions/${detail.id}/leave`);
    if (reply.ok) navigate("/sessions");
    else room.refused(reply);
  };
  const invite = async (): Promise<void> => {
    const reply = await call("POST", `/api/sessions/${detail.id}/invitees`, { personId: invitee });
    setInviteText(reply.ok ? "Invited." : reply.error);
  };
  const latestVote = [...view.votes].reverse().find((vote) => vote.status === "open") ?? view.votes[view.votes.length - 1];
  const openActions = (person: PersonView, from: HTMLElement): void => showActions(person, from);

  const peoplePanel = (
    <>
      <PeopleList people={view.people} selfId={selfId} onActions={openActions} />
      <FeatureList features={view.features} people={view.people} />
    </>
  );
  const chatPanel = (
    <ChatPanel
      chat={room.chat}
      result={room.chatResult}
      send={room.sendChat}
      onFieldFocus={(previous) => {
        beforeChat.current = previous;
      }}
      fieldRef={chatField}
    />
  );

  return (
    <section
      ref={region}
      role="region"
      aria-label="Room"
      tabIndex={-1}
      className="room"
      data-room-version={view.roomVersion}
      data-motion={reduced ? "reduced" : "animated"}
      data-ripple={room.ripple.phase}
      data-ripple-radius={room.ripple.phase === "none" ? 0 : room.ripple.radius}
    >
      <header className="room-head">
        <div>
          <h1 ref={heading} tabIndex={-1}>
            {detail.roomName}
          </h1>
          <p className="muted">
            Room version {view.roomVersion}. {view.count} {view.count === 1 ? "person is" : "people are"} here.
          </p>
        </div>
        <div className="toolbar">
          <label className="field">
            <span>Hide avatars above</span>
            <select aria-label="Hide avatars above" value={hideAbove} onChange={(event) => void hide(event.target.value)} onKeyDown={typeAhead}>
              <option value="">Show all</option>
              {RANKS.map((rank) => (
                <option key={rank} value={rank}>
                  {rank}
                </option>
              ))}
            </select>
          </label>
          {host ? (
            <div className="field">
              <span>Invite a friend</span>
              <div className="row tight">
                <select aria-label="Invite a friend" value={invitee} onChange={(event) => setInvitee(event.target.value)}>
                  {friends.map((friend) => (
                    <option key={friend.personId} value={friend.personId}>
                      {friend.displayName}
                    </option>
                  ))}
                </select>
                <button type="button" className="button" disabled={!invitee} onClick={() => void invite()}>
                  <Icon name="invite" size={18} /> Invite
                </button>
              </div>
              <small aria-live="polite">{inviteText}</small>
            </div>
          ) : null}
          {canSchedule ? (
            <button ref={scheduleButton} type="button" className="button" onClick={(event) => schedule.show(event.currentTarget)}>
              <Icon name="communities" size={18} /> Schedule gathering
            </button>
          ) : null}
          <button type="button" className="button" onClick={() => void leave()}>
            <Icon name="leave" size={18} /> Leave session
          </button>
        </div>
      </header>

      <div className="room-notes">
        <Status name="Safety result" result={safety.result} />
        {!schedule.open ? <Status name="Gathering result" result={scheduling.result} /> : null}
      </div>

      <div className="room-grid">
        <div className="stage">
          <RoomCanvas layout={view.layout} people={view.people} selfId={selfId} ripple={room.ripple} reduced={reduced} />
          <Controls onStep={(direction) => room.enqueue(() => room.step(direction))} onSit={() => room.enqueue(() => room.sitOrStand())} />
          {phone ? (
            <button ref={opener} type="button" className="button primary sheet-opener" onClick={(event) => openSheet(event.currentTarget)}>
              <Icon name="chat" size={18} /> People and chat
            </button>
          ) : null}
          <div role="status" aria-label="Room announcements" className="announcements">
            {room.announcements.map((entry) => (
              <p key={entry.id}>{entry.text}</p>
            ))}
          </div>
          {latestVote ? <VotePanel key={latestVote.id} vote={latestVote} name={view.voteTargetNames[latestVote.targetId] ?? SOMEONE} sessionId={detail.id} /> : null}
        </div>
        {phone ? (
          <div
            ref={sheetEl}
            role="dialog"
            aria-modal="true"
            aria-label="People and chat"
            data-sheet=""
            data-state={sheet}
            className="sheet"
            hidden={sheet === "closed"}
            inert={sheet !== "open"}
            tabIndex={-1}
          >
            <div className="sheet-bar">
              <h2>People and chat</h2>
              <button type="button" className="button" onClick={closeSheet}>
                <Icon name="close" size={18} /> Close
              </button>
            </div>
            <div className="sheet-body">
              {peoplePanel}
              {chatPanel}
            </div>
          </div>
        ) : (
          <>
            <div className="col-people">{peoplePanel}</div>
            <div className="col-chat">{chatPanel}</div>
          </>
        )}
      </div>

      <ActionsDialog
        handle={actions}
        person={target}
        selfId={selfId}
        relations={relations}
        sessionId={detail.id}
        safety={safety}
        onReport={() => {
          const from = actions.opener;
          actions.hide();
          report.show(from);
        }}
        onRelation={(kind, id, on) => setRelations((current) => ({ ...current, [kind]: on ? [...current[kind], id] : current[kind].filter((value) => value !== id) }))}
        onVoteRefused={(text) => safety.setResult({ text, kind: "refused" })}
      />
      <ReportDialog handle={report} person={target} sessionId={detail.id} />
      {detail.communityId && canSchedule ? <ScheduleDialog communityId={detail.communityId} handle={schedule} action={scheduling} /> : null}
    </section>
  );
}
