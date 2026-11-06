import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { formatAmount, formatTime, plainAmount, type Currency } from "../../../../shared/format";
import { get, newRetryKey, patch, post, type ErrorBody, type Result } from "../../api";
import { otherIllegal } from "../copy";
import { useOffice } from "../context";
import { Dialog, focusRefusal, openDialog } from "../dialog";
import { amountInput, ErrorSummary, SelectField, TextField, useFormId, type Errors } from "../fields";
import { ActionButton, StickyBar, domId, focusId } from "../layout";
import { PanelTitle, useProject } from "../project";
import { useResource } from "../resource";
import "./variations.css";

// PL-04 Variations: raise on site (a bottom sheet on phones), edit with stale-save protection, review and
// decide, withdraw with an optimistic row that rolls back when the server refuses.

type State = "raised" | "under_review" | "approved" | "rejected" | "withdrawn";
type Action = "start_review" | "approve" | "reject" | "withdraw";

interface Person { id: string; name: string; role: string; organisation: string }

interface Variation {
  id: string;
  number: string;
  title: string;
  description: string;
  amountCents: number;
  currency: Currency;
  storeCode: string | null;
  state: State;
  rejectReason: string | null;
  raisedBy: Person;
  raisedAt: string;
  version: number;
  updatedBy: Person;
  updatedAt: string;
  /** What the signed-in member can do with this variation now, decided by the server. */
  actions: string[];
}

interface Detail {
  variation: Variation;
  comments: { id: string; body: string; author: Person; postedAt: string }[];
  history: { action: string; state: string; by: Person; at: string }[];
}

const STATE_LABEL: Record<State, string> = {
  raised: "Raised", under_review: "Under review", approved: "Approved", rejected: "Rejected", withdrawn: "Withdrawn",
};
const DONE: Record<Action, string> = { start_review: "under review", approve: "approved", reject: "rejected", withdraw: "withdrawn" };
const PAST: Record<Action, string> = { start_review: "put under review", approve: "approved", reject: "rejected", withdraw: "withdrawn" };
const HISTORY_LABEL: Record<string, string> = {
  raise: "Raised", edit: "Edited", start_review: "Review started", approve: "Approved", reject: "Rejected", withdraw: "Withdrawn",
};

interface Draft { title: string; description: string; amount: string; storeCode: string }
const EMPTY: Draft = { title: "", description: "", amount: "", storeCode: "" };

const headingId = (number: string): string => domId("variation", number);
const bodyOf = (draft: Draft) => ({
  title: draft.title, description: draft.description, amountCents: amountInput(draft.amount), storeCode: draft.storeCode || null,
});

