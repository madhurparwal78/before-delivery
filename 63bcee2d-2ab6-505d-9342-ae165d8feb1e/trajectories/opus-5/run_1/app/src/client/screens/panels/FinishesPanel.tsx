import { useId, useRef, useState } from 'react';
import { ApiError, request } from '../../lib/api.js';
import { useAnnouncer } from '../../lib/announce.jsx';
import { pending, refusal, success } from '../../lib/copy.js';
import { useResource, useWorkspace } from '../../lib/workspace.jsx';
import { ActionButton } from '../../components/Buttons.jsx';
import { Dialog, focusFirstDialogButton } from '../../components/Dialog.jsx';
import { Panel, TableRegion } from '../../components/Panel.jsx';
import type { PanelProps } from '../ProjectPage.jsx';
import { focusWhenReady } from '../../lib/focus.js';

interface Finish {
  id: string;
  position: number;
  code: string;
  name: string;
  category: string;
  supplier: string;
  productRef: string;
  location: string;
  notes: string;
}

interface ImportRow {
  line: number;
  status: 'created' | 'updated' | 'unchanged' | 'rejected';
  code: string;
  name: string;
  reason: string;
}

const STATUS_LABELS: Record<ImportRow['status'], string> = {
  created: 'Created',
  updated: 'Updated',
  unchanged: 'Unchanged',
  rejected: 'Rejected',
};

function handleName(finish: Finish): string {
  return `Reorder ${finish.code === '' ? finish.name : finish.code}`;
}

function finishWords(finish: Finish): string {
  return finish.code === '' ? finish.name : `${finish.code} ${finish.name}`;
}

