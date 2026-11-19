import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { copy } from "../../../server/domain/copy.ts";
import { dateCopy, localDate } from "../../../server/domain/time.ts";
import { TURIN_ZONE } from "../../../server/domain/towns.ts";
import { announce } from "../lib/announce.ts";
import { ApiFailure, api, get, post } from "../lib/api.ts";
import { Dialog, useDialog } from "../lib/dialog.tsx";
import { AsyncButton, Field, Problems, useForm } from "../lib/forms.tsx";
import { useLive } from "../lib/live.ts";
import { type Client, LANGUAGE_CHOICES, readPieces, stateName } from "../lib/names.ts";
import { navigate } from "../lib/router.tsx";
import { Empty, Heading, Loading, MainAction, MintTile } from "../lib/screen.tsx";
import type { ScreenProps } from "../routes.tsx";
import { clientStateName } from "./Clients.tsx";

function RenameClient({ control, client, onSaved }: { control: ReturnType<typeof useDialog>; client: Client; onSaved: (client: Client) => void }): JSX.Element {
  const form = useForm({ name: client.name }, control);
  return (
    <Dialog control={control} title="Rename client">
      <Problems form={form} firstField="name" />
      <Field form={form} name="name" label="Name" autocomplete="name" />
      <AsyncButton
        label="Save client"
        primary
        onPress={async () => {
          let renamed: Client | null = null;
          const saved = await form.submit(async () => {
            renamed = (await api<{ client: Client }>("PATCH", `/api/clients/${client.id}`, form.values)).client;
          });
          if (!saved || !renamed) return;
          onSaved(renamed);
          announce(copy("F-102", { name: (renamed as Client).name }));
          control.done();
        }}
      />
    </Dialog>
  );
}

export function ClientScreen({ id }: ScreenProps): JSX.Element {
  const live = useLive(async () => {
    const [{ client }, pieces] = await Promise.all([get<{ client: Client }>(`/api/clients/${id}`), readPieces(new URLSearchParams({ client: id }))]);
    return { client, pieces };
  }, [id]);
  const rename = useDialog("Rename client");
  const closing = useDialog("Close this client");
  const [notice, setNotice] = useState<string | null>(null);
  const data = live.data;
  if (!data) return <Loading height={360} />;
  const { client, pieces } = data;

  const refused = (message: string): void => {
    setNotice(message);
    announce(message);
  };

  return (
    <>
      <Heading text={client.name}>
        <MainAction>
          <button type="button" class="button button--primary" onClick={(event) => rename.show(event.currentTarget)}>
            Rename client
          </button>
        </MainAction>
      </Heading>
      <div class="bento">
        <section class="tile t-large" aria-label="Client">
          <dl class="facts">
            <dt>Town</dt>
            <dd>{client.town}</dd>
            <dt>Language</dt>
            <dd>{LANGUAGE_CHOICES.find((choice) => choice.value === client.language)?.label}</dd>
            <dt>Email</dt>
            <dd>{client.email}</dd>
            <dt>State</dt>
            <dd>{clientStateName(client.state)}</dd>
          </dl>
          {notice ? <p class="notice">{notice}</p> : null}
          <div class="actions">
            {client.state === "active" ? (
              <button type="button" class="button" onClick={(event) => closing.show(event.currentTarget)}>
                Close client
              </button>
            ) : (
              <AsyncButton
                label="Bring back"
                onPress={async () => {
                  try {
                    await post(`/api/clients/${id}/bring-back`);
                    setNotice(null);
                    announce(copy("F-20", { name: client.name }));
                    await live.reload();
                  } catch (error) {
                    if (error instanceof ApiFailure && error.status !== 401) refused(copy("F-110"));
                  }
                }}
              />
            )}
            <AsyncButton
              label="Delete client"
              onPress={async () => {
                try {
                  await api("DELETE", `/api/clients/${id}`);
                  navigate("/clients");
                  announce(copy("F-103", { name: client.name }));
                } catch (error) {
                  if (error instanceof ApiFailure) refused(error.message);
                }
              }}
            />
          </div>
        </section>
        <MintTile label="Pieces" figure={String(pieces.length)} size="t-medium" />
        <section class="tile t-full" aria-labelledby="client-pieces">
          <h2 id="client-pieces">Pieces</h2>
          {pieces.length === 0 ? (
            <Empty text="No pieces yet." />
          ) : (
            <ul class="plain-list">
              {pieces.map((piece) => (
                <li key={piece.id}>
                  <a class="link-row" href={`/pieces/${piece.id}`}>
                    {piece.title}
                  </a>
                  <span class="muted">
                    {stateName(piece.state)}
                    {piece.dueDate ? `, due ${dateCopy(piece.dueDate)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <RenameClient control={rename} client={client} onSaved={(next) => live.set({ client: next, pieces })} />
      <Dialog control={closing} title="Close this client" closeLabel={null}>
        <p>{client.name} can be brought back until the wait ends. After it, everything held for this client is erased.</p>
        <div class="actions">
          <AsyncButton
            label="Close client"
            primary
            onPress={async () => {
              try {
                const closed = (await post<{ client: Client }>(`/api/clients/${id}/close`)).client;
                live.set({ client: closed, pieces });
                announce(copy("F-19", { name: client.name, date: dateCopy(localDate(new Date(closed.closesAt as string), TURIN_ZONE)) }));
                closing.done();
              } catch (error) {
                if (error instanceof ApiFailure) refused(error.message);
              }
            }}
          />
          <button type="button" class="button" onClick={closing.hide}>
            Keep client
          </button>
        </div>
      </Dialog>
    </>
  );
}
