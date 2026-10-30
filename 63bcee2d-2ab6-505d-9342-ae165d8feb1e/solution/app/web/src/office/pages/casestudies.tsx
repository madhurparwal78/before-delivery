import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { del, post } from "../../api";
import { formatTime } from "../../../../shared/format";
import { otherIllegal } from "../copy";
import { useOffice } from "../context";
import { Dialog, focusRefusal, openDialog } from "../dialog";
import { ErrorSummary, SelectField, TextField, type Errors } from "../fields";
import { ActionButton, focusId } from "../layout";
import { useResource } from "../resource";
import { OfficeShell } from "../shell";
import "./casestudies.css";

// The director's case studies: state, preview links, publish and withdraw.

interface CaseStudy {
  id: string;
  title: string;
  slug: string;
  sector: string;
  brand: { id: string; name: string };
  location: string;
  state: "draft" | "preview_sent" | "client_approved" | "published" | "withdrawn";
  featured: boolean;
  coverUrl: string;
  publishedAt: string | null;
  previewLinks: { id: string; expiresAt: string }[];
  actions: ("send_preview" | "publish" | "withdraw")[];
}

const STATE_LABEL: Record<CaseStudy["state"], string> = {
  draft: "Draft", preview_sent: "Preview sent", client_approved: "Client approved", published: "Published", withdrawn: "Withdrawn",
};
const SECTORS = [{ value: "retail", label: "Retail" }, { value: "workplace", label: "Workplace" }, { value: "food_beverage", label: "Food & beverage" }];
const SECTOR_LABEL: Record<string, string> = Object.fromEntries(SECTORS.map((s) => [s.value, s.label]));
const statusId = (id: string): string => `case-status-${id}`;

/** A Hong Kong wall-clock `YYYY-MM-DDTHH:mm` (Hong Kong keeps +08:00 all year) as a UTC instant; what was typed when it isn't one. */
function hongKongInstant(typed: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(typed)) return typed;
  const instant = new Date(`${typed.length === 16 ? `${typed}:00` : typed}+08:00`);
  return Number.isNaN(instant.getTime()) ? typed : instant.toISOString();
}

const EMPTY_STUDY = { title: "", slug: "", sector: "", brandId: "", location: "", summary: "", body: "", featured: "true" };

