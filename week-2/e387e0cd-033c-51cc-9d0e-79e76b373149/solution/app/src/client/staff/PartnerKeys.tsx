// Partner keys: create (the secret is shown once), each key's last use in business time, and revoke.
import { useState } from "preact/hooks";
import { api } from "../api";
import { takeDraft, useDraftSource } from "../drafts";
import { useResource } from "../hooks";
import { Heading } from "../router";
import { say } from "../store";
import type { PartnerKey } from "../types";
import { Dialog } from "../ui/Dialog";
import { ActionNote, Button, Field, Problems, Refusal, submit, useForm } from "../ui/forms";
import { Icon } from "../ui/Icon";
import { Fig, Table } from "../ui/Table";
import { useDesk } from "./desk";

const CREATE = "create-key";
const REVOKE = "revoke-key";

export function PartnerKeysScreen() {
  const desk = useDesk();
  const [draft] = useState(() => takeDraft(CREATE));
  const [creating, setCreating] = useState(draft !== null);
  const [secret, setSecret] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<PartnerKey | null>(null);
  const [list, reload] = useResource<{ keys: PartnerKey[] }>(`/api${desk.base}/partner-keys`);
  const form = useForm<Record<string, string>>(draft ?? { label: "" });
  const revokeForm = useForm<Record<string, string>>({});
  useDraftSource(CREATE, () => form.values, creating);

  const create = (event: Event) => {
    event.preventDefault();
    void submit<{ key: PartnerKey; secret: string }>(form, {
      action: CREATE,
      pending: "Creating…",
      call: () => api("POST", `/api${desk.base}/partner-keys`, { json: { label: form.values.label } }),
      done: (data) => {
        say(CREATE, "Key created. Copy it now: it won't be shown again.", "success");
        form.set("label", "");
        setCreating(false);
        setSecret(data.secret);
        void reload();
      },
    });
  };

  const revoke = (key: PartnerKey) => void submit<{ key: PartnerKey }>(revokeForm, {
    action: REVOKE,
    pending: "Revoking…",
    call: () => api("DELETE", `/api${desk.base}/partner-keys/${key.id}`),
    done: () => {
      say(REVOKE, "Key revoked.", "success");
      setRevoking(null);
      void reload();
    },
  });

  const copy = async () => {
    if (secret === null) return;
    try {
      await navigator.clipboard.writeText(secret);
      say(CREATE, "Key copied. Keep it somewhere safe: it won't be shown again.", "success");
    } catch {
      say(CREATE, "The key could not be copied. Select it and copy it by hand.", "refusal");
    }
  };

  return (
    <div class="screen">
      <section class="work">
        <div class="screen-head">
          <Heading>Partner keys</Heading>
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Icon name="plus" />
            <span>Create key</span>
          </Button>
          <p class="lede">Keys your exchange backend uses to open withdrawal cases. A key is shown once, when it is created.</p>
        </div>
        <ActionNote action={[CREATE, REVOKE]} />
        {list.state === "loading" ? <div class="skeleton" aria-busy="true"><span /><span /><span /></div> : (
          <Table label="Partner keys" columns={[{ label: "Label" }, { label: "Key starts" }, { label: "Created" }, { label: "Last used" },
            { label: "Status" }]}
            rows={(list.state === "ready" ? list.data.keys : []).map((k) => ({
              key: k.id,
              class: k.revokedAt ? "row-muted" : undefined,
              cells: [
                k.label,
                <Fig>{k.startsWith}…</Fig>,
                <Fig>{desk.when(k.createdAt)}</Fig>,
                k.lastUsedAt ? <Fig>{desk.when(k.lastUsedAt)}</Fig> : <span class="muted">Never</span>,
                k.revokedAt
                  ? <span class="badge">Revoked <Fig>{desk.when(k.revokedAt)}</Fig></span>
                  : (
                    <span class="key-status">
                      <span class="badge badge-ink">Active</span>
                      <Button variant="danger" onClick={() => setRevoking(k)}>Revoke</Button>
                    </span>
                  ),
              ],
            }))} />
        )}
      </section>
      <Dialog open={creating} label="Create key" onClose={() => setCreating(false)}>
        <form class="form" noValidate onSubmit={create}>
          <Problems form={form} />
          <Refusal form={form} />
          <Field form={form} name="label" label="Label" hint="What the key is for, for example Treasury ledger." />
          <div class="form-actions">
            <Button type="submit" variant="primary" disabled={form.busy}>Create</Button>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
          </div>
        </form>
      </Dialog>
      <Dialog open={secret !== null} label="New partner key" onClose={() => setSecret(null)}>
        <Button variant="primary" onClick={copy}>Copy key</Button>
        <div class="field">
          <label class="field-label" for="new-partner-key">Partner key</label>
          <input id="new-partner-key" class="input mono" readOnly value={secret ?? ""} />
          <p class="field-hint">Copy it now: it won't be shown again. The desk keeps only its hash.</p>
        </div>
        <div class="form-actions">
          <Button onClick={() => setSecret(null)}>Done</Button>
        </div>
      </Dialog>
      <Dialog open={revoking !== null} label="Revoke key" onClose={() => setRevoking(null)}>
        <p>Revoking <strong>{revoking?.label}</strong> refuses every request made with it at once. This can't be undone.</p>
        <Refusal form={revokeForm} />
        <div class="form-actions">
          <Button onClick={() => setRevoking(null)}>Cancel</Button>
          <Button variant="danger" disabled={revokeForm.busy} onClick={() => revoking && revoke(revoking)}>Revoke key</Button>
        </div>
      </Dialog>
    </div>
  );
}
