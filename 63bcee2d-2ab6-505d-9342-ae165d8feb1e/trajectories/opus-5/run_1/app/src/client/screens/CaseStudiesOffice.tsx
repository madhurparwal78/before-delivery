import { useId, useState } from 'react';
import {
  CASE_STUDY_STATE_LABELS,
  HK_ZONE,
  SECTORS,
  SECTOR_LABELS,
  type CaseStudyState,
  type Sector,
} from '../../shared/domain.js';
import { formatInstant } from '../../shared/format.js';
import { ApiError, request } from '../lib/api.js';
import { useAnnouncer } from '../lib/announce.jsx';
import { pending, refusal, success } from '../lib/copy.js';
import { clearDraft, readDraft } from '../lib/drafts.js';
import { setPageTitle } from '../lib/router.jsx';
import { useResource, useWorkspace } from '../lib/workspace.jsx';
import { ActionButton } from '../components/Buttons.jsx';
import { Dialog, focusFirstDialogButton } from '../components/Dialog.jsx';
import { ErrorSummary, Field, focusFieldError, useFormErrors } from '../components/Fields.jsx';
import { focusWhenReady } from '../lib/focus.js';

interface PreviewLink {
  id: string;
  url: string;
  expiresAt: string;
  revoked: boolean;
}

interface CaseStudy {
  id: string;
  title: string;
  slug: string;
  sector: Sector;
  brand: { id: string; name: string };
  location: string;
  summary: string;
  body: string;
  featured: boolean;
  state: CaseStudyState;
  coverUrl: string;
  previewLinks: PreviewLink[];
}

interface NewForm {
  title: string;
  slug: string;
  sector: Sector;
  brandId: string;
  location: string;
  summary: string;
  body: string;
  featured: boolean;
}

const EMPTY: NewForm = {
  title: '',
  slug: '',
  sector: 'retail',
  brandId: '',
  location: '',
  summary: '',
  body: '',
  featured: false,
};

