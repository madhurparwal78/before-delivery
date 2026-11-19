import { Copy, FolderInput, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { counted } from "../../shared/relativeTime";
import { containerHolding, flatten } from "../../shared/order";
import { can } from "../../shared/roles";
import type { Board, BoardOrder, OperationView, Pin } from "../../shared/types";
import { EmptyState } from "../components/EmptyState";
import { Grid, type Selection } from "../components/Grid";
import { usePinActions } from "../components/usePinActions";
import { AddSectionDialog, CollaboratorsDialog, EditBoardDialog, InviteDialog } from "../dialogs/BoardDialogs";
import { MoveCopyDialog } from "../dialogs/MoveCopyDialog";
import { api, ApiFailure, GENERIC_ERROR } from "../lib/api";
import { beginPointerDrag, type DropTarget } from "../lib/drag";
import { announce, notify, showAlert } from "../lib/feedback";
import { useLive } from "../lib/hooks";
import { watch } from "../lib/live";
import { reportOperation } from "../lib/operations";
import { navigate } from "../lib/router";
import { useMe } from "../session";
import { Button } from "../ui/Button";
import { NotFound } from "./NotFound";

type Viewer = { id: number; name: string };
type Dialogs = "section" | "edit" | "invite" | "collaborators" | null;

export function BoardPage({ id }: { id: number }) {
  const me = useMe();
  const [board, setBoard] = useState<Board | null>(null);
  const [missing, setMissing] = useState(false);
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [bulk, setBulk] = useState<{ verb: "Move" | "Copy"; opener: HTMLElement } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const actions = usePinActions();
  const latest = useRef<Board | null>(null);
  latest.current = board;
  const viewersSeen = useRef<Viewer[] | null>(null);
  const moves = useRef<Promise<void>>(Promise.resolve());

  const canEdit = can(board?.role ?? null, "edit_pins");

  const load = useCallback(async (): Promise<void> => {
    try {
      const fresh = await api.get<Board>(`/api/boards/${id}`);
      if (!latest.current || fresh.seq >= latest.current.seq) setBoard(fresh);
      setMissing(false);
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 404) setMissing(true);
    }
  }, [id]);

  useEffect(() => {
    setBoard(null);
    setMissing(false);
    viewersSeen.current = null;
    const stop = watch({ board: id });
    void load();
    return stop;
  }, [id, load]);

  const clearSelection = useCallback((spoken: boolean): void => {
    setSelected((held) => {
      if (held.length > 0 && spoken) announce("Selection cleared");
      return [];
    });
    setAnchor(null);
  }, []);

  useEffect(() => {
    if (selected.length > 0) announce(`${counted(selected.length, "pin", "pins")} selected`);
  }, [selected.length]);

  useLive((message) => {
    if (message.type === "not_found" && message.board === id) setMissing(true);
    if (message.type === "membership" && message.board_id === id) {
      if (message.role === null) {
        setMissing(true);
        return;
      }
      const before = latest.current?.role;
      setBoard((held) => (held ? { ...held, role: message.role } : held));
      if (before === "editor" && message.role === "viewer") {
        clearSelection(false);
        notify("You can now only view this board");
      }
    }
    if (message.type === "follow" && message.target === "board" && message.id === id) {
      setBoard((held) => (held ? { ...held, followers: message.followers } : held));
    }
    if (message.type === "viewers" && message.board_id === id) {
      const before = viewersSeen.current;
      viewersSeen.current = message.viewers;
      setViewers(message.viewers);
      if (before) {
        for (const arrived of message.viewers.filter((v) => v.id !== me.id && !before.some((b) => b.id === v.id))) announce(`${arrived.name} opened this board`);
        for (const left of before.filter((b) => b.id !== me.id && !message.viewers.some((v) => v.id === b.id))) announce(`${left.name} left this board`);
      }
    }
    if (message.type === "board" && message.board_id === id) {
      const held = latest.current;
      if (!held || message.seq <= held.seq) return;
      const ids = flatten(message.order);
      const known = new Set(held.pins.map((pin) => pin.id));
      setBoard({ ...held, seq: message.seq, order: message.order, pin_count: message.pin_count, pins: held.pins.filter((pin) => ids.includes(pin.id)) });
      if (ids.some((pinId) => !known.has(pinId)) || ["updated", "section_added", "section_renamed"].includes(message.change)) void load();
      if (message.actor.id !== me.id) {
        const text =
          message.change === "moved" && message.pin ? `${message.actor.name} moved ${message.pin.title}`
          : message.change === "added" && message.pin ? `${message.actor.name} added ${message.pin.title}`
          : message.change === "removed" && message.pin ? `${message.actor.name} removed ${message.pin.title}`
          : message.change === "section_moved" && message.section ? `${message.actor.name} moved section ${message.section.name}`
          : null;
        if (text) notify(text);
      }
    }
  });

  const pinsById = useMemo(() => new Map((board?.pins ?? []).map((pin) => [pin.id, pin])), [board?.pins]);
  const listOf = (ids: number[]): Pin[] => ids.flatMap((pinId) => {
    const pin = pinsById.get(pinId);
    return pin ? [pin] : [];
  });

  /** Moves are sent one after another so each one is computed from the order the previous answer left. */
  const send = (build: (current: Board) => Record<string, unknown> | null, spoken: (reply: { order: BoardOrder }) => string): void => {
    moves.current = moves.current.then(async () => {
      const current = latest.current;
      const body = current ? build(current) : null;
      if (!current || !body) return;
      try {
        const reply = await api.post<{ seq: number; order: BoardOrder }>(`/api/boards/${id}/moves`, { ...body, base_seq: current.seq });
        const held = latest.current;
        if (held && reply.seq > held.seq) {
          latest.current = { ...held, seq: reply.seq, order: reply.order };
          setBoard(latest.current);
        }
        announce(spoken(reply));
      } catch {
        showAlert(GENERIC_ERROR);
        void load();
      }
    });
  };

  const reorderPin = (pin: Pin, delta: -1 | 1): void => {
    send(
      (current) => {
        const container = containerHolding(current.order, pin.id);
        if (!container) return null;
        const to = container.pins.indexOf(pin.id) + delta;
        if (to < 0 || to >= container.pins.length) return null;
        return { kind: "pin", id: pin.id, section: container.sectionId, position: to + 1 };
      },
      (reply) => {
        const container = containerHolding(reply.order, pin.id);
        return `Moved ${pin.title} to position ${(container?.pins.indexOf(pin.id) ?? 0) + 1} of ${container?.pins.length ?? 0}`;
      },
    );
  };

  const dropPin = (pin: Pin, target: DropTarget): void => {
    send(
      () => ({ kind: "pin", id: pin.id, section: target.sectionId, position: target.position }),
      (reply) => {
        const container = containerHolding(reply.order, pin.id);
        return `Moved ${pin.title} to position ${(container?.pins.indexOf(pin.id) ?? 0) + 1} of ${container?.pins.length ?? 0}`;
      },
    );
  };

  const moveSection = (sectionId: number, name: string, to: number | "up" | "down"): void => {
    send(
      (current) => {
        const index = current.order.sections.findIndex((section) => section.id === sectionId);
        const position = to === "up" ? index : to === "down" ? index + 2 : to;
        if (index < 0 || position < 1 || position > current.order.sections.length) return null;
        return { kind: "section", id: sectionId, section: null, position };
      },
      (reply) => `Moved section ${name} to position ${reply.order.sections.findIndex((section) => section.id === sectionId) + 1} of ${reply.order.sections.length}`,
    );
  };

  const selection: Selection | undefined = canEdit
    ? {
        selected: new Set(selected),
        anchor,
        set: (ids, nextAnchor) => {
          setSelected(ids);
          setAnchor(nextAnchor);
        },
        clear: () => clearSelection(true),
      }
    : undefined;

  const toggleFollow = async (): Promise<void> => {
    if (!board) return;
    setFollowBusy(true);
    try {
      const reply = board.following ? await api.delete<{ following: boolean; followers: number }>(`/api/follows/boards/${id}`) : await api.put<{ following: boolean; followers: number }>(`/api/follows/boards/${id}`);
      setBoard((held) => (held ? { ...held, following: reply.following, followers: reply.followers } : held));
    } catch {
      showAlert(GENERIC_ERROR);
    }
    setFollowBusy(false);
  };

  const deleteSelected = async (): Promise<void> => {
    setDeleting(true);
    try {
      const operation = await api.post<OperationView>("/api/operations", { kind: "delete", pins: selected, board: null, section: null });
      reportOperation(operation, `${counted(selected.length, "pin", "pins")} deleted`);
      clearSelection(false);
    } catch {
      showAlert(GENERIC_ERROR);
    }
    setDeleting(false);
  };

  const onHeadingKey = (event: KeyboardEvent<HTMLHeadingElement>, sectionId: number, name: string): void => {
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      moveSection(sectionId, name, event.key === "ArrowUp" ? "up" : "down");
    }
  };

  if (missing) return <div className="page"><NotFound heading="Board not found" /></div>;
  if (!board) return <div className="page" aria-busy="true" />;

  const hasPins = flatten(board.order).length > 0;
  const people = viewers.length === 1 ? "1 person viewing" : `${viewers.length} people viewing`;

  return (
    <div className="page board">
      <header className="board-head">
        <h1 className="board-title">{board.name}</h1>
        <p className="board-meta">
          <span>{board.visibility === "secret" ? "Secret" : "Public"}</span>
          <span>{counted(board.pin_count, "pin", "pins")}</span>
          <span>{counted(board.followers, "follower", "followers")}</span>
        </p>
        <div className="board-actions">
          {board.role !== "owner" && board.visibility === "public" ? (
            <Button aria-pressed={board.following} busy={followBusy} onClick={() => void toggleFollow()}>{board.following ? "Following" : "Follow"}</Button>
          ) : null}
          {canEdit ? <Button onClick={() => navigate(`/create?board=${id}`)}>Add pin</Button> : null}
          {canEdit ? <Button onClick={() => setDialog("section")}>Add section</Button> : null}
          {can(board.role, "edit_board") ? <Button onClick={() => setDialog("edit")}>Edit board</Button> : null}
          {can(board.role, "manage_members") ? <Button onClick={() => setDialog("invite")}>Invite</Button> : null}
          {board.role !== null ? <Button onClick={() => setDialog("collaborators")}>Collaborators</Button> : null}
        </div>
        {viewers.length > 0 ? (
          <div className="viewing">
            <ul aria-label="Viewing now" className="viewing-list">
              {viewers.map((viewer) => (
                <li key={viewer.id}>{viewer.name}</li>
              ))}
            </ul>
            <span className="meta">{people}</span>
          </div>
        ) : null}
      </header>

      {!hasPins && board.order.sections.length === 0 ? <EmptyState sentence="No pins yet" seed={`board-${id}`} /> : null}
      {hasPins || board.order.sections.length > 0 ? (
        <Grid
          name="Pins"
          pins={listOf(board.order.unsectioned)}
          selection={selection}
          onOpen={actions.open}
          onSave={actions.save}
          onReorder={canEdit ? reorderPin : undefined}
          onDropPin={canEdit ? dropPin : undefined}
        />
      ) : null}

      {board.order.sections.map((section) => {
        const headingId = `section-${section.id}`;
        return (
          <section key={section.id} aria-labelledby={headingId} className="board-section" data-drop-section={section.id}>
            <h2
              id={headingId}
              tabIndex={0}
              className="section-title"
              onKeyDown={(event) => onHeadingKey(event, section.id, section.name)}
              onPointerDown={(event) => {
                if (!canEdit || event.pointerType === "touch" || event.button !== 0) return;
                const target = event.currentTarget.closest<HTMLElement>("section");
                if (!target) return;
                beginPointerDrag(event, {
                  source: event.currentTarget,
                  onDrop: (hit) => {
                    const over = hit?.closest<HTMLElement>("[data-drop-section]");
                    const index = board.order.sections.findIndex((candidate) => String(candidate.id) === over?.dataset["dropSection"]);
                    if (index >= 0) moveSection(section.id, section.name, index + 1);
                  },
                });
              }}
            >
              {section.name}
            </h2>
            <Grid
              name={section.name}
              sectionId={section.id}
              pins={listOf(section.pins)}
              selection={selection}
              onOpen={actions.open}
              onSave={actions.save}
              onReorder={canEdit ? reorderPin : undefined}
              onDropPin={canEdit ? dropPin : undefined}
            />
            {section.pins.length === 0 ? <p className="section-empty">No pins yet</p> : null}
          </section>
        );
      })}

      {selected.length > 0 && canEdit ? (
        <div role="toolbar" aria-label="Selection" className="toolbar">
          <span className="toolbar-count">{`${counted(selected.length, "pin", "pins")} selected`}</span>
          <Button onClick={(event) => setBulk({ verb: "Move", opener: event.currentTarget })}><FolderInput size={20} aria-hidden="true" />Move</Button>
          <Button onClick={(event) => setBulk({ verb: "Copy", opener: event.currentTarget })}><Copy size={20} aria-hidden="true" />Copy</Button>
          <Button busy={deleting} busyLabel="Deleting" onClick={() => void deleteSelected()}><Trash2 size={20} aria-hidden="true" />Delete</Button>
        </div>
      ) : null}

      {dialog === "section" ? <AddSectionDialog boardId={id} onClose={() => setDialog(null)} /> : null}
      {dialog === "edit" ? <EditBoardDialog board={board} onClose={() => setDialog(null)} /> : null}
      {dialog === "invite" ? <InviteDialog boardId={id} onClose={() => setDialog(null)} /> : null}
      {dialog === "collaborators" ? <CollaboratorsDialog board={board} onClose={() => setDialog(null)} /> : null}
      {bulk ? (
        <MoveCopyDialog verb={bulk.verb} pinIds={selected} currentBoardId={id} returnFocusTo={bulk.opener} onClose={() => setBulk(null)} onDone={() => clearSelection(false)} />
      ) : null}
      {actions.dialog}
    </div>
  );
}
