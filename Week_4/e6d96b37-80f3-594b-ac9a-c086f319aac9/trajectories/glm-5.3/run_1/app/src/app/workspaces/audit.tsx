import { useState } from "react";
import { TRAY_CELLS } from "../../shared/util.js";
import { ApiError, postJson, useDesk } from "../desk_context.js";
import { feedback } from "../feedback.js";
import { ReviewDialog, useCommand } from "../review.js";

interface QueuedMark {
  cell: string;
  expectedVersion: number;
  commandId: string;
}

const QUEUE_KEY = "flan:audit-queue";

function loadQueue(namespace: string): QueuedMark[] {
  const raw = window.localStorage.getItem(`${QUEUE_KEY}:${namespace}`);
  return raw ? (JSON.parse(raw) as QueuedMark[]) : [];
}

function saveQueue(namespace: string, queue: QueuedMark[]): void {
  window.localStorage.setItem(`${QUEUE_KEY}:${namespace}`, JSON.stringify(queue));
}

export function AuditWorkspace(): React.ReactElement {
  const desk = useDesk();
  const runCommand = useCommand();
  const state = desk.state;
  const namespace = desk.session?.namespace ?? "hollowmint";
  const [selectedCell, setSelectedCell] = useState<string>("A1");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [queue, setQueue] = useState<QueuedMark[]>(() => loadQueue(namespace));

  const tray = state?.tray ?? {};

  const selectCell = (cell: string) => {
    setSelectedCell(cell);
  };

  const move = (direction: "next" | "previous" | "down" | "up") => {
    const index = TRAY_CELLS.indexOf(selectedCell as (typeof TRAY_CELLS)[number]);
    let next = index;
    if (direction === "next") next = Math.min(TRAY_CELLS.length - 1, index + 1);
    if (direction === "previous") next = Math.max(0, index - 1);
    if (direction === "down") next = Math.min(TRAY_CELLS.length - 1, index + 2);
    if (direction === "up") next = Math.max(0, index - 2);
    selectCell(TRAY_CELLS[next]);
  };

  const enqueueMark = () => {
    const cell = tray[selectedCell];
    const expectedVersion = (cell?.audit_version ?? 0) + queue.filter((q) => q.cell === selectedCell).length;
    const commandId = `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const next = [...queue, { cell: selectedCell, expectedVersion, commandId }];
    setQueue(next);
    saveQueue(namespace, next);
    desk.announce(feedback("F_OFFLINE"));
  };

  const syncQueue = async () => {
    if (queue.length === 0) return;
    await runCommand(`sync-${Date.now()}`, async () => {
      const commands = queue.map((q) => ({
        command_id: q.commandId,
        expected_version: q.expectedVersion,
        cell: q.cell,
        mark: "missing",
      }));
      try {
        const result = await postJson<{ results: { command_id: string; status: number; body: unknown }[] }>(
          `/api/desks/${namespace}/audit/sync`,
          { commands },
        );
        for (const item of result.results) {
          desk.announce(feedback("F_AUDIT_MISSING"));
        }
        desk.announce(feedback("F_SYNCED"));
        setQueue([]);
        saveQueue(namespace, []);
        await desk.refresh();
      } catch (err) {
        if (err instanceof ApiError) {
          desk.reportError(err.failure.body.message);
          return;
        }
        throw err;
      }
    });
  };

  return (
    <div aria-label="Stock audit workspace" className="workspace-two-col">
      <div className="panel">
        <h3>Audit tray</h3>
        <div
          className="tray-grid"
          role="group"
          aria-label="Audit tray"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") move("next");
            if (e.key === "ArrowLeft") move("previous");
            if (e.key === "ArrowDown") move("down");
            if (e.key === "ArrowUp") move("up");
          }}
          onTouchStart={(e) => {
            const start = e.touches[0].clientX;
            const handler = (endEvent: TouchEvent) => {
              const delta = endEvent.changedTouches[0].clientX - start;
              if (delta < -40) move("next");
              if (delta > 40) move("previous");
              e.currentTarget.removeEventListener("touchend", handler);
            };
            e.currentTarget.addEventListener("touchend", handler);
          }}
        >
          {TRAY_CELLS.map((cell) => {
            const record = tray[cell];
            const occupant = record?.specimen;
            return (
              <button
                key={cell}
                className={`tray-cell${selectedCell === cell ? " selected" : ""}${record?.audit_mark === "missing" ? " missing-mark" : ""}`}
                aria-label={`Cell ${cell}`}
                aria-pressed={selectedCell === cell}
                onClick={() => selectCell(cell)}
              >
                {occupant ? state?.specimens[occupant]?.display_label : cell}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" aria-label="Previous cell" onClick={() => move("previous")}>
            Previous cell
          </button>
          <button className="btn" aria-label="Next cell" onClick={() => move("next")}>
            Next cell
          </button>
        </div>
      </div>
      <div className="panel">
        <h3>Selected cell</h3>
        <div className="fact-box">
          <h3>{selectedCell}</h3>
          <p>{tray[selectedCell]?.specimen ? state?.specimens[tray[selectedCell].specimen]?.display_label : "Empty cell"}</p>
        </div>
        <button className="btn btn-primary" aria-label="Mark missing" onClick={() => setReviewOpen(true)}>
          Mark missing
        </button>{" "}
        <button className="btn" aria-label="Retry sync" onClick={() => void syncQueue()} disabled={queue.length === 0}>
          Retry sync
        </button>
        {queue.length > 0 && <p className="inline-note">{feedback("F_OFFLINE")} ({queue.length} queued)</p>}
      </div>
      {reviewOpen && (
        <ReviewDialog
          title="Record missing item"
          summary={`Mark cell ${selectedCell} missing.`}
          onConfirm={() => {
            setReviewOpen(false);
            enqueueMark();
          }}
          onCancel={() => setReviewOpen(false)}
        />
      )}
    </div>
  );
}
