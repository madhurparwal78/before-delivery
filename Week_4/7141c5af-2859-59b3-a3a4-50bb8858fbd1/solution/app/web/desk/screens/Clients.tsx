import type { JSX } from "preact";
import { copy, ERASED_CLIENT_NAME } from "../../../server/domain/copy.ts";
import { type Language, type Town, TOWN_NAMES, TOWNS } from "../../../server/domain/towns.ts";
import { announce } from "../lib/announce.ts";
import { get, post } from "../lib/api.ts";
import { Dialog, useDialog } from "../lib/dialog.tsx";
import { AsyncButton, Field, Problems, SelectField, useForm } from "../lib/forms.tsx";
import { useLive } from "../lib/live.ts";
import { type Client, LANGUAGE_CHOICES } from "../lib/names.ts";
import { Empty, Heading, Loading, MainAction, MintTile } from "../lib/screen.tsx";
import type { ScreenProps } from "../routes.tsx";

const BLANK: { name: string; town: Town; language: Language; email: string } = { name: "", town: "Turin", language: TOWNS.Turin.language, email: "" };

const STATE_NAMES: Record<string, string> = { active: "Active", closing: "Closing", erasing: "Erasing", erased: "Erased" };

export function clientStateName(state: string): string {
  return STATE_NAMES[state] ?? state;
}

function NewClient({ control, onSaved }: { control: ReturnType<typeof useDialog>; onSaved: () => Promise<void> }): JSX.Element {
  const form = useForm<Record<keyof typeof BLANK, string>>(BLANK, control);
  return (
    <Dialog control={control} title="New client">
      <Problems form={form} firstField="name" />
      <Field form={form} name="name" label="Name" autocomplete="name" />
      <SelectField
        form={form}
        name="town"
        label="Town"
        choices={TOWN_NAMES.map((town) => ({ value: town, label: town }))}
        onChoose={(town) => form.replace({ ...form.values, town, language: TOWNS[town as Town].language })}
      />
      <SelectField form={form} name="language" label="Language" choices={LANGUAGE_CHOICES} />
      <Field form={form} name="email" label="Email" autocomplete="email" />
      <AsyncButton
        label="Save client"
        primary
        onPress={async () => {
          let name = "";
          const saved = await form.submit(async () => {
            name = (await post<{ client: Client }>("/api/clients", form.values)).client.name;
          });
          if (!saved) return;
          form.replace(BLANK);
          announce(copy("F-102", { name }));
          control.done();
          await onSaved();
        }}
      />
    </Dialog>
  );
}

function ClientRow({ client }: { client: Client }): JSX.Element {
  const gone = client.state === "erasing" || client.state === "erased";
  return (
    <tr>
      <th scope="row">
        {gone ? (
          (client.state === "erased" ? ERASED_CLIENT_NAME : client.name)
        ) : (
          <a class="link-row" href={`/clients/${client.id}`} data-return={client.id}>
            {client.name}
          </a>
        )}
      </th>
      <td>{client.town ?? ""}</td>
      <td>{LANGUAGE_CHOICES.find((choice) => choice.value === client.language)?.label ?? ""}</td>
      <td>{client.email ?? ""}</td>
      <td>{clientStateName(client.state)}</td>
    </tr>
  );
}

export function ClientsScreen(_props: ScreenProps): JSX.Element {
  const clients = useLive(() => get<{ clients: Client[] }>("/api/clients"), []);
  const create = useDialog("New client");
  const rows = clients.data?.clients;
  return (
    <>
      <Heading text="Clients" ready={rows !== undefined}>
        <MainAction>
          <button type="button" class="button button--primary" onClick={(event) => create.show(event.currentTarget)}>
            New client
          </button>
        </MainAction>
      </Heading>
      <div class="bento">
        {rows === undefined ? (
          <Loading size="t-nine" height={320} />
        ) : rows.length === 0 ? (
          <section class="tile t-nine" aria-label="Clients table">
            <Empty text="No clients yet." />
          </section>
        ) : (
          <section class="tile t-nine">
            <div class="frame" role="region" aria-label="Clients table" tabIndex={0}>
              <table class="desk-table clients-table">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Town</th>
                    <th scope="col">Language</th>
                    <th scope="col">Email</th>
                    <th scope="col">State</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((client) => (
                    <ClientRow key={client.id} client={client} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
        <MintTile label="Clients" figure={rows ? String(rows.filter((client) => client.state !== "erased").length) : "…"} />
      </div>
      <NewClient control={create} onSaved={clients.reload} />
    </>
  );
}
