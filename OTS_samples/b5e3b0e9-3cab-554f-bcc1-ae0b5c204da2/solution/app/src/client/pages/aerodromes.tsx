import { useLayoutEffect, useState } from "preact/hooks";
import { api, apiBlob, apiRaw, ApiFailure } from "../api.ts";
import type { Layout } from "../../shared/layout.ts";
import { FormFeedback, useForm } from "../components/forms.tsx";
import { AirfieldMap } from "../components/map.tsx";
import { Link, navigate } from "../router.tsx";
import { Loading, NotFound } from "./shared.tsx";

interface AerodromeInfo {
  id: string;
  name: string;
  code: string;
  imported: boolean;
}

export function AerodromesPage() {
  const form = useForm();
  const [list, setList] = useState<AerodromeInfo[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [failure, setFailure] = useState("");
  useLayoutEffect(() => {
    void api<AerodromeInfo[]>("GET", "/api/aerodromes").then(setList);
  }, []);
  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    if (!file) return;
    form.begin("Checking layout...");
    setLines([]);
    setFailure("");
    try {
      const made = await apiRaw("POST", "/api/aerodromes/import", file);
      navigate(`/aerodromes/${(made as { id: string }).id}`);
    } catch (error) {
      form.reset();
      if (error instanceof ApiFailure && error.error === "layout_invalid") setLines(error.lines);
      else if (error instanceof ApiFailure) setFailure(error.message);
      else throw error;
    }
  };
  return (
    <div class="page">
      <h1>Aerodromes</h1>
      <form class="cell form" onSubmit={(event) => void submit(event)}>
        <h2>Import a layout</h2>
        <div class="field">
          <label for="field-layout">Layout file</label>
          <input id="field-layout" type="file" onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)} />
        </div>
        <button type="submit">Import layout</button>
        <FormFeedback form={form} />
        <ul aria-label="Import errors" class={lines.length > 0 ? "cell-error error-lines" : "error-lines"}>
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <div role="alert" aria-label="Import error" class={failure ? "cell-error" : "cell-quiet"}>
          {failure}
        </div>
      </form>
      <section class="cell">
        <h2>Your aerodromes</h2>
        <ul aria-label="Aerodromes" class="link-list">
          {list.map((aerodrome) => (
            <li key={aerodrome.id}>
              <Link href={`/aerodromes/${aerodrome.id}`}>{aerodrome.name}</Link> <span class="muted">{aerodrome.code}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function AerodromePage({ id }: { id: string }) {
  const [loaded, setLoaded] = useState<{ layout: Layout; imported: boolean } | "loading" | "missing">("loading");
  const [failure, setFailure] = useState("");
  useLayoutEffect(() => {
    Promise.all([api<{ id: string; layout: Layout }>("GET", `/api/aerodromes/${id}`), api<AerodromeInfo[]>("GET", "/api/aerodromes")])
      .then(([detail, all]) => setLoaded({ layout: detail.layout, imported: all.find((a) => a.id === id)?.imported ?? false }))
      .catch((error: unknown) => {
        if (!(error instanceof ApiFailure)) throw error;
        setLoaded("missing");
      });
  }, [id]);
  if (loaded === "loading") return <Loading />;
  if (loaded === "missing") return <NotFound />;
  const download = async (): Promise<void> => {
    try {
      const { blob } = await apiBlob(`/api/aerodromes/${id}/original`);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${loaded.layout.code}-layout.json`;
      link.click();
      URL.revokeObjectURL(link.href);
      setFailure("");
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      setFailure(error.message);
    }
  };
  return (
    <div class="page">
      <h1>{loaded.layout.name}</h1>
      <section class="cell">
        <AirfieldMap
          name="Airfield map"
          layout={loaded.layout}
          aircraft={[]}
          closed={false}
          litPreview={[]}
          litAccepted={[]}
          conflicts={[]}
          stopBars={[]}
          selected={null}
          emergency={null}
          glideMs={0}
        />
        {loaded.imported && (
          <button type="button" onClick={() => void download()}>
            Download original
          </button>
        )}
        <div role="alert" aria-label="Import error" class={failure ? "cell-error" : "cell-quiet"}>
          {failure}
        </div>
      </section>
    </div>
  );
}
