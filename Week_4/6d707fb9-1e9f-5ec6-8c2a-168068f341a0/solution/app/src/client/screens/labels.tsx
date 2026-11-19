import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Label, LabelWithSuppliers, StyleRow } from "../../shared/api";
import { LANGUAGES } from "../../shared/catalog";
import { shownDate, wallTime } from "../../shared/time";
import { announce, focusHeading, navigate, patch, post, remove, useResource, useTitle } from "../lib";
import { Button, Field, Modal, Problems, TableFrame, useDialog, useForm, type DialogControl } from "../ui";
import { RefreshLine } from "../frame";
import { Heading, NotFound } from "./public";

const STATES: Record<Label["state"], string> = { open: "Open", closed: "Closed", erased: "Erased" };

function NewLabelForm({ control }: { control: DialogControl }): JSX.Element {
  const form = useForm("new-label", { name: "", contactName: "", contactEmail: "" });
  const save = (event: Event): void => {
    event.preventDefault();
    void form.submit(async () => {
      const label = await post<Label>("/api/labels", form.values);
      control.hide();
      navigate(`/labels/${label.id}`);
      announce(`Label ${label.name} added.`);
    });
  };
  return (
    <form onSubmit={save} noValidate>
      <h2>New label</h2>
      <Problems form={form} />
      <Field form={form} name="name" label="Name" value={form.values.name} onValue={(value) => form.set("name", value)} />
      <Field form={form} name="contactName" label="Contact name" value={form.values.contactName} onValue={(value) => form.set("contactName", value)} />
      <Field form={form} name="contactEmail" label="Contact email" type="email" value={form.values.contactEmail} onValue={(value) => form.set("contactEmail", value)} />
      <div class="dialog-actions">
        <Button type="submit" green busy={form.busy}>
          Save label
        </Button>
        <Button onPress={control.hide}>Close</Button>
      </div>
    </form>
  );
}

function PasswordForm({ control }: { control: DialogControl }): JSX.Element {
  const form = useForm(null, { currentPassword: "", newPassword: "" });
  const save = (event: Event): void => {
    event.preventDefault();
    void form.submit(async () => {
      await post("/api/password", form.values, { noSessionWatch: true });
      control.hide();
      announce("Password changed.");
    });
  };
  return (
    <form onSubmit={save} noValidate>
      <h2>Change password</h2>
      <Problems form={form} />
      <Field form={form} name="currentPassword" label="Current password" type="password" autoComplete="current-password" value={form.values.currentPassword} onValue={(value) => form.set("currentPassword", value)} />
      <Field form={form} name="newPassword" label="New password" type="password" autoComplete="new-password" value={form.values.newPassword} onValue={(value) => form.set("newPassword", value)} />
      <div class="dialog-actions">
        <Button type="submit" green busy={form.busy}>
          Save password
        </Button>
        <Button onPress={control.hide}>Close</Button>
      </div>
    </form>
  );
}

