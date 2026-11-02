import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ColumnReadResponse, TagMutationResponse, WithdrawResponse } from '../../shared/api';
import type { Role, Tag } from '../../shared/domain';
import { apiJson, errorMessage } from './api';
import { COPY } from './hooks';
import { Dialog, TagGlyphs } from './ui';

export interface TagActionState {
  busy: boolean;
}

interface ColumnDetailProps {
  column: ColumnReadResponse;
  role: Role;
  live: boolean;
  onAction: (text: string) => void;
  /** Re-reads the column, asset and search in one paint after a confirmed change. */
  onConfirmed: () => Promise<void>;
  onRefused: () => Promise<void>;
  focusHeadingRef: React.RefObject<HTMLHeadingElement>;
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
}

/**
 * The Column detail region with its tag and suppression controls. Focus after a
 * confirmed or refused action follows the DP-37 order; a confirm repaints the
 * column, asset counts, result row and facets in one paint.
 */
export function ColumnDetail(props: ColumnDetailProps): ReactNode {
  const { column, role, live, onAction, onConfirmed, onRefused, focusHeadingRef, dialogOpen, setDialogOpen } = props;
  const writable = live && (role === 'Steward' || role === 'Admin');
  const [busy, setBusy] = useState(false);
  const [suppressTag, setSuppressTag] = useState<Tag | null>(null);
  const [justification, setJustification] = useState('');
  const [dialogErrors, setDialogErrors] = useState<Record<string, string>>({});
  const [dialogStatus, setDialogStatus] = useState('');
  const withdrawRef = useRef<HTMLButtonElement>(null);
  const tagRef = useRef<HTMLButtonElement>(null);
  const suppressRef = useRef<HTMLButtonElement>(null);
  const liftRef = useRef<HTMLButtonElement>(null);

  const tag = column.effective_tags;
  const direct = column.direct_tags;
  const suppressed = column.suppressed_tags;

  /** The DP-37 replacement control for one tag, in the published order. */
  const focusReplacement = (t: Tag): void => {
    const el =
      (direct.includes(t) && withdrawRef.current) ||
      tagRef.current ||
      suppressRef.current ||
      liftRef.current ||
      focusHeadingRef.current;
    el?.focus();
  };

  const mutate = async (path: string, method: 'POST' | 'DELETE', body: Record<string, unknown> | null, success: (data: unknown) => void): Promise<void> => {
    if (busy) return;
    setBusy(true);
    const res = await apiJson<TagMutationResponse>(method, path, body ?? {});
    setBusy(false);
    if (res.status >= 200 && res.status < 300) {
      success(res.body);
      onAction('');
      await onConfirmed();
    } else if (res.status === 409) {
      onAction(errorMessage(res.body, 'That change was refused.'));
      await onRefused();
    } else {
      onAction(errorMessage(res.body, 'That change was refused.'));
      await onRefused();
    }
  };

  const onTag = (t: Tag): void => {
    void mutate(`/api/columns/${encodeURIComponent(column.id)}/tags`, 'POST', { tag: t }, (data) => {
      const body = data as TagMutationResponse;
      onAction(`${t} tag added to ${column.id}.`);
      focusReplacement(t);
      void body;
    });
  };

  const onWithdraw = (t: Tag): void => {
    void mutate(`/api/columns/${encodeURIComponent(column.id)}/tags/${t}`, 'DELETE', null, (data) => {
      const body = data as WithdrawResponse;
      onAction(
        body.still_reaching === 0
          ? `${t} tag withdrawn from ${column.id}.`
          : `${t} tag withdrawn from ${column.id}. Still reaches ${body.still_reaching} columns through other paths.`
      );
      focusReplacement(t);
    });
  };

  const onLift = (t: Tag): void => {
    void mutate(`/api/columns/${encodeURIComponent(column.id)}/suppressions/${t}`, 'DELETE', null, () => {
      onAction(`${t} suppression lifted on ${column.id}.`);
      focusReplacement(t);
    });
  };

  const onSuppress = (t: Tag): void => {
    setSuppressTag(t);
    setJustification('');
    setDialogErrors({});
    setDialogStatus('');
    setDialogOpen(true);
  };

  const submitSuppress = async (): Promise<void> => {
    if (!suppressTag) return;
    const res = await apiJson<TagMutationResponse>(
      'POST',
      `/api/columns/${encodeURIComponent(column.id)}/suppressions`,
      { tag: suppressTag, justification }
    );
    if (res.status === 201) {
      const t = suppressTag;
      onAction(`${t} suppressed on ${column.id}.`);
      setDialogOpen(false);
      setSuppressTag(null);
      await onConfirmed();
      focusReplacement(t);
    } else if (res.status === 422) {
      const fields = (res.body as { error?: { fields?: Record<string, string> } }).error?.fields ?? {};
      setDialogErrors(fields);
      setDialogStatus(Object.values(fields)[0] ?? '');
    } else if (res.status === 409) {
      onAction(errorMessage(res.body, 'That change was refused.'));
      setDialogStatus(errorMessage(res.body, 'That change was refused.'));
      await onRefused();
    } else {
      setDialogStatus(errorMessage(res.body, 'That change was refused.'));
    }
  };

  return (
    <section className="column-detail" aria-label="Column detail">
      <h3 className="detail-heading" tabIndex={-1} ref={focusHeadingRef}>
        {column.id}
      </h3>
      <div className="column-tags">
        <div className="tag-row">
          <span className="tag-row-label">Direct tags</span>
          {direct.length > 0 ? <TagGlyphs tags={direct} /> : <span className="muted">None</span>}
        </div>
        <div className="tag-row">
          <span className="tag-row-label">Inherited tags</span>
          {tag.filter((t) => !direct.includes(t)).length > 0 ? (
            <TagGlyphs tags={tag.filter((t) => !direct.includes(t))} />
          ) : (
            <span className="muted">None</span>
          )}
        </div>
        <div className="tag-row">
          <span className="tag-row-label">Suppressed tags</span>
          {suppressed.length > 0 ? <TagGlyphs tags={suppressed} /> : <span className="muted">None</span>}
        </div>
      </div>
      {tag.length > 0 && (
        <ul className="tag-sources" aria-label="Tag sources">
          {tag.flatMap((t) =>
            (column.tag_sources[t] ?? []).map((source) => (
              <li key={`${t}-${source}`}>
                <span className="mono">{t}</span>{' '}
                {source === column.id ? COPY.tagSourceDirect(t) : COPY.tagSourceInherited(t, source)}
              </li>
            ))
          )}
        </ul>
      )}
      {writable && (
        <div className="tag-controls">
          {(['Confidential', 'PII'] as Tag[]).flatMap((t) => {
            const buttons: ReactNode[] = [];
            if (!tag.includes(t) && !suppressed.includes(t)) {
              buttons.push(
                <button
                  key={`tag-${t}`}
                  ref={tagRef}
                  type="button"
                  className="btn tag-btn"
                  onClick={() => onTag(t)}
                  disabled={busy}
                >
                  Tag {t}
                </button>
              );
            }
            if (direct.includes(t)) {
              buttons.push(
                <button
                  key={`withdraw-${t}`}
                  ref={withdrawRef}
                  type="button"
                  className="btn tag-btn"
                  onClick={() => onWithdraw(t)}
                  disabled={busy}
                >
                  Withdraw {t}
                </button>
              );
            }
            if (tag.includes(t) && !direct.includes(t) && !suppressed.includes(t)) {
              buttons.push(
                <button
                  key={`suppress-${t}`}
                  ref={suppressRef}
                  type="button"
                  className="btn tag-btn"
                  onClick={() => onSuppress(t)}
                  disabled={busy}
                >
                  Suppress {t}
                </button>
              );
            }
            if (suppressed.includes(t)) {
              buttons.push(
                <button
                  key={`lift-${t}`}
                  ref={liftRef}
                  type="button"
                  className="btn tag-btn"
                  onClick={() => onLift(t)}
                  disabled={busy}
                >
                  Lift {t} suppression
                </button>
              );
            }
            return buttons;
          })}
        </div>
      )}
      <div className="samples-block">
        <span className="tag-row-label">Samples</span>
        <div className="samples mono">
          {column.samples.map((s, i) => (
            <span key={i} className="sample">
              {s}
            </span>
          ))}
        </div>
      </div>
      {dialogOpen && suppressTag && (
        <Dialog
          title="Suppress tag"
          onClose={() => {
            setDialogOpen(false);
            setSuppressTag(null);
            suppressRef.current?.focus();
          }}
          onOpen={(node) => {
            if (node) {
              const input = node.querySelector('textarea') as HTMLElement | null;
              input?.focus();
            }
          }}
        >
          <label className="field">
            <span className="field-label">Justification</span>
            <textarea
              className="input"
              value={justification}
              aria-label="Justification"
              aria-invalid={dialogErrors.justification !== undefined}
              aria-describedby={dialogErrors.justification !== undefined ? 'suppress-justification-error' : undefined}
              onChange={(e) => setJustification(e.target.value)}
            />
            {dialogErrors.justification !== undefined && (
              <span id="suppress-justification-error" className="field-error">
                {dialogErrors.justification}
              </span>
            )}
          </label>
          <p role="status" aria-label="Dialog status" aria-live="polite" className="status dialog-status">
            {dialogStatus}
          </p>
          <div className="dialog-actions">
            <button
              type="button"
              className="btn primary"
              onClick={() => void submitSuppress()}
            >
              Suppress tag
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setDialogOpen(false);
                setSuppressTag(null);
                suppressRef.current?.focus();
              }}
            >
              Cancel
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
