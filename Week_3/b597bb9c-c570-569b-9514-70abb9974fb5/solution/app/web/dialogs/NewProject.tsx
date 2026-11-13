import { useState, type ReactNode } from "react";
import { RATE_LABELS } from "../../shared/rational";
import { ASPECT_LABELS, type Project } from "../../shared/types";
import { api, ApiError } from "../lib/api";
import { notify } from "../lib/notices";
import { navigate } from "../lib/router";
import { refreshProjects } from "../lib/session";
import { Dialog, onSubmit, SelectField, TextField } from "../ui";

const options = (labels: readonly string[]) => labels.map((label) => ({ value: label, label }));

export function NewProjectDialog({ opener, onClose }: { opener: HTMLElement | null; onClose: () => void }): ReactNode {
  const [title, setTitle] = useState("");
  const [agency, setAgency] = useState("");
  const [description, setDescription] = useState("");
  const [rate, setRate] = useState("25");
  const [aspect, setAspect] = useState("16:9");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [token, setToken] = useState(0);

  const create = async (): Promise<void> => {
    notify("Creating project…");
    try {
      const project = await api.post<Project>("/api/projects", { title, agency, description, frame_rate: rate, aspect_ratio: aspect });
      await refreshProjects();
      notify(`${project.title} created.`);
      onClose();
      navigate(`/projects/${project.id}`);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      notify(error.message);
      setErrors(error.fields);
      setToken((current) => current + 1);
    }
  };

  return (
    <Dialog
      title="New project"
      opener={opener}
      onClose={onClose}
      summary={{ fields: errors, labels: { title: "Title", frame_rate: "Frame rate", aspect_ratio: "Aspect ratio", agency: "Agency", description: "Description" }, token }}
    >
      <form onSubmit={onSubmit(() => void create())}>
        <TextField label="Title" name="title" value={title} onChange={setTitle} error={errors["title"]} />
        <TextField label="Agency" name="agency" value={agency} onChange={setAgency} error={errors["agency"]} />
        <TextField label="Description" name="description" value={description} onChange={setDescription} multiline error={errors["description"]} />
        <SelectField label="Frame rate" name="frame_rate" value={rate} onChange={setRate} options={options(RATE_LABELS)} error={errors["frame_rate"]} />
        <SelectField label="Aspect ratio" name="aspect_ratio" value={aspect} onChange={setAspect} options={options(ASPECT_LABELS)} error={errors["aspect_ratio"]} />
        <div className="actions">
          <button type="submit">Create project</button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}
