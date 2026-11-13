// Publish a part (DP-49): validated Tine source, stored and evaluated as r1.
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ApiError, GalleryJson, RevisionJson } from "../shared/api";
import { get, KeyedAction } from "./api";
import { PageHeading } from "./chrome";
import { RadioGroup } from "./controls";
import { SAVE_OUTAGE } from "../shared/copy";
import { Alert } from "./partDialogs";
import { Icon } from "./icons";
import { navigate } from "./router";
import { useSession } from "./session";

export function PublishPage() {
  const { me, ready, storageDown } = useSession();
  const [categories, setCategories] = useState<GalleryJson["categories"]>([]);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [source, setSource] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const action = useRef(new KeyedAction());

  useEffect(() => {
    void get<GalleryJson>("/api/parts").then((reply) => {
      if (!reply.ok) return;
      setCategories(reply.data.categories);
      setCategory((c) => c || (reply.data.categories[0]?.slug ?? ""));
    });
  }, []);
  useEffect(() => {
    if (ready && !me) navigate(`/signin?next=${encodeURIComponent("/parts/new")}`, true);
  }, [ready, me]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    if (storageDown) {
      setAlert(SAVE_OUTAGE);
      return;
    }
    setPending(true);
    setErrors({});
    setAlert(null);
    const reply = await action.current.send<{ slug: string; revision: RevisionJson } & ApiError>("POST", "/api/parts", { title, category, visibility, source });
    setPending(false);
    if (!reply) setAlert("Not sent yet. Try again.");
    else if (reply.status === 201) navigate(`/parts/${(reply.data as { slug: string }).slug}`);
    else if (reply.status === 503) setAlert(SAVE_OUTAGE);
    else if (reply.status === 422 && reply.data.errors) setErrors(reply.data.errors);
    else setAlert(reply.data.message);
  };

  const fieldError = (name: string) =>
    errors[name] ? (
      <p className="field-error">
        <Icon name="alert" size={16} />
        {errors[name]}
      </p>
    ) : null;

  return (
    <div className="page publish-page">
      <PageHeading>Publish a part</PageHeading>
      {alert ? <Alert>{alert}</Alert> : null}
      <form onSubmit={submit} className="stack form-wide">
        <label className="stacked">
          <span>Title</span>
          <input type="text" value={title} onChange={(event) => setTitle(event.target.value)} autoComplete="off" />
        </label>
        {fieldError("title")}
        <label className="stacked">
          <span>Category</span>
          <select aria-label="Category" value={category} onChange={(event) => setCategory(event.target.value)}>
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {fieldError("category")}
        <RadioGroup
          label="Visibility"
          name="visibility"
          value={visibility}
          options={[
            { value: "public", label: "Public" },
            { value: "private", label: "Private" },
          ]}
          onChange={setVisibility}
        />
        <label className="stacked">
          <span>Source</span>
          <textarea className="mono" rows={14} value={source} spellCheck={false} onChange={(event) => setSource(event.target.value)} />
        </label>
        {fieldError("source")}
        <div className="dialog-actions">
          <button type="submit" className="button primary" disabled={pending} aria-disabled={storageDown ? true : undefined}>
            <span className={pending ? "busy" : undefined}>Publish</span>
          </button>
        </div>
      </form>
    </div>
  );
}