export function Labels(): JSX.Element {
  useTitle("Labels");
  const labels = useResource<{ labels: Label[] }>("/api/labels");
  const newLabel = useDialog("new-label");
  const password = useDialog();
  return (
    <main class="desk-main">
      <Heading>Labels</Heading>
      <RefreshLine />
      <div class="screen-actions">
        <Button onPress={password.show}>Change password</Button>
        <div class="action-bar">
          <Button green onPress={newLabel.show}>
            New label
          </Button>
        </div>
      </div>
      <TableFrame name="Labels table">
        <table class="table-fit">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">State</th>
              <th scope="col">Contact</th>
            </tr>
          </thead>
          <tbody>
            {(labels.data?.labels ?? []).map((label) => (
              <tr key={label.id}>
                <td>
                  <a class="cell-link" href={`/labels/${label.id}`}>
                    {label.name}
                  </a>
                </td>
                <td>{STATES[label.state]}</td>
                <td>{label.contactName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableFrame>
      {labels.data && !labels.data.labels.length ? (
        <div class="empty-state">
          <div class="fragment fragment-empty" aria-hidden="true">
            <span class="fake-button">New label</span>
          </div>
          <p>No labels yet. Press New label to add the first one.</p>
        </div>
      ) : null}
      <Modal name="New label" control={newLabel}>
        <NewLabelForm control={newLabel} />
      </Modal>
      <Modal name="Change password" control={password}>
        <PasswordForm control={password} />
      </Modal>
    </main>
  );
}

function RenameForm({ label, control, onSaved }: { label: Label; control: DialogControl; onSaved: () => Promise<void> }): JSX.Element {
  const form = useForm("rename-label", { name: label.name });
  const save = (event: Event): void => {
    event.preventDefault();
    void form.submit(async () => {
      const saved = await patch<Label>(`/api/labels/${label.id}`, { name: form.values.name });
      await onSaved();
      control.hide();
      announce(`Label renamed to ${saved.name}.`);
    });
  };
  return (
    <form onSubmit={save} noValidate>
      <h2>Rename label</h2>
      <Problems form={form} />
      <Field form={form} name="name" label="Name" value={form.values.name} onValue={(value) => form.set("name", value)} />
      <div class="dialog-actions">
        <Button type="submit" green busy={form.busy}>
          Save name
        </Button>
        <Button onPress={control.hide}>Close</Button>
      </div>
    </form>
  );
}

function ConfirmForm({ title, text, yes, no, control, action }: { title: string; text: string; yes: string; no: string; control: DialogControl; action: () => Promise<void> }): JSX.Element {
  const form = useForm(null, {});
  return (
    <div>
      <h2>{title}</h2>
      <p>{text}</p>
      <Problems form={form} />
      <div class="dialog-actions">
        <Button green busy={form.busy} onPress={() => void form.submit(action)}>
          {yes}
        </Button>
        <Button onPress={control.hide}>{no}</Button>
      </div>
    </div>
  );
}

export { ConfirmForm };

export function LabelPage({ id }: { id: string }): JSX.Element {
  const label = useResource<LabelWithSuppliers>(`/api/labels/${id}`);
  const styles = useResource<{ styles: StyleRow[] }>(`/api/styles?label=${encodeURIComponent(id)}`);
  const rename = useDialog("rename-label");
  const del = useDialog();
  const close = useDialog();
  const back = useDialog();
  const [closedNote, setClosedNote] = useState<string | null>(null);
  const known = useRef<Label["state"] | null>(null);
  const data = label.data;
  useTitle(data?.name);

  useEffect(() => {
    if (!data) return;
    if (known.current && known.current !== "erased" && data.state === "erased") announce(`Label ${data.name} erased.`);
    known.current = data.state;
  }, [data?.state]);

  if (label.missing) return <NotFound />;

  const reloadAll = async (): Promise<void> => {
    await Promise.all([label.reload(), styles.reload()]);
  };

  return (
    <main class="desk-main">
      <Heading>{data?.name ?? ""}</Heading>
      <RefreshLine />
      {data ? (
        <>
          <p class="state-line">
            State: <b>{STATES[data.state]}</b>
            {data.state === "closed" && data.eraseAt ? ` · It will be erased on ${shownDate(data.eraseAt)}, ${wallTime(data.eraseAt)} Lisbon time.` : ""}
          </p>
          {closedNote ? <p class="stone-band">{closedNote}</p> : null}
          {data.state !== "erased" ? (
            <>
              <div class="screen-actions">
                {data.state === "open" ? (
                  <>
                    <Button key="close" onPress={close.show}>
                      Close label
                    </Button>
                    <Button key="delete" onPress={del.show}>
                      Delete label
                    </Button>
                  </>
                ) : (
                  <Button key="back" onPress={back.show}>
                    Bring back
                  </Button>
                )}
                <div class="action-bar">
                  <Button green onPress={rename.show}>
                    Rename label
                  </Button>
                </div>
              </div>
              <section class="panel" aria-label="Contact">
                <h2>Contact</h2>
                <p>
                  {data.contactName} · {data.contactEmail}
                </p>
              </section>
              <section class="panel" aria-label="Suppliers">
                <h2>Suppliers</h2>
                {data.suppliers.length ? (
                  <ul class="plain-list">
                    {data.suppliers.map((supplier) => (
                      <li key={supplier.id}>
                        <b>{supplier.name}</b> · {supplier.townName} · {LANGUAGES.find((language) => language.id === supplier.language)?.name} · {supplier.contactName} · {supplier.contactEmail}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No suppliers yet.</p>
                )}
              </section>
              <section class="panel" aria-label="Styles of this label">
                <h2>Styles</h2>
                {styles.data?.styles.length ? (
                  <ul class="plain-list">
                    {styles.data.styles.map((style) => (
                      <li key={style.id}>
                        <a class="cell-link" href={`/styles/${style.id}`}>
                          {style.name}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No styles yet.</p>
                )}
              </section>
              <Modal name="Rename label" control={rename}>
                <RenameForm label={data} control={rename} onSaved={reloadAll} />
              </Modal>
              <Modal name="Delete label" control={del}>
                <ConfirmForm
                  title="Delete label"
                  text={`Delete ${data.name} and everything under it? Its passports will be withdrawn.`}
                  yes="Delete"
                  no="Keep"
                  control={del}
                  action={async () => {
                    await remove(`/api/labels/${id}`);
                    del.hide();
                    navigate("/labels");
                    announce(`Label ${data.name} deleted.`);
                  }}
                />
              </Modal>
              <Modal name="Close label" control={close}>
                <ConfirmForm
                  title="Close label"
                  text={`Close ${data.name}? Its pages end and writes stop until you bring it back within the wait. After that it is erased.`}
                  yes="Close this label"
                  no="Keep open"
                  control={close}
                  action={async () => {
                    const closed = await post<Label>(`/api/labels/${id}/close`);
                    await reloadAll();
                    close.hide();
                    setClosedNote(null);
                    announce(`Label ${closed.name} closed. It will be erased on ${shownDate(closed.eraseAt as string)}, ${wallTime(closed.eraseAt as string)} Lisbon time unless you bring it back.`);
                  }}
                />
              </Modal>
              <Modal name="Bring back" control={back}>
                <ConfirmForm
                  title="Bring back"
                  text={`Bring ${data.name} back exactly as it was?`}
                  yes="Bring back label"
                  no="Keep closed"
                  control={back}
                  action={async () => {
                    const open = await post<Label>(`/api/labels/${id}/bring-back`);
                    await reloadAll();
                    back.hide();
                    focusHeading();
                    announce(`Label ${open.name} is back.`);
                  }}
                />
              </Modal>
            </>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