export function VariationsPanel() {
  const office = useOffice();
  const { project } = useProject();
  const path = `/api/projects/${project.id}/variations`;
  const list = useResource<{ variations: Variation[] }>(path);
  const member = office.member;
  const lead = member?.role === "director" || member?.role === "project_lead";
  const canRaise = lead || member?.role === "contractor";

  const [overrides, setOverrides] = useState<Record<string, State>>({});
  const [raise, setRaise] = useState<{ open: boolean; draft: Draft; errors: Errors }>({ open: false, draft: EMPTY, errors: {} });
  const raiseKey = useRef(newRetryKey());
  const [edit, setEdit] = useState<{ target: Variation | null; draft: Draft; errors: Errors; base: number; latest: Variation | null; error: string }>(
    { target: null, draft: EMPTY, errors: {}, base: 0, latest: null, error: "" });
  const [reject, setReject] = useState<{ target: Variation | null; reason: string; errors: Errors }>({ target: null, reason: "", errors: {} });
  const raiseForm = useFormId("raise");
  const editForm = useFormId("edit");
  const rejectForm = useFormId("reject");

  // A draft kept when the session ended reopens the Raise variation sheet.
  useEffect(() => {
    if (!member) return;
    const kept = office.takeDraft("raise-variation");
    if (kept) {
      raiseKey.current = newRetryKey();
      setRaise({ open: true, draft: { ...EMPTY, ...(kept as Partial<Draft>) }, errors: {} });
    }
  }, [member]);

  const openRaise = (): void => {
    raiseKey.current = newRetryKey();
    setRaise({ open: true, draft: EMPTY, errors: {} });
  };

  /** Field errors stay in the dialog with focus on the first; other refusals go to the alert region. */
  const refusedInDialog = (result: Result<unknown> & { ok: false }, form: { id: string; values: Record<string, unknown> } | undefined,
    showErrors: (errors: Errors) => void, other: (body: ErrorBody) => string): void => {
    const body = office.refused(result, form);
    if (!body) {
      focusRefusal(openDialog());
      return;
    }
    if (body.error === "validation" && body.errors) {
      flushSync(() => showErrors(body.errors ?? {}));
      focusRefusal(openDialog());
      return;
    }
    office.alert(other(body));
    focusRefusal(openDialog());
  };

  const submitRaise = async (): Promise<void> => {
    const result = await post<{ variation: Variation }>(path, bodyOf(raise.draft), { idempotencyKey: raiseKey.current });
    if (!result.ok) {
      refusedInDialog(result, { id: "raise-variation", values: { ...raise.draft } },
        (errors) => setRaise((current) => ({ ...current, errors })),
        (body) => body.error === "idempotency_key_reused"
          ? "This retry doesn't match the variation it's retrying. Reload and check your variations."
          : otherIllegal(String(body.from ?? body.error)));
      return;
    }
    const number = result.data.variation.number;
    raiseKey.current = newRetryKey();
    flushSync(() => setRaise({ open: false, draft: EMPTY, errors: {} }));
    await list.reload();
    focusId(headingId(number));
    office.announce(`Variation ${number} raised.`);
  };

  const openEdit = (variation: Variation): void => {
    setEdit({
      target: variation, errors: {}, base: variation.version, latest: null, error: "",
      draft: { title: variation.title, description: variation.description, amount: plainAmount(variation.amountCents), storeCode: variation.storeCode ?? "" },
    });
  };

  const submitEdit = async (): Promise<void> => {
    const target = edit.target;
    if (!target) return;
    const result = await patch<{ variation: Variation }>(`/api/variations/${target.id}`, { version: edit.base, ...bodyOf(edit.draft) });
    if (!result.ok) {
      if (result.status === 412) {
        const latest = await get<Detail>(`/api/variations/${target.id}`);
        const copy = `${String(result.body.savedBy)} saved a newer version at ${formatTime(String(result.body.savedAt))}. ` +
          "Your changes weren't saved; they're shown beside the latest version.";
        flushSync(() => setEdit((current) => ({ ...current, errors: {}, error: copy,
          latest: latest.ok ? latest.data.variation : null, base: latest.ok ? latest.data.variation.version : current.base })));
        office.alert(copy);
        focusRefusal(openDialog());
        return;
      }
      refusedInDialog(result, undefined, (errors) => setEdit((current) => ({ ...current, errors, error: "" })),
        (body) => otherIllegal(String(body.from ?? body.error)));
      return;
    }
    flushSync(() => setEdit({ target: null, draft: EMPTY, errors: {}, base: 0, latest: null, error: "" }));
    await list.reload();
    focusId(headingId(target.number));
    office.announce(`Variation ${target.number} saved.`);
  };

  /** The refusal copy for a variation decision. */
  const refusalCopy = (variation: Variation, action: Action, body: ErrorBody): string => {
    if (body.error === "over_approval_limit") {
      return `This variation is over your approval limit of ${formatAmount(variation.currency, Number(body.limitCents))}. Ask the studio director to approve it.`;
    }
    if (body.error === "own_variation") return "You raised this variation, so someone else has to decide it.";
    if (body.error === "illegal_transition") {
      return `Variation ${variation.number} can't be ${PAST[action]} because it's already ${String(body.from).replace(/_/g, " ")}. It's back as it was.`;
    }
    return otherIllegal(String(body.from ?? body.error));
  };

  const transition = async (variation: Variation, action: Action, reason?: string): Promise<boolean> => {
    if (action === "withdraw") flushSync(() => setOverrides((current) => ({ ...current, [variation.id]: "withdrawn" })));
    const result = await post<{ variation: Variation }>(`/api/variations/${variation.id}/transitions`, reason === undefined ? { action } : { action, reason });
    const settle = (): void => flushSync(() => setOverrides((current) => {
      const next = { ...current };
      delete next[variation.id];
      return next;
    }));
    if (!result.ok) {
      settle();
      const body = office.refused(result);
      if (body?.error === "validation" && body.errors) {
        flushSync(() => setReject((current) => ({ ...current, errors: body.errors ?? {} })));
        focusRefusal(openDialog());
        return false;
      }
      if (body) office.alert(refusalCopy(variation, action, body));
      await list.reload();
      return false;
    }
    await list.reload();
    settle();
    if (!openDialog()) focusId(headingId(variation.number));
    office.announce(`Variation ${variation.number} ${DONE[action]}.`);
    return true;
  };

  const submitReject = async (): Promise<void> => {
    const target = reject.target;
    if (!target) return;
    if (await transition(target, "reject", reject.reason)) {
      flushSync(() => setReject({ target: null, reason: "", errors: {} }));
      focusId(headingId(target.number));
    }
  };

  const variations = list.data?.variations ?? [];
  const storeOptions = project.stores.map((store) => ({ value: store.code, label: `${store.code} ${store.name}` }));
  const draftFields = (form: string, draft: Draft, errors: Errors, set: (draft: Draft) => void) => (
    <>
      <ErrorSummary errors={errors} form={form} />
      <TextField form={form} name="title" label="Title" value={draft.title} error={errors.title} onChange={(title) => set({ ...draft, title })} />
      <TextField form={form} name="description" label="Description" multiline value={draft.description} error={errors.description}
        onChange={(description) => set({ ...draft, description })} />
      <TextField form={form} name="amountCents" label="Amount" inputMode="decimal" value={draft.amount} error={errors.amountCents}
        hint={`${project.currency}, like 1250.00; a negative amount is an omission`} onChange={(amount) => set({ ...draft, amount })} />
      <SelectField form={form} name="storeCode" label="Store" value={draft.storeCode} options={storeOptions} placeholder="Whole rollout"
        error={errors.storeCode} onChange={(storeCode) => set({ ...draft, storeCode })} />
    </>
  );

  return (
    <div className="variations has-action-bar">
      <PanelTitle section="variations" />
      <div className="panel-heading">
        <div>
          <h2>Variations</h2>
          <p className="panel-lede">Changes to the contract sum, raised on site and decided within each approver's limit.</p>
        </div>
        {canRaise && <button type="button" className="button button-primary" onClick={openRaise}>Raise variation</button>}
      </div>
      <div className="panel-body">
        {list.data && !variations.length && <p className="empty-line">No variations have been raised on this project.</p>}
        {!list.data && !list.failure && <p className="loading-line">Loading variations…</p>}
        <ul className="variation-list" aria-label="Variations">
          {variations.map((variation) => {
            const state = overrides[variation.id] ?? variation.state;
            const can = (action: string): boolean => !overrides[variation.id] && variation.actions.includes(action);
            return (
              <li key={variation.id} className="variation">
                <div className="variation-main">
                  <h3 id={headingId(variation.number)} tabIndex={-1}>{variation.number}</h3>
                  <p className="variation-title">{variation.title}</p>
                  <p className="variation-description">{variation.description}</p>
                  <p className="variation-meta">
                    Raised by {variation.raisedBy.name}, {variation.raisedBy.organisation} · {formatTime(variation.raisedAt, project.timeZone)}
                    {variation.storeCode ? ` · ${variation.storeCode}` : ""}
                  </p>
                  {variation.rejectReason && state === "rejected" && <p className="variation-meta">Reason: {variation.rejectReason}</p>}
                </div>
                <div className="variation-figures">
                  <p className={`variation-amount${variation.amountCents < 0 ? " omission" : ""}`}>{formatAmount(variation.currency, variation.amountCents)}</p>
                  <p className={`variation-state state-${state}`}>{STATE_LABEL[state]}</p>
                </div>
                <div className="actions variation-actions">
                  {can("start_review") && (
                    <ActionButton pending="Saving…" onAction={() => transition(variation, "start_review")}>Start review of {variation.number}</ActionButton>
                  )}
                  {can("approve") && (
                    <ActionButton primary pending="Saving…" onAction={() => transition(variation, "approve")}>Approve {variation.number}</ActionButton>
                  )}
                  {can("reject") && (
                    <button type="button" className="button" onClick={() => setReject({ target: variation, reason: "", errors: {} })}>Reject {variation.number}</button>
                  )}
                  {can("edit") && (
                    <button type="button" className="button" onClick={() => openEdit(variation)}>Edit {variation.number}</button>
                  )}
                  {can("withdraw") && (
                    <ActionButton pending="Saving…" onAction={() => transition(variation, "withdraw")}>Withdraw {variation.number}</ActionButton>
                  )}
                </div>
                <Conversation variation={variation} />
              </li>
            );
          })}
        </ul>
      </div>
      {canRaise && (
        <StickyBar>
          <button type="button" className="button button-primary" onClick={openRaise}>Raise variation</button>
        </StickyBar>
      )}

      <Dialog title="Raise variation" open={raise.open} onCancel={() => setRaise({ open: false, draft: EMPTY, errors: {} })}
        actions={<ActionButton primary type="submit" pending="Sending variation…" onAction={submitRaise}>Submit variation</ActionButton>}>
        {draftFields(raiseForm, raise.draft, raise.errors, (draft) => setRaise((current) => ({ ...current, draft })))}
      </Dialog>

      <Dialog title={edit.target ? `Edit ${edit.target.number}` : "Edit"} open={!!edit.target} error={edit.error}
        onCancel={() => setEdit({ target: null, draft: EMPTY, errors: {}, base: 0, latest: null, error: "" })}
        actions={<ActionButton primary type="submit" pending="Saving…" onAction={submitEdit}>Save changes</ActionButton>}>
        {edit.latest && (
          <section className="latest-version" aria-label="Latest version">
            <h3>Latest version, saved by {edit.latest.updatedBy.name}</h3>
            <dl>
              <dt>Title</dt><dd>{edit.latest.title}</dd>
              <dt>Description</dt><dd>{edit.latest.description}</dd>
              <dt>Amount</dt><dd>{formatAmount(edit.latest.currency, edit.latest.amountCents)}</dd>
              <dt>Store</dt><dd>{edit.latest.storeCode ?? "Whole rollout"}</dd>
            </dl>
          </section>
        )}
        {draftFields(editForm, edit.draft, edit.errors, (draft) => setEdit((current) => ({ ...current, draft })))}
      </Dialog>

      <Dialog title={reject.target ? `Reject ${reject.target.number}` : "Reject"} open={!!reject.target}
        onCancel={() => setReject({ target: null, reason: "", errors: {} })}
        actions={<ActionButton primary type="submit" pending="Saving…" onAction={submitReject}>Reject variation</ActionButton>}>
        <ErrorSummary errors={reject.errors} form={rejectForm} />
        <TextField form={rejectForm} name="reason" label="Reason" multiline value={reject.reason} error={reject.errors.reason}
          onChange={(reason) => setReject((current) => ({ ...current, reason }))} />
      </Dialog>
    </div>
  );
}

