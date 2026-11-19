import type { JSX } from "preact";
import { copy } from "../../../server/domain/copy.ts";
import { addDays, dateCopy } from "../../../server/domain/time.ts";
import { ActionMenu } from "../lib/menu.tsx";
import { announce } from "../lib/announce.ts";
import { ApiFailure, api, get, post } from "../lib/api.ts";
import { Dialog, focusHeading, useDialog } from "../lib/dialog.tsx";
import { AsyncButton, Field, Problems, SelectField, useForm } from "../lib/forms.tsx";
import { rendered, useLive } from "../lib/live.ts";
import { type Client, liveClients, PIECE_STATES, type Piece, readPieces, stateName } from "../lib/names.ts";
import { commitSearch, navigate } from "../lib/router.tsx";
import { Empty, Heading, Loading, MainAction, MintTile, useSession } from "../lib/screen.tsx";
import type { ScreenProps } from "../routes.tsx";

const DUE_WINDOW_DAYS = 14;

const BLANK = { clientId: "", title: "", maker: "", year: "", stampNumber: "", widthCm: "", depthCm: "", heightCm: "", weightKg: "", dueDate: "", notes: "" };

interface FilterProps {
  label: string;
  value: string;
  choices: readonly { value: string; label: string }[];
  onChoose: (value: string) => void;
}

