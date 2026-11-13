// `/projects/<id>/-/ci/editor?ref=`: edit `spurline.pipeline.yml`, check it, jump from a problem to its line.
import "../styles/repo.css";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { announce } from "../announce.tsx";
import { api, asApiError, useAction } from "../api.ts";
import { useQuery, useRoute } from "../router.ts";
import { useProject } from "../role.ts";
import { Main } from "../shell/main.tsx";
import { Button } from "../ui/button.tsx";
import { Notice, Skeleton } from "../ui/feedback.tsx";
import { TextArea } from "../ui/fields.tsx";
import { useTitle } from "../ui/page.tsx";
import { RepoTitle } from "./repo/chrome.tsx";
import { loadFile } from "./repo/data.ts";
import { parseLint, type LintBody } from "./repo/types.ts";

const CONFIG_PATH = "spurline.pipeline.yml";

/** Offset of the start of the 1-based `line` in `text`. */
function lineStart(text: string, line: number): number {
  let offset = 0;
  for (let at = 1; at < line; at++) {
    const next = text.indexOf("\n", offset);
    if (next < 0) return text.length;
    offset = next + 1;
  }
  return offset;
}

function problemLine(problem: string): number {
  const found = /^Line (\d+):/.exec(problem);
  return found ? Number(found[1]) : 1;
}

function CiEditor({ id }: { id: string }) {
  const query = useQuery();
  const project = useProject();
  const ref = query.get("ref") ?? project.defaultBranch ?? "";
  const [text, setText] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [result, setResult] = useState<LintBody | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    if (ref === "") return;
    let alive = true;
    setText(null);
    void loadFile(id, ref, CONFIG_PATH).then(
      (file) => {
        if (alive) setText(file.content);
      },
      (cause: unknown) => {
        if (!alive) return;
        const error = asApiError(cause);
        if (error.status === 404) setText("");
        else setFailure(error.message);
      },
    );
    return () => {
      alive = false;
    };
  }, [id, ref]);

  const check = useAction(
    async () => {
      const lint = parseLint(await api.post(`/api/projects/${id}/ci/lint`, { content: text ?? "", ref, variables: {}, changed_files: [] }));
      setResult(lint);
      if (lint.valid) announce(lint.summary);
      else announce(`Lint found ${lint.errors.length} ${lint.errors.length === 1 ? "problem" : "problems"}.`);
    },
    { announce: true },
  );

  const jump = (problem: string): void => {
    const area = box.current;
    if (!area) return;
    const offset = lineStart(area.value, problemLine(problem));
    area.focus();
    area.setSelectionRange(offset, offset);
  };

  if (failure !== null) return <Notice>{failure}</Notice>;
  if (text === null) return <Skeleton rows={8} height={32} />;

  return (
    <div class="sp-ciedit">
      <form
        class="sp-ciedit__form"
        onSubmit={(event) => {
          event.preventDefault();
          void check.run();
        }}
      >
        <TextArea
          label="Pipeline config"
          name="pipeline-config"
          innerRef={box}
          rows={22}
          spellcheck={false}
          wrap="off"
          value={text}
          onInput={(event) => setText(event.currentTarget.value)}
        />
        <Button type="submit" pending={check.pending}>
          Check config
        </Button>
      </form>
      <section class="sp-ciedit__results" aria-label="Lint results">
        {result === null ? <p class="sp-muted">Check the config to see its problems here.</p> : null}
        {result !== null && !result.valid ? (
          <ul class="sp-ciedit__problems">
            {result.errors.map((problem, index) => (
              <li key={`${index}:${problem}`}>
                <button type="button" class="sp-ciedit__problem" onClick={() => jump(problem)}>
                  {problem}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {result !== null && result.valid ? (
          <>
            <p class="sp-ciedit__summary">{result.summary}</p>
            <ul aria-label="Expanded jobs" class="sp-ciedit__jobs">
              {result.jobs.map((job) => (
                <li key={job.name} class="sp-ciedit__job">
                  <span class="sp-ciedit__job-name">{job.name}</span>
                  <span class="sp-ciedit__job-stage">{`stage ${job.stage}`}</span>
                  {job.variables.map(([key, value]) => (
                    <span key={key} class="sp-ciedit__var">{`${key}=${value}`}</span>
                  ))}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>
    </div>
  );
}

export default function CiEditorPage() {
  const { id } = useRoute().params;
  useTitle("Pipeline config");
  return (
    <Main project={id} class="sp-repo-page">
      <div class="sp-container">
        <RepoTitle title="Pipeline config editor" />
        <CiEditor id={id} />
      </div>
    </Main>
  );
}
