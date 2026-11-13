import { useRef, useState } from 'preact/hooks';
import { ApiError, call } from '../lib/api.js';
import { useOverlay } from '../lib/overlay.js';
import { announce } from '../lib/announce.js';
import type { ImportPreview, ImportResult, Session } from '../lib/types.js';
import { copy } from '../../shared/copy.js';
import { importRowStatusLabel } from '../../shared/options.js';
import { Overlay } from '../components/Overlay.js';
import { ActionButton, DialogActions } from '../components/form.js';
import { ProblemsSummary, noProblems, problemsOf, type Problems } from '../components/Problems.js';
import { StaffShell } from '../components/StaffShell.js';
import { BottomBar, TableFrame } from '../components/layout.js';

export function ImportScreen({ session }: { session: Session }) {
  const dialog = useOverlay();
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [problems, setProblems] = useState<Problems>(noProblems);
  const [pending, setPending] = useState('');

  const refuse = (error: unknown): void => {
    if (!(error instanceof ApiError)) return;
    const { failure } = error;
    setProblems(
      Object.keys(failure.fields).length > 0
        ? problemsOf(failure.fields)
        : problemsOf({}, failure.message),
    );
    announce(failure.message);
  };

  const choose = async (file: File): Promise<void> => {
    const body = await file.text();
    setText(body);
    setPending('preview');
    try {
      const result = await call<ImportPreview>('POST', '/api/imports/preview', {
        raw: body,
        contentType: 'text/csv',
      });
      setPreview(result);
      setProblems(noProblems);
      announce(
        copy.previewReady(
          result.counts.matched,
          result.counts.new,
          result.counts.refused,
          result.counts.already,
        ),
      );
      dialog.open();
    } catch (error) {
      refuse(error);
    } finally {
      setPending('');
      if (fileInput.current !== null) fileInput.current.value = '';
    }
  };

  const save = async (): Promise<void> => {
    setPending('save');
    try {
      const result = await call<ImportResult>('POST', '/api/imports', {
        raw: text,
        contentType: 'text/csv',
      });
      announce(copy.importSaved(result.piecesCreated, result.consignorsCreated));
      setProblems(noProblems);
      dialog.close();
    } catch (error) {
      refuse(error);
    } finally {
      setPending('');
    }
  };

  return (
    <StaffShell session={session}>
      <h1 class="heading heading--1">Old spreadsheet</h1>
      {dialog.mounted ? null : (
        <ProblemsSummary problems={problems} controlIds={{ file: 'import-file' }} labels={{}} />
      )}
      <p class="field">
        <label class="field__label" for="import-file">
          Spreadsheet file
        </label>
        <input
          ref={fileInput}
          id="import-file"
          class="field__input"
          type="file"
          accept="text/csv,.csv"
          onChange={(event) => {
            const file = (event.currentTarget as HTMLInputElement).files?.[0];
            if (file !== undefined) void choose(file);
          }}
        />
      </p>

      <BottomBar>
        <button
          type="button"
          class="button button--primary"
          ref={dialog.openerRef}
          disabled={pending === 'preview'}
          onClick={() => fileInput.current?.click()}
        >
          {pending === 'preview' ? copy.working : 'Choose file'}
        </button>
      </BottomBar>

      {dialog.mounted ? (
        <Overlay state={dialog} name="Preview import" className="dialog--wide">
          <h2 class="dialog__heading">Preview import</h2>
          <ProblemsSummary problems={problems} controlIds={{}} labels={{}} />
          <TableFrame name="Rows">
            <table class="table" aria-label="Rows">
              <thead>
                <tr>
                  <th scope="col">Row</th>
                  <th scope="col">Item number</th>
                  <th scope="col">Status</th>
                  <th scope="col">Consignor</th>
                  <th scope="col">Reason</th>
                </tr>
              </thead>
              <tbody>
                {(preview?.rows ?? []).map((row) => (
                  <tr key={row.row}>
                    <td class="tabular">{row.row}</td>
                    <td class="tabular">{row.itemNo}</td>
                    <td>{importRowStatusLabel(row.status)}</td>
                    <td>{row.consignorName}</td>
                    <td>{row.reason ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
          <DialogActions>
            <ActionButton label="Save" pending={pending === 'save'} onPress={() => void save()} />
            <button type="button" class="button button--quiet" onClick={() => dialog.close()}>
              Cancel
            </button>
          </DialogActions>
        </Overlay>
      ) : null}
    </StaffShell>
  );
}
