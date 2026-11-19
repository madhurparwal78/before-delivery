import { TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { isRecord } from "../../shared/guards";
import { codePoints } from "../../shared/text";
import type { Board, BoardSummary, Pin } from "../../shared/types";
import { CreateBoardDialog } from "../dialogs/CreateBoardDialog";
import { FIELD_ERRORS } from "../lib/fieldErrors";
import { api, ApiFailure, GENERIC_ERROR } from "../lib/api";
import { announce } from "../lib/feedback";
import { navigate, params, useLocation } from "../lib/router";
import { useSession } from "../session";
import { Button } from "../ui/Button";
import { Counter } from "../ui/Counter";
import { Field } from "../ui/Field";
import { InlineAlert } from "../ui/InlineAlert";
import { MothPrint } from "../ui/Prints";

interface TagOption {
  tag: string;
  count: number;
}

const FRAGMENT = /(?:^|[^\p{L}\p{N}_])#([\p{L}\p{N}_]{1,30})$/u;

/** The tag suggestion list for the hashtag fragment before the caret in the description. */
function useTagSuggestions(value: string, setValue: (value: string) => void) {
  const field = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [caret, setCaret] = useState(0);
  const [found, setFound] = useState<{ fragment: string; tags: TagOption[] } | null>(null);
  const [active, setActive] = useState(-1);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const pending = useRef<number | null>(null);

  const fragment = FRAGMENT.exec(value.slice(0, caret))?.[1] ?? null;

  useEffect(() => {
    setActive(-1);
    if (fragment === null) return;
    let current = true;
    void api.get<{ tags: TagOption[] }>(`/api/tags/suggest?prefix=${encodeURIComponent(fragment)}`).then((reply) => {
      if (current) setFound({ fragment, tags: reply.tags });
    });
    return () => {
      current = false;
    };
  }, [fragment]);

  useEffect(() => {
    if (pending.current !== null && field.current) {
      field.current.setSelectionRange(pending.current, pending.current);
      pending.current = null;
    }
  }, [value]);

  const options = fragment !== null && found?.fragment === fragment && dismissed !== fragment ? found.tags : [];
  const open = options.length > 0;

  const choose = (tag: string): void => {
    if (fragment === null) return;
    const start = caret - fragment.length - 1;
    const inserted = `#${tag} `;
    pending.current = start + inserted.length;
    setValue(value.slice(0, start) + inserted + value.slice(caret));
    setCaret(start + inserted.length);
    setActive(-1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (!open) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((held) => Math.min(held + 1, options.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((held) => Math.max(held - 1, 0));
    } else if ((event.key === "Enter" || event.key === "Tab") && active >= 0) {
      event.preventDefault();
      const option = options[active];
      if (option) choose(option.tag);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setDismissed(fragment);
    }
  };

  return {
    field,
    listId,
    open,
    options,
    active,
    choose,
    textareaProps: {
      ref: field,
      "aria-controls": open ? listId : undefined,
      // The brief: while the list is open the Description textbox carries aria-expanded. It is left off
      // while closed, where a textbox has no expanded state to report.
      "aria-expanded": open ? (true as const) : undefined,
      "aria-activedescendant": open && active >= 0 ? `${listId}-${active}` : undefined,
      "aria-autocomplete": "list" as const,
      onKeyDown,
      onSelect: (event: React.SyntheticEvent<HTMLTextAreaElement>) => setCaret(event.currentTarget.selectionStart),
      onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        setValue(event.target.value);
        setCaret(event.target.selectionStart);
      },
    },
  };
}

export function Create() {
  const { config } = useSession();
  const location = useLocation();
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [boardId, setBoardId] = useState("");
  const [sections, setSections] = useState<{ id: number; name: string }[]>([]);
  const [sectionId, setSectionId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [alt, setAlt] = useState("");
  const [source, setSource] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [imageError, setImageError] = useState<string | null>(null);
  const [outage, setOutage] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const chooser = useRef<HTMLInputElement>(null);
  const suggestions = useTagSuggestions(description, setDescription);

  const loadBoards = async (select?: number): Promise<void> => {
    const found = (await api.get<{ boards: BoardSummary[] }>("/api/boards/mine")).boards;
    setBoards(found);
    const wanted = select ?? Number(params(location.search).get("board"));
    setBoardId((held) => String(found.find((board) => board.id === wanted)?.id ?? (found.some((board) => String(board.id) === held) ? held : (found[0]?.id ?? ""))));
  };

  useEffect(() => {
    void loadBoards();
  }, []);

  useEffect(() => {
    setSectionId("");
    if (boardId === "") return setSections([]);
    let current = true;
    void api.get<Board>(`/api/boards/${boardId}`).then((board) => {
      if (!current) return;
      setSections(board.order.sections.map((section) => ({ id: section.id, name: section.name })));
      const wanted = params(location.search).get("section");
      if (wanted && board.order.sections.some((section) => String(section.id) === wanted)) setSectionId(wanted);
    });
    return () => {
      current = false;
    };
  }, [boardId]);

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const over = codePoints(title) > config.limits.title_max || codePoints(description) > config.limits.description_max;

  const publish = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setImageError(null);
    setOutage(false);
    setFailure(null);
    const fields: Record<string, string> = { title, description, alt, source, board: boardId, ...(sectionId !== "" ? { section: sectionId } : {}) };
    try {
      const pin = await api.upload<Pin>("/api/pins", fields, file ? { name: file.name, type: file.type, data: await file.arrayBuffer() } : null);
      announce("Pin published");
      navigate(`/pin/${pin.id}`);
    } catch (error) {
      if (!(error instanceof ApiFailure)) setFailure(GENERIC_ERROR);
      else if (error.status === 503) setOutage(true);
      else if (error.status === 415) setImageError("Use a PNG or JPEG image.");
      else if (error.status === 413) {
        const max = typeof error.body["max_bytes"] === "number" ? error.body["max_bytes"] : config.limits.image_max_bytes;
        setImageError(`Images must be ${Math.floor(max / 1000)} KB or smaller.`);
      } else if (error.code === "duplicate_image") {
        const where = error.body["board"];
        setImageError(`You already saved this pin to ${isRecord(where) && typeof where["name"] === "string" ? where["name"] : ""}`);
      } else if (error.field === "image") {
        const reason = error.body["reason"];
        setImageError(
          reason === "pixels"
            ? `Images must be ${(config.limits.image_max_pixels / 1_000_000).toFixed(1)} megapixels or smaller.`
            : reason === "shape"
              ? "Images must be between 1:2 and 2:1."
              : "Use a PNG or JPEG image.",
        );
      } else if (error.field && FIELD_ERRORS[error.field]) setErrors({ [error.field]: FIELD_ERRORS[error.field] ?? GENERIC_ERROR });
      else setFailure(GENERIC_ERROR);
      setBusy(false);
    }
  };

  return (
    <div className="page create">
      <h1 className="page-title">Create a pin</h1>
      {outage ? (
        <InlineAlert tone="banner" icon={<TriangleAlert size={22} aria-hidden="true" />}>
          Images can't be uploaded right now. Your draft is kept.
        </InlineAlert>
      ) : null}
      {failure ? <InlineAlert>{failure}</InlineAlert> : null}
      <form className="composer" noValidate onSubmit={(event) => void publish(event)}>
        <div className="image-well">
          <div className="well-art">{preview ? <img src={preview} alt="Chosen image preview" /> : <MothPrint />}</div>
          <input ref={chooser} type="file" aria-label="Image" accept="image/png,image/jpeg" hidden onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          <Button onClick={() => chooser.current?.click()}>Choose image</Button>
          {file ? <p className="meta file-name">{file.name}</p> : null}
          {imageError ? <p role="alert" className="field-error">{imageError}</p> : null}
        </div>
        <div className="composer-fields">
          <Field label="Title" error={errors["title"]} counter={<Counter value={title} max={config.limits.title_max} />}>
            {(props) => <input {...props} type="text" value={title} onChange={(event) => setTitle(event.target.value)} autoComplete="off" />}
          </Field>
          <div className="suggest-host">
            <Field label="Description" error={errors["description"]} counter={<Counter value={description} max={config.limits.description_max} />}>
              {(props) => <textarea {...props} {...suggestions.textareaProps} rows={3} value={description} />}
            </Field>
            {suggestions.open ? (
              <ul role="listbox" aria-label="Tag suggestions" id={suggestions.listId} className="listbox suggest-list">
                {suggestions.options.map((option, index) => (
                  <li
                    key={option.tag}
                    id={`${suggestions.listId}-${index}`}
                    role="option"
                    aria-selected={index === suggestions.active}
                    className="option"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      suggestions.choose(option.tag);
                    }}
                  >
                    {`#${option.tag} (${option.count})`}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <Field label="Alt text" error={errors["alt"]}>
            {(props) => <textarea {...props} rows={2} value={alt} onChange={(event) => setAlt(event.target.value)} />}
          </Field>
          <Field label="Source link" error={errors["source"]}>
            {(props) => <input {...props} type="text" inputMode="url" value={source} onChange={(event) => setSource(event.target.value)} autoComplete="off" />}
          </Field>
          <Field label="Board">
            {(props) => (
              <select {...props} value={boardId} onChange={(event) => setBoardId(event.target.value)}>
                {(boards ?? []).map((board) => (
                  <option key={board.id} value={String(board.id)}>{board.name}</option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Section">
            {(props) => (
              <select {...props} value={sectionId} onChange={(event) => setSectionId(event.target.value)}>
                <option value="">No section</option>
                {sections.map((section) => (
                  <option key={section.id} value={String(section.id)}>{section.name}</option>
                ))}
              </select>
            )}
          </Field>
          {boards !== null && boards.length === 0 ? (
            <p className="meta">You have no board to pin to yet. <Button onClick={() => setCreating(true)}>Create board</Button></p>
          ) : null}
          <div className="actions">
            <Button variant="primary" type="submit" busy={busy} busyLabel="Publishing" disabled={over}>Publish</Button>
          </div>
        </div>
      </form>
      {creating ? <CreateBoardDialog onClose={() => setCreating(false)} onCreated={(board) => void loadBoards(board.id)} /> : null}
    </div>
  );
}
