// Studio: the artist's own entries on the left, the selected entry's editor and image uploader on the right.
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../api.ts";
import { Field } from "../components/Field.tsx";
import { Gate, ScreenHeader } from "../components/Screen.tsx";
import { copy } from "../copy.ts";
import { useSession } from "../session.tsx";
import { useProgramme } from "../state/programme.ts";
import type { Entry } from "../types.ts";

type Form = { title: string; statement: string; discipline: string; medium: string; year: string };
const blank: Form = { title: "", statement: "", discipline: "light", medium: "", year: String(new Date().getFullYear()) };

export function Studio() {
  const { user } = useSession();
  const programme = useProgramme();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(blank);
  const [status, setStatus] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const file = useRef<HTMLInputElement>(null);
  const current = entries.find((e) => e.id === selected) ?? null;
  const editable = !current || current.status === "draft";

  const load = useCallback(async () => {
    const r = await api.get<{ entries: Entry[] }>("/api/entries");
    if (r.ok) setEntries(r.data.entries);
  }, []);
  useEffect(() => { if (user?.role === "artist") void load(); }, [user, load]);

  const choose = (entry: Entry | null) => {
    setSelected(entry?.id ?? null);
    setErrors({});
    setForm(entry ? { title: entry.title, statement: entry.statement, discipline: entry.discipline, medium: entry.medium, year: String(entry.year) } : blank);
  };

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    const body = { ...form, year: Number(form.year) };
    const r = current ? await api.patch<Entry>(`/api/entries/${current.id}`, body) : await api.post<Entry>("/api/entries", body);
    if (!r.ok) {
      const labels: Record<string, string> = { title: "Enter a title.", statement: "Write an artist statement.", discipline: "Choose a discipline.", medium: "Name the medium.", year: "Enter a year such as 2026." };
      setErrors(Object.fromEntries(Object.keys(r.errors ?? {}).map((k) => [k, labels[k] ?? "Check this field."])));
      setStatus(r.error === "not_editable" ? "Only drafts can be edited." : "Check the highlighted fields.");
      return null;
    }
    setErrors({});
    setSelected(r.data.id);
    setStatus(`${r.data.title} saved as a draft.`);
    await load();
    return r.data;
  };

  const upload = async () => {
    const chosen = file.current?.files?.[0];
    if (!chosen) return setStatus("Choose an image first.");
    const entry = current ?? (await save());
    if (!entry) return;
    setStatus(copy.uploading);
    const data = new FormData();
    data.append("file", chosen, chosen.name);
    const r = await api.post(`/api/entries/${entry.id}/images`, data);
    if (r.ok) {
      setStatus(copy.imageUploaded);
      if (file.current) file.current.value = "";
      return void load();
    }
    const code = r.errors?.file;
    if (r.status === 413) setStatus(copy.imageTooLarge);
    else if (code === "unsupported_type" || code === "empty") setStatus(copy.imageWrongType);
    else if (code === "invalid_name") setStatus(copy.badFileName);
    else if (r.error === "storage_unavailable") setStatus(copy.storageDown);
    else setStatus("Only drafts take new images.");
  };

  const submit = async () => {
    if (!current) return setStatus("Save the draft first.");
    const r = await api.post(`/api/entries/${current.id}/transitions`, { to: "review", note: null, publish_at: null });
    if (r.ok) setStatus(copy.submitted(current.title));
    else if (r.errors?.images) setStatus("Upload an image before submitting.");
    else setStatus(copy.illegal(current.title, current.status, "review"));
    void load();
  };

  const set = (key: keyof Form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  return (
    <div className="screen" data-ground="screen">
      <ScreenHeader title="Studio" lede="Write your entries, add images and send them to the curators." />
      <Gate user={user} roles={["artist"]}>
        <div className="grid screen__body studio">
          <div className="studio__list panel">
            <button type="button" className="button button--primary" onClick={() => choose(null)}>New entry</button>
            <ul aria-label="My entries" className="entries">
              {entries.length === 0 && <li className="hint">No entries yet.</li>}
              {entries.map((e) => (
                <li key={e.id}>
                  <button type="button" className={`entries__item${e.id === selected ? " is-current" : ""}`} aria-current={e.id === selected ? "true" : undefined} onClick={() => choose(e)}>
                    <span className="entries__title"><span aria-hidden="true" className="swatch" data-discipline={e.discipline} />{e.title}</span>
                    <span className="badge" data-state={e.status}>{e.status}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <form className="studio__editor panel stack" onSubmit={(e) => void save(e)} noValidate>
            <h2 className="panel__title">{current ? current.title : "New entry"}</h2>
            <Field label="Title" error={errors.title}><input type="text" value={form.title} onChange={set("title")} disabled={!editable} /></Field>
            <Field label="Artist statement" error={errors.statement}><textarea rows={5} value={form.statement} onChange={set("statement")} disabled={!editable} /></Field>
            <div className="split">
              <Field label="Discipline" error={errors.discipline}>
                <select value={form.discipline} onChange={set("discipline")} disabled={!editable}>
                  {programme?.disciplines.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </Field>
              <Field label="Medium" error={errors.medium}><input type="text" value={form.medium} onChange={set("medium")} disabled={!editable} /></Field>
              <Field label="Year" error={errors.year}><input type="text" inputMode="numeric" value={form.year} onChange={set("year")} disabled={!editable} /></Field>
            </div>
            <button type="submit" className="button" disabled={!editable}>Save draft</button>
            <div className="uploader">
              <Field label="Artwork image" hint="JPEG, PNG or WebP, up to 10,000,000 bytes."><input ref={file} type="file" accept="image/jpeg,image/png,image/webp" disabled={!editable} /></Field>
              <button type="button" className="button" onClick={() => void upload()} disabled={!editable}>Upload image</button>
              {current && <p className="hint figures">{current.images.length} image{current.images.length === 1 ? "" : "s"} attached · state: {current.status}</p>}
            </div>
            <button type="button" className="button button--primary" onClick={() => void submit()} disabled={!current || current.status !== "draft"}>Submit for review</button>
            <p role="status" aria-label="Studio status" className="status-line">{status}</p>
          </form>
        </div>
      </Gate>
    </div>
  );
}
