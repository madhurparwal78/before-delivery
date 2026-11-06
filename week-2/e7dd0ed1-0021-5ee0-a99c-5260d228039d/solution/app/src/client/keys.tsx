// Access keys page (brief: Screens and layout, Access keys page; Feedback states, Access keys).
import type { JSX } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { formatTime } from "../shared/format";
import { ApiError, type AccessKey, type Bucket, api } from "./api";
import type { Scope } from "./console";
import { ILLEGAL_TRANSITION } from "./copy";
import { Dialog, Field, Status } from "./dialog";
import { Icon } from "./icons";
import { copyText } from "./share";

// `null` means every bucket in the workspace, now and later.
export function BucketScopeField({ buckets, value, onChange, error }: {
  buckets: Bucket[];
  value: string[] | null;
  onChange: (next: string[] | null) => void;
  error?: string;
}): JSX.Element {
  return (
    <fieldset class="choices">
      <legend>Buckets</legend>
      <label class="choice">
        <input type="checkbox" checked={value === null} onChange={(e) => onChange(e.currentTarget.checked ? null : [])} />
        <span>All buckets</span>
      </label>
      {buckets.map((b) => (
        <label key={b.name} class="choice">
          <input type="checkbox" disabled={value === null} checked={value === null || value.includes(b.name)}
            onChange={(e) => value && onChange(e.currentTarget.checked ? [...value, b.name] : value.filter((n) => n !== b.name))} />
          <span class="mono">{b.name}</span>
        </label>
      ))}
      {error && (
        <p class="field__error">
          <Icon name="circle-x" />
          {error}
        </p>
      )}
    </fieldset>
  );
}

const KEYS_REREAD_MS = 15_000;
const FIELD_ERROR = "Key not created. Fix the highlighted fields.";

const keyState = (key: AccessKey): string => (key.state === "disabled" ? "disabled" : key.expired ? "expired" : "active");

