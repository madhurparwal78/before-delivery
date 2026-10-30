import { useId, useRef, useState } from 'react';
import {
  HK_ZONE,
  TRANSMITTAL_PURPOSE_LABELS,
  type TransmittalPurpose,
} from '../../../shared/domain.js';
import { fieldErrorCopy } from '../../../shared/fieldErrors.js';
import { formatByteLimit, formatInstant } from '../../../shared/format.js';
import { ApiError, newRetryKey, request, requestBlob } from '../../lib/api.js';
import { useAnnouncer } from '../../lib/announce.jsx';
import { pending, refusal, success } from '../../lib/copy.js';
import { useResource, useWorkspace } from '../../lib/workspace.jsx';
import { ActionButton } from '../../components/Buttons.jsx';
import { Dialog, focusFirstDialogButton } from '../../components/Dialog.jsx';
import { Panel, TableRegion } from '../../components/Panel.jsx';
import type { PanelProps } from '../ProjectPage.jsx';
import { focusWhenReady } from '../../lib/focus.js';

interface Revision {
  revision: string;
  state: string;
  bytes: number;
  sha256: string;
  contentType: string;
  originalName: string;
  note: string;
  uploadedBy: string | null;
  uploadedAt: string;
}

interface Sheet {
  id: string;
  code: string;
  title: string;
  currentRevision: string | null;
  revisions: Revision[];
}

interface OptimisticRow {
  key: string;
  sheetCode: string;
  fileName: string;
  leaving: boolean;
}

const FILE_LIMIT_BYTES = 10_000_000;

function sheetCodeFromFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf('.');
  return (dot > 0 ? base.slice(0, dot) : base).toUpperCase();
}

