import { useState } from "preact/hooks";
import { api } from "../api.ts";
import { FormFeedback, TextField, useForm } from "../components/forms.tsx";
import { loadMe, useMe } from "../me.ts";

export function SettingsPage() {
  const { me } = useMe();
  const form = useForm();
  const [name, setName] = useState(me?.name ?? "");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [reduce, setReduce] = useState(me?.reduceMotion ?? false);
  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    form.begin("Saving...");
    try {
      await api("PATCH", "/api/me", { name, currentPassword: current, newPassword: next, reduceMotion: reduce });
      await loadMe();
      setCurrent("");
      setNext("");
      form.succeed("Settings saved.");
    } catch (error) {
      form.fail(error);
    }
  };
  const errors = form.state.errors;
  return (
    <div class="page">
      <h1>Settings</h1>
      <form class="cell form" onSubmit={(event) => void submit(event)}>
        <TextField name="name" label="Name" value={name} onInput={setName} error={errors.name} />
        <TextField name="currentPassword" label="Current password" value={current} onInput={setCurrent} error={errors.currentPassword} type="password" autoComplete="current-password" />
        <TextField name="newPassword" label="New password" value={next} onInput={setNext} error={errors.newPassword} type="password" autoComplete="new-password" />
        <label class="check">
          <input type="checkbox" checked={reduce} onChange={(event) => setReduce(event.currentTarget.checked)} />
          Reduce motion
        </label>
        <button type="submit">Save settings</button>
        <FormFeedback form={form} fields={{ name: "Name", currentPassword: "Current password", newPassword: "New password" }} />
      </form>
    </div>
  );
}
