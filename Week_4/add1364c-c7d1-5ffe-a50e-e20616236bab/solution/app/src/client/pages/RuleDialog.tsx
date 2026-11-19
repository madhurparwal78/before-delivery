import { useState, type FormEvent } from "react";
import { ApiError, patch, post } from "../lib/api";
import { useStore } from "../lib/store";
import type { Rule, Vault } from "../lib/types";
import { Dialog } from "../ui/Dialog";
import { Field, SubmitButton, useFieldErrors, useOnce } from "../ui/Field";

export function vaultDisplay(vault: { name: string; formerly: string | null }): string {
  return vault.formerly ? `${vault.name} (formerly ${vault.formerly})` : vault.name;
}

interface Props {
  vaults: Vault[];
  defaultVaultId: string;
  rule?: Rule;
  onClose: () => void;
  onSaved: () => void;
  onChanged: () => void;
}

const FIELD_MAP: Record<string, string> = { vault_id: "vault", min_length: "min", effective_on: "date", version: "min" };

export function RuleDialog({ vaults, defaultVaultId, rule, onClose, onSaved, onChanged }: Props) {
  const { say, warn } = useStore();
  const [vaultId, setVaultId] = useState(rule?.vault_id ?? defaultVaultId);
  const [min, setMin] = useState(rule ? String(rule.min_length) : "");
  const [date, setDate] = useState(rule?.effective_on ?? "");
  const { errors, setErrors, formRef } = useFieldErrors();
  const { pending, run } = useOnce();
  const editing = rule !== undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      try {
        const length = min.trim() === "" ? min : Number(min);
        if (rule) await patch(`/api/rules/${rule.id}`, { version: rule.version, min_length: length, effective_on: date });
        else await post("/api/rules", { vault_id: vaultId, min_length: length, effective_on: date });
        say("Rule saved as a draft.");
        onSaved();
        onClose();
      } catch (error) {
        if (!(error instanceof ApiError)) return;
        if (error.code === "rule_changed") { warn(error.message); onChanged(); return; }
        warn("Check the highlighted fields.");
        const next: Record<string, string> = {};
        for (const [key, message] of Object.entries(error.fields)) next[FIELD_MAP[key] ?? key] = message;
        setErrors(next);
      }
    });
  };

  return (
    <Dialog label={editing ? "Edit rule" : "New rule"} onClose={onClose} onSubmit={submit} formRef={formRef}>
      <Field label="Vault" error={errors.vault}>
        {(p) => (
          <select {...p} value={vaultId} disabled={editing} onChange={(e) => setVaultId(e.target.value)}>
            {vaults.map((v) => <option key={v.id} value={v.id}>{vaultDisplay(v)}</option>)}
          </select>
        )}
      </Field>
      <Field label="Minimum length" error={errors.min}>
        {(p) => <input {...p} type="number" inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value)} />}
      </Field>
      <Field label="Takes force on" error={errors.date}>
        {(p) => <input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
      </Field>
      <div className="dialog-actions">
        <SubmitButton pending={pending} pendingText="Saving">{editing ? "Save rule" : "Save draft"}</SubmitButton>
        <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
      </div>
    </Dialog>
  );
}