export function CaseStudiesOffice({ restoreForm }: { restoreForm: string | null }): JSX.Element {
  const formId = useId();
  const { startPending, say, problem } = useAnnouncer();
  const { member, refresh, handleFailure } = useWorkspace();
  const errors = useFormErrors();
  const { data } = useResource<{ caseStudies: CaseStudy[] }>('/api/case-studies');
  const brands = useResource<{ brands: { id: string; name: string }[] }>('/api/brands');
  const [dialog, setDialog] = useState<
    | { kind: 'new' }
    | { kind: 'preview'; target: CaseStudy }
    | { kind: 'withdraw'; target: CaseStudy }
    | null
  >(() => (restoreForm === 'new-case-study' ? { kind: 'new' } : null));
  const [form, setForm] = useState<NewForm>(() => {
    if (restoreForm === 'new-case-study' && member) {
      const draft = readDraft(member.id, 'new-case-study');
      if (draft) {
        clearDraft(member.id, 'new-case-study');
        return { ...EMPTY, ...(draft as Partial<NewForm>) };
      }
    }
    return EMPTY;
  });
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);

  setPageTitle('Case studies · Marrow Hall Interiors');
  const studies = data?.caseStudies ?? [];

  const focusStatus = (id: string): void =>
    focusWhenReady(`[data-case-status="${id}"]`);

  const create = async (): Promise<void> => {
    setBusy(true);
    errors.clear();
    startPending(pending.publishCaseStudy);
    try {
      await request('/api/case-studies', { body: { ...form } });
      setDialog(null);
      setForm(EMPTY);
      refresh();
      say(success.caseStudyPublished(form.title));
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'validation') {
        errors.set(caught.errors);
        const first = Object.keys(caught.errors)[0];
        if (first) focusFieldError(formId, first);
      } else if (caught instanceof ApiError && caught.code === 'slug_exists') {
        problem(refusal.otherIllegal('already in use'));
        focusFirstDialogButton();
      } else {
        handleFailure(caught, { draft: { formKey: 'new-case-study', values: { ...form } } });
      }
    } finally {
      setBusy(false);
    }
  };

  const sendPreview = async (target: CaseStudy): Promise<void> => {
    setBusy(true);
    errors.clear();
    startPending(pending.sendPreview);
    try {
      const result = await request<{
        previewLink: { expiresAt: string };
        approversNotified: number;
      }>(`/api/case-studies/${target.id}/preview-links`, { body: { expiresAt } });
      setDialog(null);
      refresh();
      say(
        success.previewSent(
          result.approversNotified,
          formatInstant(new Date(result.previewLink.expiresAt), HK_ZONE),
        ),
      );
      focusStatus(target.id);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'validation') {
        errors.set(caught.errors);
        const first = Object.keys(caught.errors)[0];
        if (first) focusFieldError(formId, first);
      } else {
        handleFailure(caught, {
          draft: { formKey: 'send-preview', values: { expiresAt } },
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const act = async (
    target: CaseStudy,
    action: 'publish' | 'withdraw',
  ): Promise<void> => {
    setBusy(true);
    say(action === 'publish' ? pending.publishCaseStudy : pending.withdrawCaseStudy);
    try {
      await request(`/api/case-studies/${target.id}/${action}`, { body: {} });
      setDialog(null);
      refresh();
      say(
        action === 'publish'
          ? success.caseStudyPublished(target.title)
          : success.caseStudyWithdrawn(target.title),
      );
      focusStatus(target.id);
    } catch (caught) {
      handleFailure(caught, {
        describe: (error) =>
          error.code === 'illegal_transition'
            ? refusal.otherIllegal(CASE_STUDY_STATE_LABELS[target.state].toLowerCase())
            : null,
      });
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (target: CaseStudy, link: PreviewLink): Promise<void> => {
    setBusy(true);
    startPending(pending.revokePreview);
    try {
      await request(`/api/preview-links/${link.id}`, { method: 'DELETE' });
      refresh();
      say(success.previewRevoked);
      focusStatus(target.id);
    } catch (caught) {
      handleFailure(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <h1>Case studies</h1>
      <div className="panel-actions">
        <button
          type="button"
          className="primary"
          onClick={() => {
            errors.clear();
            setForm(EMPTY);
            setDialog({ kind: 'new' });
          }}
        >
          New case study
        </button>
      </div>

      <div className="stack">
        {studies.map((study) => {
          const live = study.previewLinks.find((link) => !link.revoked);
          return (
            <article className="stage" key={study.id}>
              <h2 className="stage-heading">{study.title}</h2>
              <p className="meta">
                {`${SECTOR_LABELS[study.sector]} · ${study.location} · ${study.brand.name}`}
              </p>
              <h3
                className="stage-state"
                data-case-status={study.id}
                tabIndex={-1}
              >
                Case study status
              </h3>
              <p>{CASE_STUDY_STATE_LABELS[study.state]}</p>
              {live ? (
                <p className="meta">
                  {`Preview link works until ${formatInstant(new Date(live.expiresAt), HK_ZONE)}: `}
                  <a href={live.url}>{live.url}</a>
                </p>
              ) : null}
              <div className="row-actions">
                {study.state === 'draft' || study.state === 'preview_sent' ? (
                  <button
                    type="button"
                    onClick={() => {
                      errors.clear();
                      setExpiresAt('');
                      setDialog({ kind: 'preview', target: study });
                    }}
                  >
                    Send preview
                  </button>
                ) : null}
                {live ? (
                  <ActionButton
                    busy={busy}
                    pendingLabel={pending.revokePreview}
                    onPress={() => void revoke(study, live)}
                  >
                    Revoke preview link
                  </ActionButton>
                ) : null}
                {study.state === 'client_approved' ? (
                  <ActionButton
                    className="primary"
                    busy={busy}
                    pendingLabel={pending.publishCaseStudy}
                    onPress={() => void act(study, 'publish')}
                  >
                    Publish
                  </ActionButton>
                ) : null}
                {study.state === 'published' ? (
                  <button
                    type="button"
                    onClick={() => setDialog({ kind: 'withdraw', target: study })}
                  >
                    Withdraw
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      {dialog?.kind === 'new' ? (
        <Dialog
          title="New case study"
          onClose={() => setDialog(null)}
          footer={
            <>
              <ActionButton
                className="primary"
                busy={busy}
                pendingLabel={pending.publishCaseStudy}
                onPress={() => void create()}
              >
                Save case study
              </ActionButton>
              <button type="button" onClick={() => setDialog(null)}>
                Cancel
              </button>
            </>
          }
        >
          <ErrorSummary formId={formId} errors={errors.errors} />
          <Field formId={formId} path="title" label="Title" errors={errors.errors}>
            {(attributes) => (
              <input
                {...attributes}
                type="text"
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />
            )}
          </Field>
          <Field formId={formId} path="slug" label="Slug" errors={errors.errors}>
            {(attributes) => (
              <input
                {...attributes}
                type="text"
                value={form.slug}
                onChange={(event) => setForm({ ...form, slug: event.target.value })}
              />
            )}
          </Field>
          <Field formId={formId} path="sector" label="Sector" errors={errors.errors}>
            {(attributes) => (
              <select
                {...attributes}
                value={form.sector}
                onChange={(event) => setForm({ ...form, sector: event.target.value as Sector })}
              >
                {SECTORS.map((key) => (
                  <option key={key} value={key}>
                    {SECTOR_LABELS[key]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field formId={formId} path="brandId" label="Brand" errors={errors.errors}>
            {(attributes) => (
              <select
                {...attributes}
                value={form.brandId}
                onChange={(event) => setForm({ ...form, brandId: event.target.value })}
              >
                <option value="">Choose a brand</option>
                {(brands.data?.brands ?? []).map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field formId={formId} path="location" label="Location" errors={errors.errors}>
            {(attributes) => (
              <input
                {...attributes}
                type="text"
                value={form.location}
                onChange={(event) => setForm({ ...form, location: event.target.value })}
              />
            )}
          </Field>
          <Field formId={formId} path="summary" label="Summary" errors={errors.errors}>
            {(attributes) => (
              <textarea
                {...attributes}
                rows={3}
                value={form.summary}
                onChange={(event) => setForm({ ...form, summary: event.target.value })}
              />
            )}
          </Field>
          <Field formId={formId} path="body" label="Body" errors={errors.errors}>
            {(attributes) => (
              <textarea
                {...attributes}
                rows={8}
                value={form.body}
                onChange={(event) => setForm({ ...form, body: event.target.value })}
              />
            )}
          </Field>
          <div className="checkbox-row">
            <input
              type="checkbox"
              id={`${formId}-featured`}
              checked={form.featured}
              onChange={(event) => setForm({ ...form, featured: event.target.checked })}
            />
            <label htmlFor={`${formId}-featured`}>Show in the featured rail</label>
          </div>
        </Dialog>
      ) : null}

      {dialog?.kind === 'preview' ? (
        <Dialog
          title="Send preview"
          onClose={() => setDialog(null)}
          footer={
            <>
              <ActionButton
                className="primary"
                busy={busy}
                pendingLabel={pending.sendPreview}
                onPress={() => void sendPreview(dialog.target)}
              >
                Send preview link
              </ActionButton>
              <button type="button" onClick={() => setDialog(null)}>
                Cancel
              </button>
            </>
          }
        >
          <ErrorSummary formId={formId} errors={errors.errors} />
          <Field
            formId={formId}
            path="expiresAt"
            label="Link expires at"
            errors={errors.errors}
            hint="Hong Kong time, written as YYYY-MM-DDTHH:mm."
          >
            {(attributes) => (
              <input
                {...attributes}
                type="text"
                placeholder="2026-11-03T18:00"
                value={expiresAt}
                onChange={(event) => setExpiresAt(event.target.value)}
              />
            )}
          </Field>
        </Dialog>
      ) : null}

      {dialog?.kind === 'withdraw' ? (
        <Dialog
          title="Withdraw case study"
          onClose={() => setDialog(null)}
          footer={
            <>
              <ActionButton
                className="primary"
                busy={busy}
                pendingLabel={pending.withdrawCaseStudy}
                onPress={() => void act(dialog.target, 'withdraw')}
              >
                Withdraw from public site
              </ActionButton>
              <button type="button" onClick={() => setDialog(null)}>
                Cancel
              </button>
            </>
          }
        >
          <p>
            {`${dialog.target.title} goes from the public grid, the featured rail, the sector counts,
              its own address and every preview link at once. Withdrawal is final.`}
          </p>
        </Dialog>
      ) : null}
    </section>
  );
}