export function CaseStudiesPage() {
  const office = useOffice();
  const list = useResource<{ caseStudies: CaseStudy[] }>(office.member ? "/api/case-studies" : null);
  const brands = useResource<{ brands: { id: string; name: string }[] }>(office.member ? "/api/brands" : null);
  const [preview, setPreview] = useState<{ study: CaseStudy; expires: string; errors: Errors } | null>(null);
  const [withdraw, setWithdraw] = useState<CaseStudy | null>(null);
  const [creating, setCreating] = useState<{ values: typeof EMPTY_STUDY; errors: Errors } | null>(null);
  const restored = useRef(false);

  // A draft kept when the session ended reopens its form.
  useEffect(() => {
    if (!list.data || restored.current) return;
    restored.current = true;
    const values = office.takeDraft("new-case-study");
    if (values) setCreating({ values: { ...EMPTY_STUDY, ...(values as typeof EMPTY_STUDY) }, errors: {} });
    for (const study of list.data.caseStudies) {
      const kept = office.takeDraft(`send-preview-${study.id}`);
      if (kept) setPreview({ study, expires: String(kept.expires ?? ""), errors: {} });
    }
  }, [list.data, office]);

  const refusedTransition = (result: { ok: false; status: number; body: { error: string; [key: string]: unknown } }): void => {
    const body = office.refused(result);
    if (body) office.alert(otherIllegal(String(body.from ?? "changed")));
  };

  const sendPreview = async (): Promise<void> => {
    if (!preview) return;
    office.announce("Sending preview…");
    const result = await post<{ previewLink: { expiresAt: string }; approvers: number }>(
      `/api/case-studies/${preview.study.id}/preview-links`, { expiresAt: hongKongInstant(preview.expires) });
    if (result.ok) {
      flushSync(() => setPreview(null));
      office.announce(`Preview sent to ${result.data.approvers} approvers. The link works until ${formatTime(result.data.previewLink.expiresAt)}.`);
      await list.reload();
      return;
    }
    office.announce("");
    const body = office.refused(result, { id: `send-preview-${preview.study.id}`, values: { expires: preview.expires } });
    if (!body) return;
    if (body.errors) {
      flushSync(() => setPreview({ ...preview, errors: body.errors ?? {} }));
      focusRefusal(openDialog());
    } else {
      office.alert(otherIllegal(String(body.from ?? "changed")));
      focusRefusal(openDialog());
    }
  };

  const transition = async (study: CaseStudy, action: "publish" | "withdraw"): Promise<void> => {
    office.announce(action === "publish" ? "Publishing…" : "Withdrawing…");
    const result = await post(`/api/case-studies/${study.id}/${action}`, {});
    if (!result.ok) {
      office.announce("");
      refusedTransition(result);
      return;
    }
    if (action === "withdraw") flushSync(() => setWithdraw(null));
    office.announce(action === "publish" ? `${study.title} is live.` : `${study.title} withdrawn from the public site.`);
    await list.reload();
    focusId(statusId(study.id));
  };

  const revoke = async (study: CaseStudy, linkId: string): Promise<void> => {
    office.announce("Revoking…");
    const result = await del(`/api/preview-links/${linkId}`);
    if (!result.ok) {
      office.announce("");
      refusedTransition(result);
      return;
    }
    office.announce("Preview link revoked.");
    await list.reload();
    focusId(statusId(study.id));
  };

  const create = async (): Promise<void> => {
    if (!creating) return;
    const { values } = creating;
    office.announce("Saving…");
    const result = await post<{ caseStudy: CaseStudy }>("/api/case-studies", { ...values, featured: values.featured === "true" });
    if (result.ok) {
      flushSync(() => setCreating(null));
      office.announce(`${result.data.caseStudy.title} saved as a draft.`);
      await list.reload();
      focusId(statusId(result.data.caseStudy.id));
      return;
    }
    office.announce("");
    const body = office.refused(result, { id: "new-case-study", values });
    if (!body) return;
    const errors = body.errors ?? (body.error === "slug_exists" ? { slug: "Another case study already uses this slug." } : {});
    flushSync(() => setCreating({ values, errors }));
    focusRefusal(openDialog());
  };

  const studies = list.data?.caseStudies ?? [];
  const setValue = (name: keyof typeof EMPTY_STUDY) => (value: string): void =>
    setCreating((current) => current && { ...current, values: { ...current.values, [name]: value } });

  return (
    <OfficeShell title="Case studies">
      <div className="page-head">
        <div>
          <p className="eyebrow">Public site · Director</p>
          <h1>Case studies</h1>
        </div>
        <button type="button" className="button button-primary" onClick={() => setCreating({ values: EMPTY_STUDY, errors: {} })}>New case study</button>
      </div>
      {!list.data && <p className="loading-line">Loading case studies…</p>}
      <ul className="case-studies">
        {studies.map((study) => (
          <li key={study.id}>
            <article className="case-study panel">
              {study.state === "published"
                ? <img className="case-study-cover" src={study.coverUrl} alt="" width={160} height={100} />
                : <div className="case-study-cover case-study-cover-blank" aria-hidden="true">{STATE_LABEL[study.state]}</div>}
              <div className="case-study-main">
                <h2>{study.title}</h2>
                <p className="case-study-meta">{SECTOR_LABEL[study.sector]} · {study.brand.name} · {study.location}{study.featured ? " · Featured" : ""}</p>
                <h3 id={statusId(study.id)} tabIndex={-1} className="case-study-status-heading">Case study status</h3>
                <p className={`case-study-state state-${study.state}`}>{STATE_LABEL[study.state]}</p>
                {study.previewLinks.map((link) => (
                  <p key={link.id} className="case-study-link">Preview link works until {formatTime(link.expiresAt)}.</p>
                ))}
              </div>
              <div className="actions case-study-actions">
                {study.actions.includes("send_preview") && (
                  <button type="button" className="button" onClick={() => setPreview({ study, expires: "", errors: {} })}>Send preview</button>
                )}
                {study.previewLinks.map((link) => (
                  <ActionButton key={link.id} pending="Revoking…" onAction={() => revoke(study, link.id)}>Revoke preview link</ActionButton>
                ))}
                {study.actions.includes("publish") && (
                  <ActionButton primary pending="Publishing…" onAction={() => transition(study, "publish")}>Publish</ActionButton>
                )}
                {study.actions.includes("withdraw") && (
                  <>
                    <a className="button" href={`/work/${study.slug}`}>View on the site</a>
                    <button type="button" className="button" onClick={() => setWithdraw(study)}>Withdraw</button>
                  </>
                )}
              </div>
            </article>
          </li>
        ))}
      </ul>

      <Dialog title="Send preview" open={!!preview} onCancel={() => setPreview(null)}
        actions={<ActionButton primary type="submit" pending="Sending preview…" onAction={sendPreview}>Send preview link</ActionButton>}>
        {preview && (
          <>
            <p className="dialog-lede">Each client approver of {preview.study.brand.name} gets their own email with the link to “{preview.study.title}”.</p>
            <ErrorSummary errors={preview.errors} form="send-preview" />
            <TextField form="send-preview" name="expiresAt" label="Link expires at" type="datetime-local" step="60" value={preview.expires}
              hint="Hong Kong time" error={preview.errors.expiresAt}
              onChange={(value) => setPreview((current) => current && { ...current, expires: value })} />
          </>
        )}
      </Dialog>

      <Dialog title="Withdraw case study" open={!!withdraw} onCancel={() => setWithdraw(null)}
        actions={withdraw && (
          <ActionButton primary type="submit" pending="Withdrawing…" onAction={() => transition(withdraw, "withdraw")}>Withdraw from public site</ActionButton>
        )}>
        {withdraw && <p>“{withdraw.title}” leaves the public grid, the featured rail, the sector counts and its address at once. Withdrawal is final.</p>}
      </Dialog>

      <Dialog title="New case study" open={!!creating} onCancel={() => setCreating(null)}
        actions={<ActionButton primary type="submit" pending="Saving…" onAction={create}>Save draft case study</ActionButton>}>
        {creating && (
          <>
            <ErrorSummary errors={creating.errors} form="new-case" />
            <TextField form="new-case" name="title" label="Title" value={creating.values.title} onChange={setValue("title")} error={creating.errors.title} />
            <TextField form="new-case" name="slug" label="Slug" value={creating.values.slug} onChange={setValue("slug")} error={creating.errors.slug}
              hint="Lowercase letters, digits and hyphens, as in its address /work/slug" />
            <SelectField form="new-case" name="sector" label="Sector" value={creating.values.sector} onChange={setValue("sector")}
              error={creating.errors.sector} placeholder="Choose a sector" options={SECTORS} />
            <SelectField form="new-case" name="brandId" label="Brand" value={creating.values.brandId} onChange={setValue("brandId")}
              error={creating.errors.brandId} placeholder="Choose a brand"
              options={(brands.data?.brands ?? []).map((brand) => ({ value: brand.id, label: brand.name }))} />
            <TextField form="new-case" name="location" label="Location" value={creating.values.location} onChange={setValue("location")} error={creating.errors.location} />
            <TextField form="new-case" name="summary" label="Summary" multiline value={creating.values.summary} onChange={setValue("summary")} error={creating.errors.summary} />
            <TextField form="new-case" name="body" label="Body" multiline value={creating.values.body} onChange={setValue("body")} error={creating.errors.body} />
            <SelectField form="new-case" name="featured" label="Featured on the home page" value={creating.values.featured} onChange={setValue("featured")}
              options={[{ value: "true", label: "Yes, in the featured rail" }, { value: "false", label: "No" }]} />
          </>
        )}
      </Dialog>
    </OfficeShell>
  );
}
