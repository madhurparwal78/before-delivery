import { useEffect, useId, useState } from "react";
import type { FeatureSummary, Importance, Insight, InsightChange } from "../../shared/api.js";
import { api } from "../api.js";
import { useFeedback } from "../feedback.js";
import { IMPORTANCE_LABELS } from "../format.js";
import { Dialog } from "../ui/Dialog.js";

export type Linked = InsightChange & { insight: Insight };

export function LinkDialog(props: {
  noteId: string;
  quote: string;
  span: { start: number; end: number };
  onLinked: (linked: Linked) => void;
  onClosed: () => void;
  returnFocus: () => HTMLElement | null;
}) {
  const feedback = useFeedback();
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<FeatureSummary[]>([]);
  const [active, setActive] = useState(-1);
  const [chosen, setChosen] = useState<FeatureSummary | null>(null);
  const [importance, setImportance] = useState<Importance>("important");
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState("");
  const listId = useId();
  const errorId = useId();

  useEffect(() => {
    let current = true;
    api.get<{ features: FeatureSummary[] }>(`/api/features?q=${encodeURIComponent(query)}`).then((r) => {
      if (current) setOptions(r.features);
    }, () => undefined);
    return () => { current = false; };
  }, [query]);

  const pick = (feature: FeatureSummary): void => {
    setChosen(feature);
    setQuery(feature.name);
    setFieldError("");
  };

  const submit = async (close: () => void): Promise<void> => {
    const feature = chosen ?? options.find((o) => o.name.toLowerCase() === query.trim().toLowerCase()) ?? null;
    if (!feature) {
      setFieldError("Choose a feature from the list.");
      return;
    }
    setBusy(true);
    feedback.clearAlert();
    try {
      const result = await api.post<Linked>("/api/insights", { noteId: props.noteId, featureId: feature.id, start: props.span.start, end: props.span.end, importance });
      props.onLinked(result);
      close();
    } catch (error) {
      feedback.fail(error);
      setBusy(false);
    }
  };

  const open = options.length > 0 && (chosen === null || chosen.name !== query);
  return (
    <Dialog title="Link quote to feature" onClosed={props.onClosed} returnFocus={props.returnFocus}>
      {(close) => (
        <form className="dialog-body" onSubmit={(event) => { event.preventDefault(); void submit(close); }}>
          <blockquote className="dialog-quote">{props.quote}</blockquote>
          <div className="field">
            <label htmlFor={`${listId}-input`}>Feature</label>
            <div className="combo">
              <input
                id={`${listId}-input`}
                type="text"
                role="combobox"
                aria-expanded={open}
                aria-controls={open ? listId : undefined}
                aria-autocomplete="list"
                aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
                aria-describedby={fieldError ? errorId : undefined}
                autoComplete="off"
                value={query}
                onChange={(event) => { setQuery(event.target.value); setChosen(null); setActive(-1); }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" && options.length > 0) { event.preventDefault(); setActive((i) => (i + 1) % options.length); }
                  else if (event.key === "ArrowUp" && options.length > 0) { event.preventDefault(); setActive((i) => (i <= 0 ? options.length - 1 : i - 1)); }
                  else if (event.key === "Enter" && open && options[active]) { event.preventDefault(); pick(options[active]); }
                }}
              />
              {open && (
                <ul id={listId} role="listbox" aria-label="Features" className="combo-list">
                  {options.map((feature, i) => (
                    <li key={feature.id} id={`${listId}-${i}`} role="option" aria-selected={i === active} className="combo-option"
                      onMouseDown={(event) => event.preventDefault()} onClick={() => pick(feature)}>
                      {feature.name}
                      <span aria-hidden="true" className="combo-meta num">#{feature.rank}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {fieldError && <p id={errorId} className="field-error">{fieldError}</p>}
          </div>
          <fieldset className="field radios" role="radiogroup" aria-label="Importance">
            <legend>Importance</legend>
            {(Object.keys(IMPORTANCE_LABELS) as Importance[]).map((value) => (
              <label key={value} className="radio">
                <input type="radio" name="importance" value={value} checked={importance === value} onChange={() => setImportance(value)} />
                {IMPORTANCE_LABELS[value]}
              </label>
            ))}
          </fieldset>
          <div className="dialog-actions">
            <button type="button" className="button-quiet" onClick={close}>Cancel</button>
            <button type="submit" className="button" aria-busy={busy} disabled={busy}>{busy ? "Linking…" : "Link quote"}</button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
