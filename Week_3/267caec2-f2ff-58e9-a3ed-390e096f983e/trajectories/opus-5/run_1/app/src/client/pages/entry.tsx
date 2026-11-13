import type { JSX } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { api, DeskError, uploadImage } from '../api';
import type { PageProps } from '../main';
import { useCountdownPassed, useShell } from '../shell';
import type { Entry, Program, Receipt } from '../types';
import { Dialog, Field, GridLines, money, StatusLabel, useFeedback, usePending } from '../ui';
import { openProgramOf } from './studio';

interface UploadLine {
  name: string;
  fraction: number;
}

export function EntryPage({ params, navigate, user }: PageProps): JSX.Element {
  const feedback = useFeedback();
  const [pending, run] = usePending();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [entryProgram, setEntryProgram] = useState<Program | null>(null);
  const [form, setForm] = useState({ categoryId: '', title: '', summary: '', siteUrl: '', credits: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploads, setUploads] = useState<UploadLine[]>([]);
  const [dragging, setDragging] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const idempotencyKey = useRef(
    `entry-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
  );
  const receiptHeading = useRef<HTMLHeadingElement>(null);
  const entryId = params.id ?? null;

  const loadPrograms = useCallback(async () => {
    const body = await api<{ programs: Program[] }>('GET', '/api/programs');
    setPrograms(body.programs);
    return body.programs;
  }, []);

  useEffect(() => {
    void loadPrograms();
  }, [loadPrograms]);

  useEffect(() => {
    if (entryId === null) return;
    void (async () => {
      const body = await api<{ entry: Entry }>('GET', `/api/entries/${entryId}`);
      setEntry(body.entry);
      setForm({
        categoryId: body.entry.categoryId,
        title: body.entry.title,
        summary: body.entry.summary,
        siteUrl: body.entry.siteUrl,
        credits: body.entry.credits,
      });
      if (body.entry.fee !== null) {
        try {
          const paid = await api<{ receipt: Receipt }>('GET', `/api/entries/${entryId}/receipt`);
          setReceipt(paid.receipt);
        } catch {
          setReceipt(null);
        }
      }
    })();
  }, [entryId]);

  const openProgram = openProgramOf(programs);
  useEffect(() => {
    if (entry === null) {
      setEntryProgram(null);
      return;
    }
    setEntryProgram(programs.find((program) => program.id === entry.programId) ?? null);
  }, [entry, programs]);

  const program = entry === null ? openProgram : entryProgram;
  const deadlineOpen = program !== null && program.entriesOpen;
  useShell(
    program?.name ?? programs[0]?.name ?? 'Cutline Jury Desk',
    entry === null ? (openProgram?.deadlineAt ?? null) : deadlineOpen ? (program?.deadlineAt ?? null) : null,
  );
  useCountdownPassed(program?.earlyBirdEndsAt ?? null, () => void loadPrograms());

  const isDraft = entry === null || entry.state === 'draft';
  const categories = program?.categories ?? [];

  const change = (field: string) => (event: Event) =>
    setForm({ ...form, [field]: (event.target as HTMLInputElement).value });

  const applyFieldErrors = (error: unknown): never => {
    if (error instanceof DeskError && Object.keys(error.fields).length > 0) {
      setErrors(error.fields);
      const first = Object.keys(error.fields)[0];
      document.getElementById(`entry-${first}`)?.focus();
    }
    throw error;
  };

  const saveDraft = async (): Promise<Entry | undefined> => {
    setErrors({});
    feedback.say('Saving draft…');
    const result = await run(async () => {
      try {
        if (entry === null) {
          const body = await api<{ entry: Entry }>('POST', '/api/entries', form);
          return body.entry;
        }
        const body = await api<{ entry: Entry }>('PATCH', `/api/entries/${entry.id}`, form);
        return body.entry;
      } catch (error) {
        return applyFieldErrors(error);
      }
    });
    if (result === undefined) return undefined;
    setEntry(result);
    feedback.say('Draft saved.');
    if (entryId === null) window.history.replaceState({}, '', `/studio/entries/${result.id}`);
    return result;
  };

  const addFiles = async (files: File[]): Promise<void> => {
    let target = entry;
    if (target === null) {
      target = (await saveDraft()) ?? null;
      if (target === null) return;
    }
    for (const file of files) {
      setUploads((current) => [...current, { name: file.name, fraction: 0 }]);
      feedback.say(`Uploading ${file.name}…`);
      try {
        const body = await uploadImage(target.id, file, (fraction) =>
          setUploads((current) =>
            current.map((line) => (line.name === file.name ? { ...line, fraction } : line)),
          ),
        );
        feedback.say(`${file.name} added, ${body.asset.width} × ${body.asset.height} pixels.`);
      } catch (error) {
        feedback.warn(error instanceof Error ? error.message : String(error));
      } finally {
        setUploads((current) => current.filter((line) => line.name !== file.name));
      }
      const refreshed = await api<{ entry: Entry }>('GET', `/api/entries/${target.id}`);
      setEntry(refreshed.entry);
    }
  };

  const removeImage = async (assetId: string): Promise<void> => {
    if (entry === null) return;
    feedback.say('Removing image…');
    const done = await run(() => api('DELETE', `/api/entries/${entry.id}/assets/${assetId}`));
    if (done === undefined) return;
    const refreshed = await api<{ entry: Entry }>('GET', `/api/entries/${entry.id}`);
    setEntry(refreshed.entry);
    feedback.say('Image removed.');
  };

  const payAndSubmit = async (): Promise<void> => {
    if (entry === null) return;
    feedback.say('Recording your payment…');
    const result = await run(() =>
      api<{ entry: Entry; receipt: Receipt }>('POST', `/api/entries/${entry.id}/submit`, {}, {
        'Idempotency-Key': idempotencyKey.current,
      }),
    );
    if (result === undefined) return;
    setEntry(result.entry);
    setReceipt(result.receipt);
    feedback.say(`Entry ${result.entry.entryNumber} submitted. Receipt sent to ${user?.email ?? ''}.`);
    window.setTimeout(() => receiptHeading.current?.focus(), 0);
  };

  const deleteDraft = async (): Promise<void> => {
    if (entry === null) return;
    feedback.say('Deleting draft…');
    const done = await run(() => api('DELETE', `/api/entries/${entry.id}`));
    setConfirmDelete(false);
    if (done === undefined) return;
    feedback.say('Draft deleted.');
    navigate('/studio');
  };

  const withdraw = async (): Promise<void> => {
    if (entry === null) return;
    feedback.say('Withdrawing…');
    const result = await run(() =>
      api<{ entry: Entry; refund: { amountCents: number } | null }>(
        'POST',
        `/api/entries/${entry.id}/withdraw`,
        {},
      ),
    );
    setConfirmWithdraw(false);
    if (result === undefined) return;
    setEntry(result.entry);
    feedback.say(
      result.refund === null
        ? `Entry ${result.entry.entryNumber} withdrawn. No refund after the deadline.`
        : `Entry ${result.entry.entryNumber} withdrawn. Refund of $${money(result.refund.amountCents)} recorded.`,
    );
    const paid = await api<{ receipt: Receipt }>('GET', `/api/entries/${entry.id}/receipt`);
    setReceipt(paid.receipt);
  };

  const feeCents = program?.currentFeeCents ?? 0;
  const tierLabel = program?.currentTier === 'early_bird' ? 'Early-bird' : 'Standard';
  const earlyBirdOpen =
    program !== null && new Date(program.earlyBirdEndsAt).getTime() > Date.now();

  return (
    <div class="grid">
      <GridLines />
      <div class="span-12">
        <h1>{entry === null ? 'New entry' : `Entry ${entry.entryNumber}`}</h1>
        {entry === null ? null : (
          <p>
            Status: <StatusLabel state={entry.state} label={entry.statusLabel} />
          </p>
        )}
        {entry?.disqualifyReason ? <p class="disqualified">Reason: {entry.disqualifyReason}</p> : null}
      </div>

      <form
        class="span-7 stack"
        onSubmit={(event) => {
          event.preventDefault();
          void saveDraft();
        }}
      >
        <Field label="Category" id="entry-categoryId" error={errors.categoryId}>
          <select
            id="entry-categoryId"
            aria-label="Category"
            disabled={!isDraft}
            value={form.categoryId}
            onChange={change('categoryId')}
          >
            <option value="">Choose a category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Title" id="entry-title" error={errors.title}>
          <input id="entry-title" type="text" disabled={!isDraft} value={form.title} onInput={change('title')} />
        </Field>
        <Field label="Case study" id="entry-summary" error={errors.summary}>
          <textarea
            id="entry-summary"
            disabled={!isDraft}
            value={form.summary}
            onInput={change('summary')}
          />
        </Field>
        <Field label="Site address" id="entry-siteUrl" error={errors.siteUrl}>
          <input
            id="entry-siteUrl"
            type="text"
            disabled={!isDraft}
            value={form.siteUrl}
            onInput={change('siteUrl')}
          />
        </Field>
        <Field label="Credits" id="entry-credits" error={errors.credits}>
          <input
            id="entry-credits"
            type="text"
            disabled={!isDraft}
            value={form.credits}
            onInput={change('credits')}
          />
        </Field>
        {isDraft ? (
          <div>
            <button class="btn" type="submit" disabled={pending}>
              {pending ? 'Saving draft…' : 'Save draft'}
            </button>
          </div>
        ) : null}
      </form>

      <div class="span-5 stack">
        {receipt === null ? (
          <section class="region" aria-label="Fee">
            <h3>Fee</h3>
            <p class="mono">
              Entry fee ${money(feeCents)} ({tierLabel})
            </p>
            <p class="hint">
              {earlyBirdOpen
                ? `Early-bird ends ${program?.earlyBirdLabel ?? ''}`
                : `Early-bird ended ${program?.earlyBirdLabel ?? ''}`}
            </p>
            <p class="hint">Entries close {program?.deadlineLabel ?? ''}</p>
          </section>
        ) : (
          <section class="region" aria-label="Receipt">
            <h3 tabIndex={-1} ref={receiptHeading}>
              Receipt
            </h3>
            <p class="mono">
              ${money(receipt.amountCents)} ({receipt.tier === 'early_bird' ? 'Early-bird' : 'Standard'})
            </p>
            <p class="mono">Invoice {receipt.invoiceId}</p>
            <p class="hint">Paid {new Date(receipt.paidAt).toISOString().replace('T', ' ').slice(0, 19)} UTC</p>
            {receipt.refund === null ? null : (
              <p class="mono">Refunded ${money(receipt.refund.amountCents)}</p>
            )}
          </section>
        )}

        {isDraft ? (
          <section class="region">
            <h3>Case-study images</h3>
            <label for="entry-files">Add case-study images</label>
            <input
              id="entry-files"
              type="file"
              accept="image/png,image/jpeg"
              multiple
              onChange={(event) => {
                const input = event.target as HTMLInputElement;
                const files = [...(input.files ?? [])];
                input.value = '';
                void addFiles(files);
              }}
            />
            <div
              class="dropzone"
              data-over={dragging ? 'true' : 'false'}
              tabIndex={0}
              role="button"
              aria-label="Drop PNG or JPEG images here"
              onClick={() => document.getElementById('entry-files')?.click()}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  document.getElementById('entry-files')?.click();
                }
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                void addFiles([...(event.dataTransfer?.files ?? [])]);
              }}
            >
              Drop PNG or JPEG images here
            </div>
            {uploads.map((line) => (
              <p key={line.name} class="hint">
                Uploading {line.name}…
                <progress value={line.fraction} max={1} />
              </p>
            ))}
            <ul class="asset-list" aria-label="Case-study images">
              {(entry?.assets ?? []).map((asset, index) => (
                <li key={asset.id}>
                  <img src={asset.url} alt={`${entry?.title ?? ''} — image ${index + 1}`} />
                  <span class="mono">
                    {asset.width} × {asset.height}
                  </span>
                  <button
                    class="btn btn--quiet"
                    type="button"
                    onClick={() => void removeImage(asset.id)}
                  >
                    Remove image {index + 1}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <section class="region">
            <h3>Case-study images</h3>
            <ul class="asset-list" aria-label="Case-study images">
              {(entry?.assets ?? []).map((asset, index) => (
                <li key={asset.id}>
                  <img src={asset.url} alt={`${entry?.title ?? ''} — image ${index + 1}`} />
                </li>
              ))}
            </ul>
          </section>
        )}

        <div class="row-flex">
          {isDraft && entry !== null ? (
            <>
              <button class="btn" type="button" disabled={pending} onClick={() => void payAndSubmit()}>
                {pending ? 'Recording your payment…' : `Pay $${money(feeCents)} and submit`}
              </button>
              <button class="btn btn--danger" type="button" onClick={() => setConfirmDelete(true)}>
                Delete draft
              </button>
            </>
          ) : null}
          {entry?.canWithdraw ? (
            <button class="btn btn--danger" type="button" onClick={() => setConfirmWithdraw(true)}>
              Withdraw entry
            </button>
          ) : null}
        </div>
      </div>

      {confirmDelete ? (
        <Dialog title="Delete this draft?" labelledBy="delete-draft-title" onClose={() => setConfirmDelete(false)}>
          <p>This removes the entry and its images.</p>
          <div class="dialog-actions">
            <button class="btn btn--quiet" type="button" data-safe="true" onClick={() => setConfirmDelete(false)}>
              Keep draft
            </button>
            <button class="btn btn--danger" type="button" onClick={() => void deleteDraft()}>
              Delete draft
            </button>
          </div>
        </Dialog>
      ) : null}

      {confirmWithdraw && entry !== null ? (
        <Dialog title="Withdraw entry?" labelledBy="withdraw-title" onClose={() => setConfirmWithdraw(false)}>
          <p>
            {entry.refundOnWithdraw
              ? `You'll be refunded $${money(entry.fee?.amountCents ?? 0)}.`
              : 'The deadline has passed, so there is no refund.'}
          </p>
          <div class="dialog-actions">
            <button class="btn btn--quiet" type="button" data-safe="true" onClick={() => setConfirmWithdraw(false)}>
              Keep entry
            </button>
            <button class="btn btn--danger" type="button" onClick={() => void withdraw()}>
              Withdraw
            </button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
