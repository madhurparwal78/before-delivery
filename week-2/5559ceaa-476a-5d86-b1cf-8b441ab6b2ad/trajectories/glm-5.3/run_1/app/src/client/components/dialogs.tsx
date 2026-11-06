import { useEffect, useRef, useState } from "react";
import { api, ApiCallError } from "../lib/api";
import { useFocusTrap } from "../lib/hooks";

export function Dialog({
  label,
  onClose,
  children,
  destructive,
  wide,
}: {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
  destructive?: boolean;
  wide?: boolean;
}): React.ReactElement {
  const ref = useFocusTrap(true, onClose);
  return (
    <div className={`dialog-backdrop${destructive ? " destructive" : ""}`} onMouseDown={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`dialog${wide ? " wide" : ""}`}
      >
        {children}
      </div>
    </div>
  );
}

export function NewProjectDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }): React.ReactElement {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"one_to_one" | "group">("one_to_one");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const openerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement as HTMLButtonElement | null;
  }, []);

  const create = async () => {
    if (pending) return;
    setPending(true);
    try {
      const { data } = await api<{ project: { id: string } }>("POST", "/api/projects", { title, kind });
      if (data) onCreated(data.project.id);
    } catch (err) {
      if (err instanceof ApiCallError && err.code === "validation") {
        setStatus("Give the project a title of 1 to 80 characters.");
      } else {
        setStatus("Something went wrong. Try again.");
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog label="New project" onClose={onClose}>
      <h2>New project</h2>
      <label htmlFor="project-title">Project title</label>
      <input
        id="project-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <div role="radiogroup" aria-label="Kind">
        <label>
          <input
            type="radio"
            name="kind"
            value="one_to_one"
            checked={kind === "one_to_one"}
            onChange={() => setKind("one_to_one")}
          />
          One-to-one
        </label>
        <label>
          <input
            type="radio"
            name="kind"
            value="group"
            checked={kind === "group"}
            onChange={() => setKind("group")}
          />
          Group
        </label>
      </div>
      <button onClick={create} disabled={pending}>
        Create project
      </button>
      <p className="status" role="status">{status}</p>
    </Dialog>
  );
}
