// Conflict resolution: per hunk `Use ours` / `Use theirs`, or `Edit inline` with the file's whole marked text in
// `textbox "Conflict editor"`; `Commit resolution` makes the merge commit on the source branch. A refusal (leftover conflict markers,
// a hunk with no choice) shows in the strip and is announced; success opens the overview with focus on region "Merge checks".
import { useState } from "preact/hooks";
import { api, useAction, useResource } from "../api.ts";
import { navigate, useRoute } from "../router.ts";
import { useRole } from "../role.ts";
import { A } from "../router.ts";
import { Button, Notice, Skeleton, TextArea } from "../ui/index.ts";
import { Page } from "../ui/page.tsx";
import "../styles/mr.css";
import { type MergeRequestDetail, mrBase, mrPath } from "./mr/data.ts";
import { requestMrFocus } from "./mr/parts.tsx";

type Choice = "ours" | "theirs";

interface Hunk {
  ours: string[];
  theirs: string[];
}

interface ConflictFile {
  path: string;
  kind: "content" | "whole";
  hunks: Hunk[];
  marked: string;
}

interface Resolution {
  choices: Array<Choice | null>;
  inline: string | null;
}

function lines(text: string[]): string {
  return text.join("\n");
}

export default function MergeRequestConflictsPage() {
  const { params } = useRoute();
  const project = params.id ?? "";
  const iid = Number(params.iid);
  const { atLeast } = useRole();
  const found = useResource(async (signal) => {
    const [conflicts, mr] = await Promise.all([
      api.get<{ files: ConflictFile[] }>(`${mrBase(project, iid)}/conflicts`, { signal }),
      api.get<MergeRequestDetail>(mrBase(project, iid), { signal }),
    ]);
    return { files: conflicts.files, mr };
  }, [project, iid]);
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});
  const commit = useAction(async () => {
    const files = (found.data?.files ?? []).map((file) => {
      const resolution = resolutions[file.path];
      if (resolution?.inline != null) return { path: file.path, content: resolution.inline };
      const choices = resolution?.choices ?? [];
      return { path: file.path, hunks: choices.every((choice) => choice !== null) ? choices : [] };
    });
    await api.post(`${mrBase(project, iid)}/conflicts`, { files });
    const path = mrPath(project, iid);
    requestMrFocus(path, "checks");
    navigate(path);
  });

  const stateOf = (file: ConflictFile): Resolution => resolutions[file.path] ?? { choices: file.hunks.map(() => null), inline: null };
  const change = (file: ConflictFile, next: Resolution) => setResolutions((current) => ({ ...current, [file.path]: next }));
  const choose = (file: ConflictFile, index: number, choice: Choice) => {
    const now = stateOf(file);
    change(file, { ...now, choices: now.choices.map((was, at) => (at === index ? choice : was)) });
  };

  const data = found.data;
  const base = `/projects/${encodeURIComponent(project)}/-/merge_requests/${iid}`;
  return (
    <Page title="Resolve conflicts" project={project}>
      <div class="sp-conflict">
        {data ? (
          <p class="sp-kicker">{`[ ${data.mr.source} -> ${data.mr.target} ]  !${iid}`}</p>
        ) : null}
        {found.error ? <Notice>{found.error.message}</Notice> : null}
        {commit.error ? <Notice>{commit.error.message}</Notice> : null}
        {data === undefined && !found.error ? <Skeleton rows={3} height={96} /> : null}
        {data && data.files.length === 0 ? (
          <p>
            This merge request has no conflicts. <A href={base}>Back to the merge request</A>
          </p>
        ) : null}
        {data?.files.map((file) => {
          const state = stateOf(file);
          return (
            <section key={file.path} class="sp-conflict__file" aria-labelledby={`conflict-${file.path}`}>
              <h2 id={`conflict-${file.path}`} class="sp-conflict__path">
                {file.path}
              </h2>
              {state.inline === null ? (
                <>
                  {file.hunks.map((hunk, index) => (
                    <div key={index} class="sp-conflict__hunk">
                      <div class="sp-conflict__sides">
                        <div class="sp-conflict__side">
                          <p class="sp-conflict__label">{`ours: ${data.mr.target}`}</p>
                          <pre class="sp-conflict__code">{lines(hunk.ours)}</pre>
                        </div>
                        <div class="sp-conflict__side">
                          <p class="sp-conflict__label">{`theirs: ${data.mr.source}`}</p>
                          <pre class="sp-conflict__code">{lines(hunk.theirs)}</pre>
                        </div>
                      </div>
                      {atLeast("developer") ? (
                        <div class="sp-conflict__choices">
                          <Button variant="secondary" aria-pressed={state.choices[index] === "ours"} onClick={() => choose(file, index, "ours")}>
                            Use ours
                          </Button>
                          <Button variant="secondary" aria-pressed={state.choices[index] === "theirs"} onClick={() => choose(file, index, "theirs")}>
                            Use theirs
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                  {atLeast("developer") ? (
                    <Button variant="ghost" onClick={() => change(file, { ...state, inline: file.marked })}>
                      Edit inline
                    </Button>
                  ) : null}
                </>
              ) : (
                <>
                  <TextArea
                    label="Conflict editor"
                    name={`editor-${file.path}`}
                    class="sp-conflict__editor"
                    value={state.inline}
                    rows={14}
                    spellcheck={false}
                    onInput={(event) => change(file, { ...state, inline: event.currentTarget.value })}
                  />
                  <Button variant="ghost" onClick={() => change(file, { ...state, inline: null })}>
                    Choose by hunk
                  </Button>
                </>
              )}
            </section>
          );
        })}
        {data && data.files.length > 0 && atLeast("developer") ? (
          <div>
            <Button pending={commit.pending} onClick={() => void commit.run()}>
              Commit resolution
            </Button>
          </div>
        ) : null}
      </div>
    </Page>
  );
}
