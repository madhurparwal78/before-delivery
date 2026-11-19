import { forwardRef, useEffect, useId, useRef, useState } from "react";
import { api, ApiFailure } from "../api.js";

type Suggestion = { id: string; title: string; estimateMinutes: number | null };

type Props = {
  onCreate: (title: string) => Promise<string | null>;
  onChoose: (taskId: string) => void;
};

/** The add-a-task combobox: up to eight of the member's own open tasks after a quarter-second pause. */
export const AddTask = forwardRef<HTMLInputElement, Props>(function AddTask({ onCreate, onChoose }, ref) {
  const [text, setText] = useState("");
  const [options, setOptions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const listId = useId();
  const errorId = useId();
  const inputId = useId();

  useEffect(() => {
    const query = text.trim();
    if (!query) {
      setOptions([]);
      setOpen(false);
      return;
    }
    const ticket = ++request.current;
    const timer = setTimeout(() => {
      api<{ suggestions: Suggestion[] }>("GET", `/api/tasks/suggest?q=${encodeURIComponent(query.slice(0, 100))}`)
        .then((data) => {
          if (ticket !== request.current) return;
          setOptions(data.suggestions);
          setActive(-1);
          setOpen(data.suggestions.length > 0);
        })
        .catch(() => undefined);
    }, 250);
    return () => clearTimeout(timer);
  }, [text]);

  const choose = (option: Suggestion) => {
    request.current++;
    setOpen(false);
    setText("");
    onChoose(option.id);
  };

  const submit = async () => {
    const title = text.trim();
    if (!title) {
      setError("Type a title for the new task.");
      return;
    }
    if (title.length > 200) {
      setError("Keep the title to 200 characters or fewer.");
      return;
    }
    request.current++;
    setOpen(false);
    const failure = await onCreate(title);
    if (failure) setError(failure);
    else {
      setError(null);
      setText("");
    }
  };

  return (
    <div className="addtask">
      <label className="field-label" htmlFor={inputId}>
        Add a task
      </label>
      <input
        ref={ref}
        id={inputId}
        className="input"
        type="text"
        role="combobox"
        autoComplete="off"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-describedby={error ? errorId : undefined}
        aria-invalid={error ? true : undefined}
        placeholder="Type, then Enter"
        value={text}
        onChange={(event) => {
          setText(event.currentTarget.value);
          setError(null);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && options.length) {
            event.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, options.length - 1));
          } else if (event.key === "ArrowUp" && open) {
            event.preventDefault();
            setActive((i) => Math.max(i - 1, -1));
          } else if (event.key === "Escape") {
            setOpen(false);
            setActive(-1);
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (open && active >= 0 && options[active]) choose(options[active]);
            else void submit();
          }
        }}
      />
      <ul id={listId} role="listbox" aria-label="Suggestions" className="suggestions" hidden={!open}>
        {options.map((option, i) => (
          <li
            key={option.id}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            className="suggestion"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(option)}
          >
            {option.title}
          </li>
        ))}
      </ul>
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
});

export function createFailure(error: unknown): string {
  if (error instanceof ApiFailure && error.fields.title) return error.fields.title;
  if (error instanceof ApiFailure && error.code === "workspace_read_only") return "This workspace is read-only.";
  return "Something went wrong on our side. Nothing was changed.";
}
