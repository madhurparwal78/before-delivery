import { useEffect, useState, type FormEvent } from "react";
import { ApiFailure, failureText, get, post } from "../../lib/api.js";
import { useAnnounce } from "../../lib/announce.js";
import { Link, navigate } from "../../lib/router.js";
import { Page, Rest } from "../../lib/ui.js";
import { PUBLISHED_SERVICES } from "../../../shared/services.js";
import { Combobox } from "../record/Combobox.js";
import { useDirectories } from "../record/directory.js";
import { useSession } from "../../lib/session.js";
import { PortalActions } from "./common.js";

interface Suggestion {
  number: string;
  title: string;
}

function useSuggestions(text: string): Suggestion[] {
  const [found, setFound] = useState<Suggestion[]>([]);
  useEffect(() => {
    if (text.trim() === "") {
      setFound([]);
      return undefined;
    }
    let current = true;
    const timer = setTimeout(() => {
      get<{ articles: Suggestion[] }>(`/api/knowledge/suggest?text=${encodeURIComponent(text)}`).then(
        ({ articles }) => current && setFound(articles),
        () => current && setFound([]),
      );
    }, 300);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [text]);
  return found;
}

export function Fault(): JSX.Element {
  const announce = useAnnounce();
  const session = useSession();
  const manager = session.user?.roles.includes("manager") ?? false;
  const directories = useDirectories(["ci"], session.isDesk, manager);
  const [item, setItem] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const suggestions = useSuggestions(shortDescription);
  const itemErrorId = errors.configuration_item ? "fault-item-error" : undefined;

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setBusy(true);
    post<{ record: { number: string } }>("/api/tables/incident/records", { fields: { short_description: shortDescription, description, ...(session.isDesk ? { caller: session.user?.username } : {}), ...(item.trim() ? { configuration_item: item.trim() } : {}) } }).then(
      ({ record }) => {
        announce(`Saved ${record.number}.`);
        navigate(`/portal/incidents/${record.number}`);
      },
      (error: unknown) => {
        setBusy(false);
        const fields = error instanceof ApiFailure ? (error.fields ?? {}) : {};
        const count = Object.keys(fields).length;
        const text = count > 0 ? `${count} problems to fix before saving.` : failureText(error);
        setErrors(fields);
        setProblem(text);
        announce(text);
        if (fields.short_description) document.getElementById("fault-short")?.focus();
        else if (fields.configuration_item) document.getElementById("fault-item")?.focus();
      },
    );
  };

  return (
    <Page subject="Report a fault">
      <PortalActions />
      <Rest narrow className="portal-column">
        <form className="item-form" aria-label="Report a fault" onSubmit={submit} noValidate>
          <div className="variable">
            <div className="variable-head">
              <label htmlFor="fault-short">Short description</label>
              <span className="variable-flag">Required</span>
            </div>
            <input id="fault-short" type="text" value={shortDescription} aria-invalid={errors.short_description ? true : undefined} aria-describedby={errors.short_description ? "fault-short-error" : undefined} onChange={(event) => setShortDescription(event.target.value)} />
            {errors.short_description ? (
              <p className="field-error" id="fault-short-error">
                {errors.short_description}
              </p>
            ) : null}
          </div>
          {suggestions.length > 0 ? (
            <div className="suggestions">
              <h2>Suggested articles</h2>
              <ul aria-label="Suggested articles">
                {suggestions.map((article) => (
                  <li key={article.number}>
                    <Link to={`/portal/knowledge/${article.number}`}>{article.title}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="variable">
            <div className="variable-head">
              <label htmlFor="fault-item">Service or item</label>
            </div>
            <Combobox
              id="fault-item"
              choices={directories.ci ?? PUBLISHED_SERVICES.map((name) => ({ value: name, label: name }))}
              value={item || null}
              shown=""
              required={false}
              invalid={Boolean(errors.configuration_item)}
              describedBy={itemErrorId}
              keepTyped={!(session.isDesk || manager)}
              onPick={(picked) => setItem(picked ?? "")}
            />
            {errors.configuration_item ? (
              <p className="field-error" id="fault-item-error">
                {errors.configuration_item}
              </p>
            ) : null}
          </div>
          <div className="variable">
            <div className="variable-head">
              <label htmlFor="fault-description">Description</label>
            </div>
            <textarea id="fault-description" value={description} aria-invalid={errors.description ? true : undefined} onChange={(event) => setDescription(event.target.value)} />
            {errors.description ? <p className="field-error">{errors.description}</p> : null}
          </div>
          {problem ? <p className="form-error">{problem}</p> : null}
          <div className="row">
            <button type="submit" className="btn btn-solid" aria-busy={busy || undefined} disabled={busy}>
              Report fault
            </button>
          </div>
        </form>
      </Rest>
    </Page>
  );
}