export function FinishesPanel(props: PanelProps): JSX.Element {
  const formId = useId();
  const { project } = props;
  const { startPending, say, problem } = useAnnouncer();
  const { member, refresh, handleFailure } = useWorkspace();
  const finishes = useResource<{ finishes: Finish[] }>(
    `/api/projects/${project.id}/finishes`,
    [project.id],
  );
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState<ImportRow[] | null>(null);
  const [order, setOrder] = useState<Finish[] | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const pickedFrom = useRef<number>(0);
  const dragFrom = useRef<number | null>(null);
  const [busy, setBusy] = useState(false);

  const schedule = order ?? finishes.data?.finishes ?? [];
  const mayEdit =
    member?.role === 'director' || member?.role === 'project_lead' || member?.role === 'designer';

  const commitMove = async (finish: Finish, position: number): Promise<void> => {
    startPending(pending.reorderDrop);
    try {
      const result = await request<{ finishes: Finish[] }>(
        `/api/finishes/${finish.id}/move`,
        { body: { position } },
      );
      setOrder(null);
      finishes.reload();
      refresh();
      say(
        success.reorderDrop(finishWords(finish), position, result.finishes.length),
      );
    } catch (caught) {
      setOrder(null);
      finishes.reload();
      handleFailure(caught);
    }
  };

  const movePicked = (direction: number): void => {
    if (pickedId === null) return;
    const current = [...schedule];
    const index = current.findIndex((entry) => entry.id === pickedId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= current.length) return;
    const [moved] = current.splice(index, 1);
    if (!moved) return;
    current.splice(target, 0, moved);
    setOrder(current);
    say(success.reorderMove(finishWords(moved), target + 1, current.length));
  };

  const dropPicked = (): void => {
    if (pickedId === null) return;
    const index = schedule.findIndex((entry) => entry.id === pickedId);
    const finish = schedule[index];
    setPickedId(null);
    if (!finish) return;
    void commitMove(finish, index + 1);
  };

  const cancelPick = (): void => {
    if (pickedId === null) return;
    const finish = (finishes.data?.finishes ?? []).find((entry) => entry.id === pickedId);
    setPickedId(null);
    setOrder(null);
    if (finish) {
      say(
        success.reorderCancel(
          finishWords(finish),
          pickedFrom.current,
          finishes.data?.finishes.length ?? 0,
        ),
      );
    }
  };

  const onHandleKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    finish: Finish,
    index: number,
  ): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (pickedId === finish.id) {
        dropPicked();
        return;
      }
      pickedFrom.current = index + 1;
      setPickedId(finish.id);
      say(success.reorderPickUp(finishWords(finish), index + 1, schedule.length));
      return;
    }
    if (pickedId !== finish.id) return;
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      movePicked(-1);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      movePicked(1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelPick();
    }
  };

  const runImport = async (file: File): Promise<void> => {
    setBusy(true);
    startPending(pending.importFinishes);
    try {
      const csv = await file.text();
      const result = await request<{
        summary: { created: number; updated: number; unchanged: number; rejected: number };
        rows: ImportRow[];
      }>(`/api/projects/${project.id}/finishes/import`, { csv });
      setImporting(false);
      setReport(result.rows);
      finishes.reload();
      refresh();
      say(
        success.importFinished(
          result.summary.created,
          result.summary.updated,
          result.summary.unchanged,
          result.summary.rejected,
        ),
      );
      focusWhenReady('[data-import-report]');
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'validation') {
        problem(refusal.refusedUpload(file.name, caught.errors.file ?? ''));
        focusFirstDialogButton();
      } else if (caught instanceof ApiError && caught.code === 'file_too_large') {
        problem(refusal.refusedUpload(file.name, 'The file can have at most 2,000 rows.'));
        focusFirstDialogButton();
      } else {
        handleFailure(caught);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      sheetCode={props.sheetCode}
      revision={props.revision}
      name={props.panelName}
      heading={<h2 className="panel-heading">Finishes</h2>}
    >
      <div className="panel-actions">
        {mayEdit ? (
          <button type="button" className="primary" onClick={() => setImporting(true)}>
            Import CSV
          </button>
        ) : null}
        <a href={`/api/projects/${project.id}/finishes.csv`}>Export finishes CSV</a>
      </div>

      <TableRegion label="Finishes schedule table">
        <table>
          <caption>Finishes schedule</caption>
          <thead>
            <tr>
              <th scope="col" className="numeric">
                Position
              </th>
              <th scope="col">Code</th>
              <th scope="col">Name</th>
              <th scope="col">Category</th>
              <th scope="col">Supplier</th>
              <th scope="col">Product ref</th>
              <th scope="col">Location</th>
              {mayEdit ? <th scope="col">Reorder</th> : null}
            </tr>
          </thead>
          <tbody>
            {schedule.map((finish, index) => (
              <tr
                key={finish.id}
                data-picked={pickedId === finish.id ? 'true' : undefined}
                data-dragging={dragFrom.current === index ? 'true' : undefined}
                onDragOver={(event) => {
                  if (dragFrom.current === null) return;
                  event.preventDefault();
                  const from = dragFrom.current;
                  if (from === index) return;
                  const current = [...schedule];
                  const [moved] = current.splice(from, 1);
                  if (!moved) return;
                  current.splice(index, 0, moved);
                  dragFrom.current = index;
                  setOrder(current);
                }}
              >
                <td className="numeric">{index + 1}</td>
                <th scope="row">{finish.code === '' ? '—' : finish.code}</th>
                <td>{finish.name}</td>
                <td>{finish.category}</td>
                <td>{finish.supplier === '' ? '—' : finish.supplier}</td>
                <td>{finish.productRef === '' ? '—' : finish.productRef}</td>
                <td>{finish.location === '' ? '—' : finish.location}</td>
                {mayEdit ? (
                  <td>
                    <button
                      type="button"
                      draggable
                      aria-pressed={pickedId === finish.id}
                      onKeyDown={(event) => onHandleKeyDown(event, finish, index)}
                      onBlur={() => {
                        if (pickedId === finish.id) cancelPick();
                      }}
                      onDragStart={() => {
                        dragFrom.current = index;
                      }}
                      onDragEnd={() => {
                        const from = dragFrom.current;
                        dragFrom.current = null;
                        if (from === null) return;
                        const at = schedule.findIndex((entry) => entry.id === finish.id);
                        if (at >= 0) void commitMove(finish, at + 1);
                      }}
                    >
                      {handleName(finish)}
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </TableRegion>

      {report ? (
        <TableRegion label="Import report table">
          <table>
            <caption data-import-report tabIndex={-1}>
              Import report
            </caption>
            <thead>
              <tr>
                <th scope="col" className="numeric">
                  Line
                </th>
                <th scope="col">Status</th>
                <th scope="col">Code</th>
                <th scope="col">Name</th>
                <th scope="col">Reason</th>
              </tr>
            </thead>
            <tbody>
              {report.map((row) => (
                <tr key={`${row.line}-${row.code}-${row.name}`}>
                  <td className="numeric">{row.line}</td>
                  <th scope="row">{STATUS_LABELS[row.status]}</th>
                  <td>{row.code === '' ? '—' : row.code}</td>
                  <td>{row.name}</td>
                  <td>{row.reason === '' ? '—' : row.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableRegion>
      ) : null}

      {importing ? (
        <Dialog
          title="Import finishes"
          onClose={() => setImporting(false)}
          footer={
            <>
              <ActionButton
                className="primary"
                busy={busy}
                pendingLabel={pending.importFinishes}
                onPress={() => {
                  const file = fileInput.current?.files?.[0];
                  if (file) void runImport(file);
                }}
              >
                Import
              </ActionButton>
              <button type="button" onClick={() => setImporting(false)}>
                Cancel
              </button>
            </>
          }
        >
          <div className="field">
            <label className="field-label" htmlFor={`${formId}-legacy`}>
              Legacy CSV file
            </label>
            <input id={`${formId}-legacy`} ref={fileInput} type="file" accept=".csv,text/csv" />
          </div>
          <p className="meta">
            Columns Finish Code, Finish Name, Category, Supplier, Product Ref, Location and Notes,
            in any order. Finish Name and Category are required.
          </p>
        </Dialog>
      ) : null}
    </Panel>
  );
}