/** The variation's history and comments, loaded when opened. */
function Conversation({ variation }: { variation: Variation }) {
  const office = useOffice();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [comment, setComment] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const form = useFormId("comment");
  const box = useRef<HTMLDetailsElement>(null);

  const load = async (): Promise<void> => {
    const result = await get<Detail>(`/api/variations/${variation.id}`);
    if (result.ok) flushSync(() => setDetail(result.data));
    else office.refused(result);
  };

  const postComment = async (): Promise<void> => {
    const result = await post(`/api/variations/${variation.id}/comments`, { body: comment });
    if (!result.ok) {
      const body = office.refused(result, { id: `comment-${variation.id}`, values: { comment } });
      if (body?.error === "validation" && body.errors) {
        flushSync(() => setErrors(body.errors ?? {}));
        box.current?.querySelector<HTMLElement>(".field-error")?.focus();
      }
      return;
    }
    flushSync(() => {
      setComment("");
      setErrors({});
    });
    await load();
    office.announce("Comment posted.");
  };

  return (
    <details ref={box} className="variation-conversation" onToggle={(event) => {
      if ((event.target as HTMLDetailsElement).open) void load();
    }}>
      <summary>History and comments</summary>
      {detail && (
        <div className="conversation-body">
          <ol className="variation-history">
            {detail.history.map((entry, index) => (
              <li key={index}>{HISTORY_LABEL[entry.action] ?? entry.action} by {entry.by.name} · {formatTime(entry.at)}</li>
            ))}
          </ol>
          {detail.comments.length > 0 && (
            <ul className="variation-comments">
              {detail.comments.map((c) => (
                <li key={c.id}><p>{c.body}</p><p className="variation-meta">{c.author.name}, {c.author.organisation} · {formatTime(c.postedAt)}</p></li>
              ))}
            </ul>
          )}
          <ErrorSummary errors={errors} form={form} />
          <TextField form={form} name="body" label="Comment" multiline value={comment} error={errors.body} onChange={setComment} />
          <ActionButton pending="Posting…" onAction={postComment}>Post comment</ActionButton>
        </div>
      )}
    </details>
  );
}
