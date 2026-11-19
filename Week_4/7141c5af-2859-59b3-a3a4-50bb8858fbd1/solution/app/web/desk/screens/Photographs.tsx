import type { JSX } from "preact";
import { useRef, useState } from "preact/hooks";
import { copy } from "../../../server/domain/copy.ts";
import { announce } from "../lib/announce.ts";
import { ApiFailure, get, send } from "../lib/api.ts";
import { useLive } from "../lib/live.ts";
import { BackToPiece, Heading, Loading, MainAction, MintTile } from "../lib/screen.tsx";
import { Slider } from "../lib/slider.tsx";
import type { ScreenProps } from "../routes.tsx";

type Side = "before" | "after";

interface Photograph {
  id: string;
  number: number;
  side: Side;
  state: string;
}

interface UploadRow {
  key: number;
  file: File;
  side: Side;
  state: "Waiting" | "Sending" | "Stored" | "Refused";
  message: string | null;
  photographId: string | null;
}

const latestStored = (photographs: readonly Photograph[], side: Side): Photograph | undefined =>
  photographs.filter((item) => item.side === side && item.state === "stored").at(-1);

export function PhotographsScreen({ id }: ScreenProps): JSX.Element {
  const live = useLive(async () => {
    const [{ piece }, { photographs }] = await Promise.all([
      get<{ piece: { title: string } }>(`/api/pieces/${id}`),
      get<{ photographs: Photograph[] }>(`/api/pieces/${id}/photographs`),
    ]);
    return { title: piece.title, photographs };
  }, [id]);
  const [side, setSide] = useState<Side>("before");
  const [rows, setRows] = useState<UploadRow[]>([]);
  const nextKey = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  const change = (key: number, patch: Partial<UploadRow>): void => setRows((old) => old.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const upload = async (row: UploadRow): Promise<void> => {
    change(row.key, { state: "Sending", message: null });
    const body = new FormData();
    body.append("side", row.side);
    body.append("file", row.file, row.file.name);
    try {
      const response = await send("POST", `/api/pieces/${id}/photographs`, body);
      const { photograph } = (await response.json()) as { photograph: Photograph };
      change(row.key, { state: "Stored", photographId: photograph.id });
      announce(copy("F-28", { "file name": row.file.name }));
      void live.reload();
    } catch (error) {
      const message = error instanceof ApiFailure ? error.message : copy("F-27");
      change(row.key, { state: "Refused", message });
      announce(message);
    }
  };

  const addFiles = (files: readonly File[]): void => {
    const added = files.map((file): UploadRow => ({ key: (nextKey.current += 1), file, side, state: "Waiting", message: null, photographId: null }));
    setRows((old) => [...old, ...added]);
    for (const row of added) void upload(row);
  };

  const data = live.data;
  if (!data) return <Loading height={480} />;
  const { photographs } = data;
  const before = latestStored(photographs, "before");
  const after = latestStored(photographs, "after");
  const fileAddress = (photograph: Photograph): string => `/api/pieces/${id}/photographs/${photograph.id}/file`;
  const uploadedHere = new Set(rows.map((row) => row.photographId));
  const earlier = photographs.filter((photograph) => !uploadedHere.has(photograph.id));
  const stored = photographs.filter((photograph) => photograph.state === "stored").length;

  return (
    <>
      <BackToPiece id={id} />
      <Heading text={`Photographs of ${data.title}`}>
        <MainAction>
          <button type="button" class="button button--primary" onClick={() => input.current?.click()}>
            Add photographs
          </button>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              addFiles([...(event.currentTarget.files ?? [])]);
              event.currentTarget.value = "";
            }}
          />
        </MainAction>
      </Heading>
      <div class="bento">
        <section class="tile t-large" aria-label="Before and after">
          {before && after ? (
            <Slider
              name="Before and after"
              before={{ src: fileAddress(before), alt: "Photograph before the work", caption: "Before" }}
              after={{ src: fileAddress(after), alt: "Photograph after the work", caption: "After" }}
              valueText={(share) => `${share}% before`}
            />
          ) : (
            <div class="ba-empty">
              <p>{"No photographs yet."}</p>
            </div>
          )}
        </section>
        <div class="t-medium side-stack">
          <MintTile label="Stored files" figure={String(stored)} size="" />
          <section class="tile" aria-label="Side of the next files">
            <p class="small muted">Side of the next files</p>
            <div class="choices" role="radiogroup" aria-label="Side">
              {(["before", "after"] as const).map((value) => (
                <label key={value} class="choice">
                  <input type="radio" name="side" checked={side === value} onChange={() => setSide(value)} />
                  {value === "before" ? "Before" : "After"}
                </label>
              ))}
            </div>
          </section>
        </div>
        <section
          class="tile t-full upload-tile"
          aria-label="Upload rows"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            addFiles([...(event.dataTransfer?.files ?? [])]);
          }}
        >
          <h2>Uploads</h2>
          {rows.length === 0 && earlier.length === 0 ? <p>{"No photographs yet."}</p> : null}
          <ul class="upload-rows" aria-label="Uploads">
            {earlier.map((photograph) => (
              <li key={photograph.id} class="upload-row">
                <span class="upload-name">
                  Photograph {photograph.number}, {photograph.side === "before" ? "Before" : "After"}
                </span>
                <span class="upload-state">{photograph.state === "stored" ? "Stored" : "Waiting"}</span>
              </li>
            ))}
            {rows.map((row) => (
              <li key={row.key} class="upload-row" data-refused={row.state === "Refused" ? "true" : undefined}>
                <span class="upload-name">{row.file.name}</span>
                <span class="upload-state">{row.state}</span>
                {row.message ? <span class="upload-message">{row.message}</span> : null}
                {row.state === "Refused" ? (
                  <button type="button" class="button" onClick={() => void upload(row)}>
                    Try again
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