async function saveBlob(path: string, fileName: string): Promise<void> {
  const blob = await requestBlob(path);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function DrawingsPanel(props: PanelProps): JSX.Element {
  const formId = useId();
  const { project } = props;
  const { startPending, say, problem } = useAnnouncer();
  const { member, refresh, handleFailure } = useWorkspace();
  const sheets = useResource<{ sheets: Sheet[] }>(`/api/projects/${project.id}/sheets`, [
    project.id,
  ]);
  const batchInput = useRef<HTMLInputElement | null>(null);
  const revisionInput = useRef<HTMLInputElement | null>(null);
  const revisionTarget = useRef<string>('');
  const [rows, setRows] = useState<OptimisticRow[]>([]);
  const [history, setHistory] = useState<Sheet | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [purpose, setPurpose] = useState<TransmittalPurpose>('for_construction');
  const [busy, setBusy] = useState(false);

  const register = sheets.data?.sheets ?? [];
  const mayUpload =
    member?.role === 'director' || member?.role === 'project_lead' || member?.role === 'designer';

  const currentRevisions = register
    .map((sheet) => ({ sheet, revision: sheet.revisions.find((entry) => entry.state === 'current') }))
    .filter((entry): entry is { sheet: Sheet; revision: Revision } => entry.revision !== undefined);

  /** One row per chosen file straight away; refused rows roll back with a reason. */
  const uploadFiles = async (files: readonly File[], presetCode?: string): Promise<void> => {
    const optimistic = files.map((file) => ({
      key: `${file.name}-${crypto.randomUUID()}`,
      sheetCode: presetCode ?? sheetCodeFromFileName(file.name),
      fileName: file.name,
      leaving: false,
    }));
    setRows(optimistic);
    let uploaded = 0;

    for (const [index, file] of files.entries()) {
      const row = optimistic[index];
      if (!row) continue;
      startPending(pending.uploadSheet(index + 1, files.length, file.name));
      const form = new FormData();
      form.set('sheetCode', row.sheetCode);
      form.set('title', row.sheetCode);
      form.set('file', file, file.name);
      try {
        const result = await request<{ revision: { revision: string } }>(
          `/api/projects/${project.id}/sheet-revisions`,
          { form },
        );
        uploaded += 1;
        say(success.sheetAdded(file.name, row.sheetCode, result.revision.revision));
        setRows((current) => current.filter((entry) => entry.key !== row.key));
      } catch (caught) {
        setRows((current) =>
          current.map((entry) => (entry.key === row.key ? { ...entry, leaving: true } : entry)),
        );
        window.setTimeout(
          () => setRows((current) => current.filter((entry) => entry.key !== row.key)),
          180,
        );
        if (caught instanceof ApiError && caught.code === 'validation') {
          problem(
            refusal.refusedUpload(
              file.name,
              caught.errors.file ?? fieldErrorCopy.unsupportedFile(file.name),
            ),
          );
        } else if (caught instanceof ApiError && caught.code === 'file_too_large') {
          problem(
            refusal.refusedUpload(
              file.name,
              fieldErrorCopy.fileTooLarge(
                file.name,
                caught.extra<number>('limitBytes') ?? FILE_LIMIT_BYTES,
              ),
            ),
          );
        } else if (caught instanceof ApiError && caught.code === 'storage_unavailable') {
          problem(refusal.storageOutageUpload(file.name));
        } else {
          handleFailure(caught);
        }
      }
    }

    refresh();
    sheets.reload();
    if (files.length > 1) say(success.sheetBatch(uploaded, files.length));
  };

  const issueTransmittal = async (): Promise<void> => {
    const selected = currentRevisions.filter((entry) => chosen[entry.sheet.id] !== false);
    setBusy(true);
    startPending(pending.issueTransmittal);
    try {
      const result = await request<{ transmittal: { number: string; sheets: unknown[] } }>(
        `/api/projects/${project.id}/transmittals`,
        {
          idempotencyKey: newRetryKey(),
          body: {
            purpose,
            sheetRevisions: selected.map((entry) => ({
              sheetId: entry.sheet.id,
              revision: entry.revision.revision,
            })),
          },
        },
      );
      setIssuing(false);
      props.reloadTransmittals();
      refresh();
      say(
        success.transmittalIssued(
          result.transmittal.number,
          result.transmittal.sheets.length,
        ),
      );
      focusWhenReady(`[data-transmittal="${result.transmittal.number}"]`);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'storage_unavailable') {
        problem(refusal.storageOutageTransmittal);
        focusFirstDialogButton();
      } else if (caught instanceof ApiError && caught.code === 'validation') {
        problem(caught.errors.sheetRevisions ?? fieldErrorCopy.supersededInSet());
        focusFirstDialogButton();
      } else {
        handleFailure(caught, { draft: { formKey: 'issue-set', values: { purpose } } });
      }
    } finally {
      setBusy(false);
    }
  };

  const download = async (path: string, fileName: string): Promise<void> => {
    try {
      await saveBlob(path, fileName);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'storage_unavailable') {
        problem(refusal.storageOutageDownload);
      } else {
        handleFailure(caught);
      }
    }
  };

  return (
    <Panel
      sheetCode={props.sheetCode}
      revision={props.revision}
      name={props.panelName}
      heading={<h2 className="panel-heading">Drawings</h2>}
    >
      {mayUpload ? (
        <div className="panel-actions">
          <button
            type="button"
            className="primary"
            onClick={() => batchInput.current?.click()}
          >
            Upload sheets
          </button>
          <button type="button" onClick={() => setIssuing(true)}>
            Issue set
          </button>
        </div>
      ) : null}

      <div className="field" hidden>
        <label className="field-label" htmlFor={`${formId}-sheet-files`}>
          Sheet files
        </label>
        <input
          id={`${formId}-sheet-files`}
          ref={batchInput}
          type="file"
          multiple
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = '';
            if (files.length > 0) void uploadFiles(files);
          }}
        />
        <label className="field-label" htmlFor={`${formId}-revision-file`}>
          New revision file
        </label>
        <input
          id={`${formId}-revision-file`}
          ref={revisionInput}
          type="file"
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = '';
            if (files.length > 0) void uploadFiles(files, revisionTarget.current);
          }}
        />
      </div>

      <TableRegion label="Drawing register table">
        <table>
          <caption>Drawing register</caption>
          <thead>
            <tr>
              <th scope="col">Sheet</th>
              <th scope="col">Title</th>
              <th scope="col">Revision</th>
              <th scope="col">State</th>
              <th scope="col" className="numeric">
                Bytes
              </th>
              <th scope="col">Uploaded</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.key}
                className={`uploading-row ${row.leaving ? 'row-leaving' : ''}`.trim()}
              >
                <th scope="row">{row.sheetCode}</th>
                <td>{row.fileName}</td>
                <td>—</td>
                <td>Uploading</td>
                <td className="numeric">—</td>
                <td>—</td>
                <td />
              </tr>
            ))}
            {register.map((sheet) =>
              sheet.revisions
                .slice()
                .reverse()
                .map((revision) => (
                  <tr key={`${sheet.id}-${revision.revision}`}>
                    <th scope="row">{sheet.code}</th>
                    <td>{sheet.title}</td>
                    <td>{revision.revision}</td>
                    <td>{revision.state === 'current' ? 'Current' : 'Superseded'}</td>
                    <td className="numeric">{formatByteLimit(revision.bytes)}</td>
                    <td>
                      {`${revision.uploadedBy ?? 'Studio'} · ${formatInstant(
                        new Date(revision.uploadedAt),
                        HK_ZONE,
                      )}`}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          onClick={() =>
                            void download(
                              `/api/sheets/${sheet.id}/revisions/${revision.revision}/file`,
                              revision.originalName,
                            )
                          }
                        >
                          {`Download ${sheet.code} rev ${revision.revision}`}
                        </button>
                        {revision.state === 'current' ? (
                          <>
                            <button type="button" onClick={() => setHistory(sheet)}>
                              {`History of ${sheet.code}`}
                            </button>
                            {mayUpload ? (
                              <button
                                type="button"
                                onClick={() => {
                                  revisionTarget.current = sheet.code;
                                  revisionInput.current?.click();
                                }}
                              >
                                {`New revision of ${sheet.code}`}
                              </button>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )),
            )}
          </tbody>
        </table>
      </TableRegion>

      <h3>Transmittals</h3>
      {props.transmittals.length === 0 ? (
        <p className="meta">No set has been issued yet.</p>
      ) : (
        <ul>
          {props.transmittals.map((transmittal) => (
            <li key={transmittal.id}>
              <a
                href={`/api/transmittals/${transmittal.id}/zip`}
                data-transmittal={transmittal.number}
                onClick={(event) => {
                  event.preventDefault();
                  void download(
                    `/api/transmittals/${transmittal.id}/zip`,
                    `${transmittal.number}.zip`,
                  );
                }}
              >
                {`Download ${transmittal.number}`}
              </a>
              <p className="meta">
                {`${TRANSMITTAL_PURPOSE_LABELS[transmittal.purpose as TransmittalPurpose]} · ${
                  transmittal.sheets.length
                } sheets · issued ${formatInstant(new Date(transmittal.issuedAt), HK_ZONE)}`}
              </p>
            </li>
          ))}
        </ul>
      )}

      {history ? (
        <Dialog
          title={`History of ${history.code}`}
          onClose={() => setHistory(null)}
          footer={
            <button type="button" onClick={() => setHistory(null)}>
              Cancel
            </button>
          }
        >
          <ul>
            {history.revisions.map((revision) => (
              <li key={revision.revision}>
                {`Revision ${revision.revision} · ${
                  revision.state === 'current' ? 'Current' : 'Superseded'
                } · ${formatByteLimit(revision.bytes)} bytes · ${revision.sha256}`}
              </li>
            ))}
          </ul>
        </Dialog>
      ) : null}

      {issuing ? (
        <Dialog
          title="Issue set"
          onClose={() => setIssuing(false)}
          footer={
            <>
              <ActionButton
                className="primary"
                busy={busy}
                pendingLabel={pending.issueTransmittal}
                onPress={() => void issueTransmittal()}
              >
                Issue transmittal
              </ActionButton>
              <button type="button" onClick={() => setIssuing(false)}>
                Cancel
              </button>
            </>
          }
        >
          {currentRevisions.map((entry) => (
            <div className="checkbox-row" key={entry.sheet.id}>
              <input
                type="checkbox"
                id={`${formId}-issue-${entry.sheet.id}`}
                checked={chosen[entry.sheet.id] !== false}
                onChange={(event) =>
                  setChosen({ ...chosen, [entry.sheet.id]: event.target.checked })
                }
              />
              <label htmlFor={`${formId}-issue-${entry.sheet.id}`}>
                {`${entry.sheet.code} rev ${entry.revision.revision}`}
              </label>
            </div>
          ))}
          <div className="field">
            <label className="field-label" htmlFor={`${formId}-purpose`}>
              Purpose
            </label>
            <select
              id={`${formId}-purpose`}
              value={purpose}
              onChange={(event) => setPurpose(event.target.value as TransmittalPurpose)}
            >
              {(
                ['for_construction', 'for_tender', 'for_information'] as TransmittalPurpose[]
              ).map((key) => (
                <option key={key} value={key}>
                  {TRANSMITTAL_PURPOSE_LABELS[key]}
                </option>
              ))}
            </select>
          </div>
        </Dialog>
      ) : null}
    </Panel>
  );
}
