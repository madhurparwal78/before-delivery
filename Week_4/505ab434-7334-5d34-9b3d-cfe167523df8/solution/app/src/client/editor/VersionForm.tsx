import { useMemo, useState, type ReactNode } from "react";
import type { VersionView } from "../../shared/api.ts";
import type { Role } from "../../shared/domain.ts";
import { api } from "../lib/api.ts";
import { Alert, Button } from "../ui/index.ts";

interface Statement {
  identifier: string;
  text: string;
}

interface FormProps {
  version: VersionView;
  slug: string;
  role: Role;
  /** Identifiers live in the published version. */
  publishedStatements: string[];
  assetNames: Map<string, string>;
  onChanged: () => Promise<void>;
  run: (key: string, work: () => Promise<void>) => Promise<boolean>;
  busy: string | null;
  error: string | null;
  say: (text: string) => void;
}

/** The open version: editable for the author while it is a draft, readable otherwise, with the reviewer's decision panel. */
export function VersionForm({ version, role, publishedStatements, assetNames, onChanged, run, busy, error, say }: FormProps): ReactNode {
  const editable = role === "author" && version.state === "draft";
  const [intro, setIntro] = useState(version.intro);
  const [statements, setStatements] = useState<Statement[]>(version.statements);
  const [assetIds, setAssetIds] = useState<string[]>(version.assetIds);
  const [replacements, setReplacements] = useState<Record<string, string>>(Object.fromEntries(version.withdrawn.map((w) => [w.identifier, w.replacedBy])));
  const [comment, setComment] = useState("");

  const present = statements.map((s) => s.identifier.trim()).filter(Boolean);
  const removed = publishedStatements.filter((id) => !present.includes(id));
  const withdrawn = removed.filter((id) => replacements[id]).map((id) => ({ identifier: id, replacedBy: replacements[id] }));
  const known = useMemo(() => {
    const ids = new Set([...assetNames.keys(), ...version.assetIds]);
    return [...ids].map((id) => ({ id, name: assetNames.get(id) ?? id })).sort((a, b) => (a.name < b.name ? -1 : 1));
  }, [assetNames, version.assetIds]);
  const dirty = JSON.stringify([intro, statements, assetIds]) !== JSON.stringify([version.intro, version.statements, version.assetIds]);
  const label = (id: string): string => assetNames.get(id) ?? id;

  const save = async (): Promise<void> => {
    await api("PUT", `/api/versions/${version.id}`, { revision: version.revision, intro, statements, assetIds, withdrawn });
  };

  const update = (index: number, patch: Partial<Statement>): void =>
    setStatements((current) => current.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  if (!editable) {
    return (
      <section className="cell cell-pad stack" data-frame aria-label={`Version ${version.number}`}>
        <h2>{`Version ${version.number}`}</h2>
        <p>{version.intro}</p>
        <ul className="statement-list">
          {version.statements.map((s) => (
            <li key={s.identifier}>
              <code>{s.identifier}</code>
              {s.text}
            </li>
          ))}
        </ul>
        {version.assetIds.length > 0 ? <p className="muted">Assets: {version.assetIds.map(label).join(", ")}</p> : null}
        {version.reviewComment ? <p className="muted">Review comment: {version.reviewComment}</p> : null}
        {role === "brand_reviewer" && version.state === "in_review" ? (
          <div className="review-panel stack">
            <div className="field">
              <label htmlFor="review-comment">Review comment</label>
              <textarea id="review-comment" value={comment} onChange={(event) => setComment(event.target.value)} />
            </div>
            <Alert message={error} />
            <div className="cell-actions">
              <Button
                primary
                pending={busy === "form:approve" && "save"}
                onClick={() =>
                  void run("form:approve", async () => {
                    await api("POST", `/api/versions/${version.id}/approve`);
                    await onChanged();
                    say(`Version ${version.number} approved.`);
                  })
                }
              >
                {`Approve version ${version.number}`}
              </Button>
              <Button
                pending={busy === "form:changes" && "save"}
                onClick={() =>
                  void run("form:changes", async () => {
                    await api("POST", `/api/versions/${version.id}/request-changes`, { comment });
                    await onChanged();
                    say(`Changes requested on version ${version.number}.`);
                  })
                }
              >
                {`Request changes to version ${version.number}`}
              </Button>
            </div>
          </div>
        ) : (
          <Alert message={error} />
        )}
      </section>
    );
  }

  return (
    <form className="cell cell-pad stack" data-frame aria-label={`Version ${version.number}`} onSubmit={(event) => event.preventDefault()}>
      <h2>{`Version ${version.number}`}</h2>
      {version.reviewComment ? <p className="muted">Review comment: {version.reviewComment}</p> : null}
      <div className="field">
        <label htmlFor="intro">Introduction</label>
        <textarea id="intro" value={intro} onChange={(event) => setIntro(event.target.value)} />
      </div>
      <div>
        {statements.map((statement, index) => {
          const k = index + 1;
          return (
            <div className="statement-row" key={index}>
              <div className="field">
                <label htmlFor={`id-${k}`}>{`Rule identifier ${k}`}</label>
                <input id={`id-${k}`} type="text" value={statement.identifier} onChange={(event) => update(index, { identifier: event.target.value })} />
              </div>
              <Button onClick={() => setStatements((current) => current.filter((_, i) => i !== index))}>{`Remove statement ${k}`}</Button>
              <div className="field field-wide">
                <label htmlFor={`text-${k}`}>{`Rule text ${k}`}</label>
                <textarea id={`text-${k}`} value={statement.text} onChange={(event) => update(index, { text: event.target.value })} />
              </div>
            </div>
          );
        })}
        <Button onClick={() => setStatements((current) => [...current, { identifier: "", text: "" }])}>Add statement</Button>
      </div>
      {removed.map((id) => (
        <div className="field" key={id}>
          <label htmlFor={`rep-${id}`}>{`Replacement for ${id}`}</label>
          <select id={`rep-${id}`} value={replacements[id] ?? ""} onChange={(event) => setReplacements((current) => ({ ...current, [id]: event.target.value }))}>
            <option value="">Choose a replacement</option>
            {present.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      ))}
      <fieldset>
        <legend>Referenced assets</legend>
        <div className="checks">
          {known.map((asset) => (
            <label className="check" key={asset.id}>
              <input
                type="checkbox"
                checked={assetIds.includes(asset.id)}
                onChange={(event) => setAssetIds((current) => (event.target.checked ? [...current, asset.id] : current.filter((id) => id !== asset.id)))}
              />
              {asset.name}
            </label>
          ))}
        </div>
      </fieldset>
      <Alert message={error} />
      <div className="cell-actions">
        <Button
          pending={busy === "form:save" && "save"}
          onClick={() =>
            void run("form:save", async () => {
              await save();
              await onChanged();
              say("Draft saved.");
            })
          }
        >
          Save draft
        </Button>
        <Button
          primary
          pending={busy === "form:submit" && "save"}
          onClick={() =>
            void run("form:submit", async () => {
              if (dirty) await save();
              await api("POST", `/api/versions/${version.id}/submit`);
              await onChanged();
              say(`Version ${version.number} submitted for review.`);
            })
          }
        >
          Submit for review
        </Button>
      </div>
    </form>
  );
}
