import { useRef, useState } from "react";
import { announce } from "../announce";
import { api, get } from "../api";
import { Dialog } from "../components/dialog";
import { RatingGroup } from "../components/Rating";
import { ActionButton, Band, Choices, SelectField, TextArea, TextField } from "../components/ui";
import { useAction, useLoad } from "../hooks";
import { useLive, useLiveReload } from "../live";
import { Link } from "../router";
import { Screen } from "../shell/Page";
import { monthYear, OUTCOMES, POST_KIND_NAMES, ROLE_FAMILIES } from "../../shared/reference";
import { parseShape, interviewNoteShape, payReportShape, reviewShape, withoutCompany, type FieldErrors } from "../../shared/rules";
import type { MyPost } from "../../shared/api";

type Fields = Record<string, string | number | undefined>;
const SHAPES = {
  review: withoutCompany(reviewShape),
  pay_report: withoutCompany(payReportShape),
  interview_note: withoutCompany(interviewNoteShape),
};
const statusText = (post: MyPost): string =>
  post.state === "rejected" ? `Rejected: ${post.reason ?? ""}` : post.state === "claimed" ? "Claimed" : post.state === "approved" ? "Approved" : "Pending";

function Editor({ post, fields, onDone }: { post: MyPost; fields: Fields; onDone: () => void }) {
  const [values, setValues] = useState<Fields>(fields);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState("");
  const { busy, run } = useAction();
  const set = (name: string, value: string | number | undefined) => setValues({ ...values, [name]: value });
  const text = (name: string) => String(values[name] ?? "");
  const numberOf = (name: string) => (text(name).trim() === "" ? Number.NaN : Number(text(name)));

  async function save() {
    const body = { ...values, annual_pay: post.kind === "pay_report" ? numberOf("annual_pay") : undefined, years_experience: post.kind === "pay_report" ? numberOf("years_experience") : undefined };
    const checked = parseShape(SHAPES[post.kind], post.kind === "pay_report" ? body : values);
    if (!checked.ok) {
      setErrors(checked.fields);
      return;
    }
    setErrors({});
    const result = await run(() => api("PATCH", `/api/posts/${post.id}`, post.kind === "pay_report" ? body : values));
    if (result.ok) {
      announce(`Changes saved. Your ${POST_KIND_NAMES[post.kind]} is waiting for a moderator.`);
      onDone();
    } else if (result.fields) {
      setErrors(result.fields);
    } else {
      setFailure(result.message);
      if (result.field) setErrors({ [result.field]: result.message });
    }
  }

  return (
    <form className="form-narrow" onSubmit={(event) => { event.preventDefault(); void save(); }} noValidate>
      {failure && Object.keys(errors).length === 0 ? <p className="error">{failure}</p> : null}
      {post.kind === "review" ? (
        <>
          {(["overall", "work_life", "pay", "management"] as const).map((name) => (
            <RatingGroup
              key={name}
              label={`${{ overall: "Overall", work_life: "Work-life balance", pay: "Pay", management: "Management" }[name]} rating`}
              value={typeof values[name] === "number" ? Number(values[name]) : undefined}
              onChange={(value) => set(name, value)}
              error={errors[name]}
            />
          ))}
          <TextField label="Title" value={text("title")} onChange={(event) => set("title", event.target.value)} error={errors["title"]} />
          <TextArea label="Pros" value={text("pros")} onChange={(event) => set("pros", event.target.value)} error={errors["pros"]} />
          <TextArea label="Cons" value={text("cons")} onChange={(event) => set("cons", event.target.value)} error={errors["cons"]} />
        </>
      ) : null}
      {post.kind === "pay_report" ? (
        <>
          <SelectField label="Role" placeholder="Choose a role" options={ROLE_FAMILIES} value={text("role_family")} onChange={(event) => set("role_family", event.target.value)} error={errors["role_family"]} />
          <TextField label="Annual pay in rupees" type="number" value={text("annual_pay")} onChange={(event) => set("annual_pay", event.target.value)} error={errors["annual_pay"]} />
          <TextField label="Years of experience" type="number" value={text("years_experience")} onChange={(event) => set("years_experience", event.target.value)} error={errors["years_experience"]} />
        </>
      ) : null}
      {post.kind === "interview_note" ? (
        <>
          <SelectField label="Role" placeholder="Choose a role" options={ROLE_FAMILIES} value={text("role_family")} onChange={(event) => set("role_family", event.target.value)} error={errors["role_family"]} />
          <RatingGroup label="Difficulty rating" value={typeof values["difficulty"] === "number" ? Number(values["difficulty"]) : undefined} onChange={(value) => set("difficulty", value)} error={errors["difficulty"]} />
          <Choices legend="Outcome" name={`outcome-${post.id}`} value={text("outcome")} onChange={(value) => set("outcome", value)} options={OUTCOMES} error={errors["outcome"]} />
          <TextArea label="What happened" value={text("text")} onChange={(event) => set("text", event.target.value)} error={errors["text"]} />
        </>
      ) : null}
      <div className="row">
        <ActionButton type="submit" busy={busy}>Save changes</ActionButton>
        <button type="button" className="btn-quiet" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

export function MyContributions() {
  const posts = useLoad(() => get<{ posts: MyPost[] }>("/api/me/posts"), []);
  const [editing, setEditing] = useState<string | undefined>();
  const [deleting, setDeleting] = useState<MyPost | undefined>();
  const [failure, setFailure] = useState("");
  const deleteOpener = useRef<HTMLButtonElement | null>(null);
  const { busy, run } = useAction();
  const current = useRef<MyPost[]>([]);
  current.current = posts.data?.posts ?? [];

  useLive("post.state", (event) => {
    const post = current.current.find((entry) => entry.id === event.post_id);
    if (post && event.state === "approved") announce(`Your ${POST_KIND_NAMES[post.kind]} for ${post.company_name} was approved.`);
    if (post && event.state === "rejected") announce(`Your ${POST_KIND_NAMES[post.kind]} for ${post.company_name} was rejected: ${event.reason ?? ""}.`);
    posts.reload();
  });
  useLiveReload(posts.reload);

  async function remove() {
    if (!deleting) return;
    const result = await run(() => api("DELETE", `/api/posts/${deleting.id}`));
    setDeleting(undefined);
    if (result.ok) {
      announce("Post deleted.");
      setFailure("");
      posts.reload();
    } else {
      setFailure(result.message);
    }
  }

  const list = posts.data?.posts;
  return (
    <Screen title="My contributions" band={failure ? <Band>{failure}</Band> : null}>
      <h1 className="page-title">My contributions</h1>
      {list && list.length === 0 ? (
        <div className="empty">
          <p>You have not shared anything yet.</p>
          <Link to="/contribute" className="btn">Share something</Link>
        </div>
      ) : null}
      <ul className="items" aria-label="My contributions">
        {(list ?? []).map((post) => (
          <li key={post.id} data-id={post.id}>
            <p className="item-title">{post.label}</p>
            <p className="meta">
              {post.company_name} · {POST_KIND_NAMES[post.kind]} · {monthYear(post.posted_month)} · <span className="status">{statusText(post)}</span>
            </p>
            {post.editable ? (
              <div className="row">
                <button type="button" className="btn-quiet" onClick={() => setEditing(editing === post.id ? undefined : post.id)}>Edit {post.label}</button>
              </div>
            ) : null}
            {post.state !== "claimed" ? (
              <div className="row">
                <button type="button" className="btn-quiet" onClick={(event) => { deleteOpener.current = event.currentTarget; setDeleting(post); }}>Delete {post.label}</button>
              </div>
            ) : null}
            {editing === post.id ? (
              <Editor post={post} fields={post.fields} onDone={() => { setEditing(undefined); posts.reload(); }} />
            ) : null}
          </li>
        ))}
      </ul>
      <Dialog title="Delete this post?" open={deleting !== undefined} onClose={() => setDeleting(undefined)} opener={deleteOpener}>
        <p>{deleting?.label}</p>
        <div className="row">
          <button type="button" className="btn-quiet" onClick={() => setDeleting(undefined)}>Keep post</button>
          <ActionButton type="button" busy={busy} onClick={() => void remove()}>Delete post</ActionButton>
        </div>
      </Dialog>
    </Screen>
  );
}