// `YYYY-MM-DD HH:MM:SS` typed in UTC, as the API's ISO form; empty means never.
function typedUtc(value: string): string | null | undefined {
  const text = value.trim();
  if (!text) return null;
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(" ", "T")}Z` : undefined;
}

export function AccessKeys({ scope }: { scope: Scope }): JSX.Element {
  const [keys, setKeys] = useState<AccessKey[]>([]);
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const [rotating, setRotating] = useState<AccessKey | null>(null);
  const path = `/api/w/${scope.ws}/keys`;

  const load = async (): Promise<void> => setKeys((await api<{ keys: AccessKey[] }>("GET", path)).keys);
  // The list re-reads every 15 seconds; rows update in place, so dialogs, input and focus stay put.
  useEffect(() => {
    load().catch((e: unknown) => setStatus(scope.report(e)));
    const timer = setInterval(() => void load().catch(() => undefined), KEYS_REREAD_MS);
    return () => clearInterval(timer);
  }, [scope.ws]);

  const transitionCopy = (error: unknown, deleting: boolean): string =>
    error instanceof ApiError && error.code === "invalid_transition"
      ? deleting && error.body.from === "active" ? "Disable the key before deleting it." : ILLEGAL_TRANSITION
      : scope.report(error);

  const disable = async (key: AccessKey): Promise<void> => {
    try {
      const updated = await api<AccessKey>("POST", `${path}/${key.key_id}/disable`);
      setKeys((all) => all.map((k) => (k.key_id === key.key_id ? updated : k)));
      setStatus(`Key ${key.key_id} disabled. Requests signed with it fail from now on.`);
    } catch (error) {
      setStatus(transitionCopy(error, false));
    }
  };

  const remove = async (key: AccessKey): Promise<void> => {
    try {
      await api("DELETE", `${path}/${key.key_id}`);
      setKeys((all) => all.filter((k) => k.key_id !== key.key_id));
      setStatus(`Key ${key.key_id} deleted.`);
    } catch (error) {
      setStatus(transitionCopy(error, true));
    }
  };

  return (
    <section class="page" aria-labelledby="keys-title">
      <div class="page__head">
        <h1 id="keys-title" class="page__title">
          Access keys
        </h1>
        <button type="button" class="button button--primary" onClick={() => setCreating(true)}>
          <Icon name="plus" />
          Create access key
        </button>
      </div>
      <Status label="Key status" text={status} />
      <div class="table-frame">
        <table class="table table--cards" aria-label="Access keys">
          <thead>
            <tr>
              <th scope="col">Key ID</th>
              <th scope="col">Description</th>
              <th scope="col">Permission</th>
              <th scope="col">Buckets</th>
              <th scope="col">Prefix</th>
              <th scope="col">Expires (UTC)</th>
              <th scope="col">State</th>
              <th scope="col">Last used (UTC)</th>
              <th scope="col">Previous secret</th>
              <th scope="col">Created (UTC)</th>
              <th scope="col" class="cell--actions">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => {
              const bucketScope = key.buckets === null ? "All buckets" : key.buckets.join(", ");
              const state = keyState(key);
              return (
                <tr key={key.key_id}>
                  <td data-label="Key ID" class="mono cell--nowrap">{key.key_id}</td>
                  <td data-label="Description" class="cell--truncate" title={key.description}>{key.description}</td>
                  <td data-label="Permission" class="cell--nowrap">{key.permission === "read" ? "Read only" : "Read and write"}</td>
                  <td data-label="Buckets" class="cell--truncate" title={bucketScope}>{bucketScope}</td>
                  <td data-label="Prefix" class="mono cell--truncate" title={key.prefix ?? undefined}>{key.prefix ?? "—"}</td>
                  <td data-label="Expires (UTC)" class="mono cell--nowrap">{key.expires_at ? formatTime(key.expires_at) : "never"}</td>
                  <td data-label="State">
                    <span class={`state state--${state}`}>{state}</span>
                  </td>
                  <td data-label="Last used (UTC)" class="mono cell--nowrap">{key.last_used_at ? formatTime(key.last_used_at) : "never"}</td>
                  <td data-label="Previous secret" class="cell--nowrap">
                    {key.previous_secret_expires_at ? (
                      <>Previous secret works until <span class="mono">{formatTime(key.previous_secret_expires_at)}</span></>
                    ) : "—"}
                  </td>
                  <td data-label="Created (UTC)" class="mono cell--nowrap">{formatTime(key.created_at)}</td>
                  <td class="cell--actions">
                    {state === "active" && (
                      <button type="button" class="button button--small" onClick={() => setRotating(key)}>
                        Rotate key
                      </button>
                    )}
                    {key.state === "active" && (
                      <button type="button" class="button button--small" onClick={() => void disable(key)}>
                        Disable key
                      </button>
                    )}
                    {key.state === "disabled" && (
                      <button type="button" class="button button--small" onClick={() => void remove(key)}>
                        Delete key
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {keys.length === 0 && <p class="empty">No access keys yet.</p>}
      {creating && (
        <CreateKeyDialog scope={scope} path={path} onStatus={setStatus} onCreated={() => void load()} onClose={() => setCreating(false)} />
      )}
      {rotating && (
        <RotateKeyDialog scope={scope} path={path} accessKey={rotating} onStatus={setStatus}
          onRotated={(updated) => setKeys((all) => all.map((k) => (k.key_id === updated.key_id ? { ...updated, secret: undefined } : k)))}
          onClose={() => setRotating(null)} />
      )}
    </section>
  );
}

function SecretField({ label, secret }: { label: string; secret: string }): JSX.Element {
  const field = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => field.current?.focus(), []);
  return (
    <>
      <Field label={label} hint="Shown once. Farshore stores only a sealed copy.">
        {(described, id) => <input ref={field} id={id} class="mono-input" readOnly value={secret} aria-describedby={described} />}
      </Field>
      <div class="form__actions form__actions--start">
        <button type="button" class="button" onClick={() => void copyText(secret, field.current)}>
          <Icon name="copy" />
          Copy secret
        </button>
      </div>
    </>
  );
}

interface RotateKeyDialogProps {
  scope: Scope;
  path: string;
  accessKey: AccessKey;
  onStatus: (text: string) => void;
  onRotated: (key: AccessKey) => void;
  onClose: () => void;
}

// Closing the dialog clears the new secret from the page for good.
function RotateKeyDialog({ scope, path, accessKey, onStatus, onRotated, onClose }: RotateKeyDialogProps): JSX.Element {
  const [secret, setSecret] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const rotate = async (): Promise<void> => {
    setPending(true);
    onStatus("Rotating key…");
    try {
      const rotated = await api<AccessKey>("POST", `${path}/${accessKey.key_id}/rotate`);
      setSecret(rotated.secret ?? "");
      onRotated(rotated);
      onStatus(`Key ${rotated.key_id} rotated. The previous secret works until ${formatTime(rotated.previous_secret_expires_at ?? "")}.`);
    } catch (error) {
      setPending(false);
      if (error instanceof ApiError && error.code === "rotation_in_progress") {
        onStatus("This key's previous secret is still live. Rotate again after the overlap ends.");
      } else if (error instanceof ApiError && error.code === "invalid_transition") onStatus(ILLEGAL_TRANSITION);
      else onStatus(scope.report(error));
    }
  };

  return (
    <Dialog title="Rotate access key" onClose={onClose}>
      {secret === null ? (
        <>
          <p class="dialog__text">
            Rotate <span class="mono">{accessKey.key_id}</span>? The previous secret keeps working until the overlap ends.
          </p>
          <div class="form__actions">
            <button type="button" class="button" onClick={onClose}>
              Cancel
            </button>
            <button type="button" class="button button--primary" disabled={pending} onClick={() => void rotate()}>
              Rotate
            </button>
          </div>
        </>
      ) : (
        <div class="secret">
          <SecretField label="New secret access key" secret={secret} />
          <div class="form__actions">
            <button type="button" class="button button--primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

interface CreateKeyDialogProps {
  scope: Scope;
  path: string;
  onStatus: (text: string) => void;
  onCreated: () => void;
  onClose: () => void;
}

function CreateKeyDialog({ scope, path, onStatus, onCreated, onClose }: CreateKeyDialogProps): JSX.Element {
  const [description, setDescription] = useState("");
  const [permission, setPermission] = useState<"read" | "read-write">("read");
  const [buckets, setBuckets] = useState<string[] | null>(null);
  const [prefix, setPrefix] = useState("");
  const [expires, setExpires] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [secret, setSecret] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const create = async (event: Event): Promise<void> => {
    event.preventDefault();
    const expiresAt = typedUtc(expires);
    if (expiresAt === undefined) {
      setErrors({ expires_at: "Pick a time after now and within 365 days." });
      onStatus(FIELD_ERROR);
      return;
    }
    setPending(true);
    setErrors({});
    onStatus("Creating key…");
    try {
      const created = await api<AccessKey>("POST", path, { description, permission, buckets, prefix: prefix || null, expires_at: expiresAt });
      setSecret(created.secret ?? "");
      onStatus(`Key ${created.key_id} created. Copy the secret now; Farshore won't show it again.`);
      onCreated();
    } catch (error) {
      setPending(false);
      if (error instanceof ApiError && error.code === "validation_failed") {
        setErrors(error.body.errors ?? {});
        onStatus(FIELD_ERROR);
      } else {
        onStatus(scope.report(error));
      }
    }
  };

  return (
    <Dialog title="Create access key" onClose={onClose}>
      {secret === null ? (
        <form class="form" onSubmit={create}>
          <Field label="Description" error={errors["description"]}>
            {(described, id) => (
              <input id={id} value={description} aria-describedby={described} aria-invalid={errors["description"] ? true : undefined}
                onInput={(e) => setDescription(e.currentTarget.value)} />
            )}
          </Field>
          <fieldset class="choices" role="radiogroup" aria-label="Permission">
            <legend aria-hidden="true">Permission</legend>
            <label class="choice">
              <input type="radio" name="permission" checked={permission === "read"} onChange={() => setPermission("read")} />
              <span>Read only</span>
            </label>
            <label class="choice">
              <input type="radio" name="permission" checked={permission === "read-write"} onChange={() => setPermission("read-write")} />
              <span>Read and write</span>
            </label>
          </fieldset>
          <BucketScopeField buckets={scope.buckets} value={buckets} onChange={setBuckets} error={errors["buckets"]} />
          <Field label="Object prefix" hint="Empty means the key can name any object key." error={errors["prefix"]}>
            {(described, id) => (
              <input id={id} class="mono-input" value={prefix} spellcheck={false} aria-describedby={described}
                aria-invalid={errors["prefix"] ? true : undefined} onInput={(e) => setPrefix(e.currentTarget.value)} />
            )}
          </Field>
          <Field label="Expires at (UTC)" hint="YYYY-MM-DD HH:MM:SS. Empty means never." error={errors["expires_at"]}>
            {(described, id) => (
              <input id={id} class="mono-input" value={expires} placeholder="YYYY-MM-DD HH:MM:SS" spellcheck={false} aria-describedby={described}
                aria-invalid={errors["expires_at"] ? true : undefined} onInput={(e) => setExpires(e.currentTarget.value)} />
            )}
          </Field>
          <div class="form__actions">
            <button type="button" class="button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" class="button button--primary" disabled={pending}>
              Create key
            </button>
          </div>
        </form>
      ) : (
        <div class="secret">
          <SecretField label="Secret access key" secret={secret} />
          <div class="form__actions">
            <button type="button" class="button button--primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
