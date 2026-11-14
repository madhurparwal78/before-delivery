import { useState } from "preact/hooks";
import { api } from "../api.ts";
import { FormFeedback, TextField, useForm } from "../components/forms.tsx";
import { loadMe, useMe } from "../me.ts";
import { Link, navigate } from "../router.tsx";

function SchoolForm() {
  const form = useForm();
  const [name, setName] = useState("");
  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    form.begin("Saving...");
    try {
      await api("POST", "/api/schools", { name });
      await loadMe();
    } catch (error) {
      form.fail(error);
    }
  };
  return (
    <form class="cell form" onSubmit={(event) => void submit(event)}>
      <h2>Your school</h2>
      <TextField name="name" label="School name" value={name} onInput={setName} error={form.state.errors.name} />
      <button type="submit">Create school</button>
      <FormFeedback form={form} fields={{ name: "School name" }} />
    </form>
  );
}

function ClassForm() {
  const form = useForm();
  const [name, setName] = useState("");
  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    form.begin("Saving...");
    try {
      const made = await api<{ id: string }>("POST", "/api/classes", { name });
      await loadMe();
      navigate(`/classes/${made.id}`);
    } catch (error) {
      form.fail(error);
    }
  };
  return (
    <form class="cell form" onSubmit={(event) => void submit(event)}>
      <h2>New class</h2>
      <TextField name="name" label="Class name" value={name} onInput={setName} error={form.state.errors.name} />
      <button type="submit">Create class</button>
      <FormFeedback form={form} fields={{ name: "Class name" }} />
    </form>
  );
}

export function Home() {
  const { me } = useMe();
  if (!me) return null;
  return (
    <div class="page">
      <h1>Your classes</h1>
      <section class="cell">
        <ul aria-label="Classes" class="link-list">
          {me.classes.map((cls) => (
            <li key={cls.id}>
              <Link href={`/classes/${cls.id}`}>{cls.name}</Link>
            </li>
          ))}
        </ul>
        {me.classes.length === 0 && <p class="empty">No classes yet.</p>}
      </section>
      {me.role === "instructor" && (
        <nav class="cell nav-cell" aria-label="Instructor">
          <Link href="/aerodromes">Aerodromes</Link>
          <Link href="/scenarios/new">New scenario</Link>
        </nav>
      )}
      {me.role === null && <SchoolForm />}
      {me.role === "instructor" && <ClassForm />}
    </div>
  );
}