function Filter({ label, value, choices, onChoose }: FilterProps): JSX.Element {
  return (
    <label class="field">
      <span class="field-label">{label}</span>
      <select class="input" value={value} onChange={(event) => onChoose(event.currentTarget.value)}>
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function NewPiece({ control, clients, onSaved }: { control: ReturnType<typeof useDialog>; clients: readonly Client[]; onSaved: () => Promise<void> }): JSX.Element {
  const form = useForm(BLANK, control);
  const choices = liveClients(clients).map((client) => ({ value: client.id, label: client.name }));
  const clientId = form.values.clientId || (choices[0]?.value ?? "");
  return (
    <Dialog control={control} title="New piece">
      <Problems form={form} firstField="stampNumber" />
      <SelectField form={{ ...form, values: { ...form.values, clientId } }} name="clientId" label="Client" choices={choices} />
      <Field form={form} name="title" label="Title" />
      <Field form={form} name="maker" label="Maker" />
      <Field form={form} name="year" label="Year" />
      <Field form={form} name="stampNumber" label="Stamp number" inputMode="numeric" />
      <div class="field-pair">
        <Field form={form} name="widthCm" label="Width in cm" inputMode="decimal" />
        <Field form={form} name="depthCm" label="Depth in cm" inputMode="decimal" />
        <Field form={form} name="heightCm" label="Height in cm" inputMode="decimal" />
        <Field form={form} name="weightKg" label="Weight in kg" inputMode="decimal" />
      </div>
      <Field form={form} name="dueDate" label="Due date" />
      <Field form={form} name="notes" label="Notes" multiline />
      <AsyncButton
        label="Save piece"
        primary
        onPress={async () => {
          const body = Object.fromEntries(Object.entries({ ...form.values, clientId }).filter(([, value]) => value !== ""));
          let title = "";
          const saved = await form.submit(async () => {
            title = (await post<{ piece: Piece }>("/api/pieces", body)).piece.title;
          });
          if (!saved) return;
          form.replace(BLANK);
          announce(copy("F-15", { title }));
          control.done();
          await onSaved();
        }}
      />
    </Dialog>
  );
}

function PieceRow({ piece, onChanged }: { piece: Piece; onChanged: (trigger: HTMLElement) => Promise<void> }): JSX.Element {
  const write = async (trigger: HTMLElement, work: () => Promise<unknown>, done: string): Promise<void> => {
    try {
      await work();
      announce(done);
      await onChanged(trigger);
    } catch (error) {
      if (error instanceof ApiFailure) announce(error.message);
    }
  };
  return (
    <tr>
      <th scope="row">
        <a class="link-row" href={`/pieces/${piece.id}`} data-return={piece.id}>
          {piece.title}
        </a>
      </th>
      <td>{piece.clientName}</td>
      <td>{stateName(piece.state)}</td>
      <td>{piece.dueDate ? dateCopy(piece.dueDate) : ""}</td>
      <td class="cell-action">
        <ActionMenu
          name={`Actions for ${piece.title}`}
          visible="Actions"
          items={[
            { label: "Open", onSelect: () => navigate(`/pieces/${piece.id}`, { returnTo: piece.id }) },
            { label: "Duplicate", onSelect: (trigger) => void write(trigger, () => post("/api/pieces", { duplicateOf: piece.id }), copy("F-104", { title: piece.title })) },
            { label: "Archive", onSelect: (trigger) => void write(trigger, () => api("PATCH", `/api/pieces/${piece.id}`, { state: "archived" }), copy("F-16", { title: piece.title })) },
          ]}
        />
      </td>
    </tr>
  );
}

export function PiecesScreen({ query }: ScreenProps): JSX.Element {
  const session = useSession();
  const search = query.toString();
  const list = useLive(() => get<{ pieces: Piece[]; nextCursor: string | null }>(`/api/pieces?${search}`), [search]);
  const clients = useLive(() => get<{ clients: Client[] }>("/api/clients"), []);
  const lastDue = addDays(session.today, DUE_WINDOW_DAYS);
  const inWindow = (piece: Piece): boolean => piece.dueDate !== null && piece.dueDate >= session.today && piece.dueDate <= lastDue;
  const due = useLive(
    async () => (await readPieces(new URLSearchParams({ sort: "dueDate" }), (page) => page.some((piece) => piece.dueDate === null || piece.dueDate > lastDue))).filter(inWindow),
    [lastDue],
  );
  const create = useDialog("New piece");

  const commit = (name: string, value: string): void => {
    const next = new URLSearchParams(query);
    next.delete("cursor");
    if (value) next.set(name, value);
    else next.delete(name);
    const text = next.toString();
    commitSearch(text ? `?${text}` : "");
  };

  const reloadAll = async (): Promise<void> => {
    await Promise.all([list.reload(), due.reload()]);
    await rendered();
  };

  const nextAddress = (cursor: string): string => {
    const next = new URLSearchParams(query);
    next.set("cursor", cursor);
    return `/pieces?${next}`;
  };

  const clientRows = clients.data?.clients ?? [];
  const dueList = due.data;
  return (
    <>
      <Heading text="Pieces" ready={list.data !== undefined}>
        <MainAction>
          <button type="button" class="button button--primary" onClick={(event) => create.show(event.currentTarget)}>
            New piece
          </button>
        </MainAction>
      </Heading>
      <div class="bento">
        <section class="tile t-nine filters" aria-label="Filters">
          <Filter
            label="Client"
            value={query.get("client") ?? ""}
            choices={[{ value: "", label: "All clients" }, ...clientRows.filter((client) => client.state !== "erased").map((client) => ({ value: client.id, label: client.name }))]}
            onChoose={(value) => commit("client", value)}
          />
          <Filter label="State" value={query.get("state") ?? ""} choices={[{ value: "", label: "All but archived" }, ...PIECE_STATES]} onChoose={(value) => commit("state", value)} />
          <Filter
            label="Sort"
            value={query.get("sort") ?? "title"}
            choices={[
              { value: "title", label: "Title" },
              { value: "dueDate", label: "Due date" },
            ]}
            onChoose={(value) => commit("sort", value === "title" ? "" : value)}
          />
        </section>
        <MintTile label="Due within 14 days" figure={dueList ? String(dueList.length) : "…"} note={dueList?.length === 1 ? dueList[0]?.title : null} />
        {list.data === undefined ? (
          <Loading height={420} />
        ) : list.data.pieces.length === 0 ? (
          <section class="tile t-full" aria-label="Pieces table">
            <Empty text="No pieces yet." />
          </section>
        ) : (
          <section class="tile t-full">
            <div class="frame" role="region" aria-label="Pieces table" tabIndex={0}>
              <table class="desk-table">
                <thead>
                  <tr>
                    <th scope="col">Piece</th>
                    <th scope="col">Client</th>
                    <th scope="col">State</th>
                    <th scope="col">Due</th>
                    <th scope="col">
                      <span class="visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.pieces.map((piece) => (
                    <PieceRow
                      key={piece.id}
                      piece={piece}
                      onChanged={async (trigger) => {
                        await reloadAll();
                        if (!trigger.isConnected) focusHeading();
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            {list.data.nextCursor ? (
              <a class="button next-page" href={nextAddress(list.data.nextCursor)}>
                Next page
              </a>
            ) : null}
          </section>
        )}
      </div>
      <NewPiece control={create} clients={clientRows} onSaved={reloadAll} />
    </>
  );
}
