// Members, managed by the compliance officer: the list and the Add member dialog.
import { useState } from "preact/hooks";
import { api } from "../api";
import { takeDraft, useDraftSource } from "../drafts";
import { useResource } from "../hooks";
import { Heading } from "../router";
import { say } from "../store";
import type { MemberBody } from "../types";
import { Dialog } from "../ui/Dialog";
import { ActionNote, Button, Field, Problems, Refusal, SelectField, submit, useForm } from "../ui/forms";
import { Icon } from "../ui/Icon";
import { Fig, Table } from "../ui/Table";
import { ROLE_OPTIONS } from "./common-text";
import { useDesk } from "./desk";

const ADD = "add-member";
const EMPTY = { name: "", email: "", role: "compliance_analyst", password: "" };

export function MembersScreen() {
  const desk = useDesk();
  const [draft] = useState(() => takeDraft(ADD));
  const [adding, setAdding] = useState(draft !== null);
  const [list, reload] = useResource<{ members: MemberBody[] }>(`/api${desk.base}/members`);
  const form = useForm<Record<string, string>>(draft ?? EMPTY);
  useDraftSource(ADD, () => form.values, adding);

  const add = (event: Event) => {
    event.preventDefault();
    const v = form.values;
    void submit<{ member: MemberBody }>(form, {
      action: ADD,
      pending: "Saving…",
      call: () => api("POST", `/api${desk.base}/members`, { json: { name: v.name, email: v.email, role: v.role, password: v.password } }),
      done: () => {
        say(ADD, "Member added.", "success");
        for (const [name, value] of Object.entries(EMPTY)) form.set(name, value);
        setAdding(false);
        void reload();
      },
    });
  };

  const roleText = (role: MemberBody["role"]) => ROLE_OPTIONS.find((r) => r.value === role)?.label ?? role;
  return (
    <div class="screen">
      <section class="work">
        <div class="screen-head">
          <Heading>Members</Heading>
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Icon name="plus" />
            <span>Add member</span>
          </Button>
          <p class="lede">Everyone who can sign in to {desk.workspace.name}, and the role that decides what they may do.</p>
        </div>
        <ActionNote action={ADD} />
        {list.state === "loading" ? <div class="skeleton" aria-busy="true"><span /><span /><span /></div> : (
          <Table label="Members" columns={[{ label: "Name" }, { label: "Email" }, { label: "Role" }, { label: "Added" }]}
            rows={(list.state === "ready" ? list.data.members : []).map((m) => ({
              key: m.id,
              cells: [m.name, <span class="wrap-anywhere">{m.email}</span>, roleText(m.role), <Fig>{desk.when(m.createdAt)}</Fig>],
            }))} />
        )}
      </section>
      <Dialog open={adding} label="Add member" onClose={() => setAdding(false)}>
        <form class="form" noValidate onSubmit={add}>
          <Problems form={form} order={["name", "email", "role", "password"]} />
          <Refusal form={form} />
          <Field form={form} name="name" label="Name" autoComplete="off" />
          <Field form={form} name="email" label="Email" type="email" />
          <SelectField form={form} name="role" label="Role" options={ROLE_OPTIONS} />
          <Field form={form} name="password" label="Starting password" type="password" autoComplete="new-password"
            hint="At least 12 characters. The member signs in with it." />
          <div class="form-actions">
            <Button type="submit" variant="primary" disabled={form.busy}>Add member</Button>
            <Button onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
