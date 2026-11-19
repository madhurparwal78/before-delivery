import type { JSX } from "preact";
import { useRef, useState } from "preact/hooks";
import { copy } from "../../../server/domain/copy.ts";
import { announce } from "../lib/announce.ts";
import { api } from "../lib/api.ts";
import { Dialog, useDialog } from "../lib/dialog.tsx";
import { AsyncButton, Problems, useForm } from "../lib/forms.tsx";
import { Empty, Heading, MainAction, MintTile } from "../lib/screen.tsx";
import type { ScreenProps } from "../routes.tsx";

interface PreviewRow {
  row: number;
  status: "new" | "matched" | "refused";
  reason: string | null;
  client: string;
  piece: string;
  stamp: string;
}

interface Preview {
  rows: PreviewRow[];
  counts: { new: number; matched: number; refused: number };
}

interface Saved {
  created: number;
  matched: number;
  refused: number;
}

const STATUS_NAMES: Record<PreviewRow["status"], string> = { new: "New", matched: "Matched", refused: "Refused" };

function formOf(file: File): FormData {
  const body = new FormData();
  body.append("file", file);
  return body;
}

function PreviewTable({ rows }: { rows: readonly PreviewRow[] }): JSX.Element {
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const toggle = (row: number): void => {
    const next = new Set(open);
    if (!next.delete(row)) next.add(row);
    setOpen(next);
  };
  return (
    <table>
      <thead>
        <tr>
          <th scope="col">Row</th>
          <th scope="col">Status</th>
          <th scope="col">Client</th>
          <th scope="col">Piece</th>
          <th scope="col">Stamp</th>
        </tr>
      </thead>
      {rows.map((row) => (
        <tbody key={row.row}>
          <tr>
            <td>
              <button type="button" class="button" aria-expanded={open.has(row.row)} onClick={() => toggle(row.row)}>
                Row {row.row}
              </button>
            </td>
            <td class={`status-${row.status}`}>{STATUS_NAMES[row.status]}</td>
            <td>{row.client}</td>
            <td>{row.piece}</td>
            <td>{row.stamp}</td>
          </tr>
          {open.has(row.row) ? (
            <tr>
              <td colSpan={5}>{row.reason ?? `${row.piece}: ${STATUS_NAMES[row.status]}`}</td>
            </tr>
          ) : null}
        </tbody>
      ))}
    </table>
  );
}

export function WorkbookScreen(_props: ScreenProps): JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [turn, setTurn] = useState(0);
  const save = useDialog("Save this file");
  const form = useForm({ file: "" });
  const dialogForm = useForm({ file: "" }, save);

  const read = async (chosen: File): Promise<void> => {
    const answer = await api<Preview>("POST", "/api/workbook/preview", formOf(chosen));
    setPreview(answer);
    setTurn((value) => value + 1);
    const { new: created, matched, refused } = answer.counts;
    announce(copy("F-108", { a: created, b: matched, c: refused }));
  };

  const choose = async (chosen: File): Promise<void> => {
    setFile(chosen);
    setPreview(null);
    await form.submit(() => read(chosen));
  };

  return (
    <>
      <Heading text="Old workbook">
        <MainAction>
          <button
            type="button"
            class="button button--primary"
            onClick={(event) => {
              if (preview) save.show(event.currentTarget);
              else form.refuse({ file: copy("F-04") });
            }}
          >
            Save
          </button>
        </MainAction>
      </Heading>
      <div class="bento">
        <section class="tile t-nine stack workbook-file" aria-label="File">
          <Problems form={form} firstField="file" />
          <div class="actions">
            <button id={form.ids.file} type="button" class="button" onClick={() => input.current?.click()}>
              Choose a file
            </button>
            <input
              ref={input}
              type="file"
              hidden
              onChange={(event) => {
                const chosen = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (chosen) void choose(chosen);
              }}
            />
            <a class="button" href="/api/materials-list.csv" download>
              Download materials list
            </a>
          </div>
          {file ? <p class="muted">{file.name}</p> : null}
        </section>
        <MintTile label="New rows" figure={String(preview?.counts.new ?? 0)} />
        <section class="tile t-full">
          <h2>Preview</h2>
          <div class="frame" role="region" aria-label="Workbook preview" tabIndex={0}>
            {preview ? <PreviewTable key={turn} rows={preview.rows} /> : <Empty text="No file chosen yet." />}
          </div>
        </section>
      </div>
      <Dialog control={save} title="Save this file">
        <Problems form={dialogForm} firstField="file" />
        {file && preview ? (
          <p>
            {file.name}: {preview.counts.new} new, {preview.counts.matched} matched, {preview.counts.refused} refused.
          </p>
        ) : null}
        <AsyncButton
          id={dialogForm.ids.file}
          label="Save file"
          primary
          onPress={async () => {
            if (!file) return;
            let saved: Saved | null = null;
            const done = await dialogForm.submit(async () => {
              saved = await api<Saved>("POST", "/api/workbook/save", formOf(file));
              setPreview(await api<Preview>("POST", "/api/workbook/preview", formOf(file)));
            });
            if (!done || !saved) return;
            const { created, matched, refused } = saved as Saved;
            save.done();
            announce(copy("F-88", { a: created, b: matched, c: refused }));
          }}
        />
      </Dialog>
    </>
  );
}
