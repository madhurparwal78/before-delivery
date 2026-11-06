// Share links: the mint dialog and the Share links page (brief: Interactions, Sharing; Feedback states, Share link).
import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { formatTime, shortVersion } from "../shared/format";
import { ApiError, type Bucket, type ObjectMeta, type ShareLink, api, query } from "./api";
import type { Scope } from "./console";
import { Dialog, Field } from "./dialog";
import { Icon } from "./icons";

const EXPIRIES = [
  ["1 hour", 3600],
  ["24 hours", 86_400],
  ["7 days", 604_800],
] as const;

// Copies `text`; when the async clipboard is refused, selects the field and uses the copy command instead.
export async function copyText(text: string, field: HTMLInputElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    field?.select();
    return document.execCommand("copy");
  }
}

interface ShareDialogProps {
  scope: Scope;
  bucket: Bucket;
  meta: ObjectMeta;
  onClose: () => void;
}

export function ShareDialog({ scope, bucket, meta, onClose }: ShareDialogProps): JSX.Element {
  const [choice, setChoice] = useState("3600");
  const [seconds, setSeconds] = useState("");
  const [link, setLink] = useState<ShareLink | null>(null);
  const [pending, setPending] = useState(false);
  const urlField = useRef<HTMLInputElement>(null);
  const status = scope.setShareStatus;

  const create = async (event: Event): Promise<void> => {
    event.preventDefault();
    setPending(true);
    status("Creating link…");
    const expires = choice === "custom" ? Number(seconds) : Number(choice);
    try {
      const created = await api<ShareLink>(
        "POST",
        `/api/w/${scope.ws}/buckets/${bucket.name}/object/links${query({ key: meta.key, version: meta.version_id })}`,
        { expires_in_seconds: expires },
      );
      setLink(created);
      status(`Link ready. It expires ${formatTime(created.expires_at)}.`);
    } catch (error) {
      status(
        error instanceof ApiError && error.code === "validation_failed"
          ? "Pick an expiry between one second and seven days."
          : scope.report(error),
      );
    }
    setPending(false);
  };

  const copy = async (): Promise<void> => {
    if (link?.url && (await copyText(link.url, urlField.current))) status("Link copied.");
  };

  return (
    <Dialog title="Share link" onClose={onClose}>
      <form class="form" onSubmit={create}>
        <p class="dialog__lead">
          One link to <span class="mono">{meta.key}</span>, version <span class="mono">{shortVersion(meta.version_id)}</span>.
        </p>
        <Field label="Expires in">
          {(described, id) => (
            <select id={id} value={choice} aria-describedby={described} onChange={(e) => setChoice(e.currentTarget.value)}>
              {EXPIRIES.map(([label, value]) => (
                <option key={value} value={String(value)}>
                  {label}
                </option>
              ))}
              <option value="custom">Custom</option>
            </select>
          )}
        </Field>
        {choice === "custom" && (
          <Field label="Seconds" hint="From 1 to 604,800 (seven days).">
            {(described, id) => (
              <input id={id} type="number" inputMode="numeric" class="mono-input" value={seconds} aria-describedby={described}
                onInput={(e) => setSeconds(e.currentTarget.value)} />
            )}
          </Field>
        )}
        <div class="form__actions">
          <button type="submit" class="button button--primary" disabled={pending}>
            <Icon name="link" />
            Create link
          </button>
        </div>
      </form>
      {link?.url && (
        <div class="secret">
          <Field label="Link URL">
            {(described, id) => (
              <input ref={urlField} id={id} class="mono-input" readOnly value={link.url} aria-describedby={described} />
            )}
          </Field>
          <button type="button" class="button" onClick={() => void copy()}>
            <Icon name="copy" />
            Copy link
          </button>
        </div>
      )}
    </Dialog>
  );
}

export function SharedLinks({ scope }: { scope: Scope }): JSX.Element {
  const [links, setLinks] = useState<ShareLink[] | null>(null);
  useEffect(() => {
    api<{ links: ShareLink[] }>("GET", `/api/w/${scope.ws}/links`).then((r) => setLinks(r.links), (e: unknown) => scope.setShareStatus(scope.report(e)));
  }, [scope.ws]);

  const mayRevoke = (link: ShareLink): boolean =>
    link.state === "active" && (scope.role !== "viewer" || link.created_by === scope.me.user.name);

  const revoke = async (link: ShareLink): Promise<void> => {
    try {
      const revoked = await api<ShareLink>("POST", `/api/w/${scope.ws}/links/${link.id}/revoke`);
      setLinks((all) => all && all.map((l) => (l.id === link.id ? { ...l, state: revoked.state } : l)));
      scope.setShareStatus("Link revoked. It stops working on the next request.");
    } catch (error) {
      scope.setShareStatus(scope.report(error));
    }
  };

  return (
    <section class="page" aria-labelledby="links-title">
      <h1 id="links-title" class="page__title">
        Share links
      </h1>
      <div class="table-frame">
        <table class="table table--cards" aria-label="Share links">
          <thead>
            <tr>
              <th scope="col">Object key</th>
              <th scope="col">Version</th>
              <th scope="col">Creator</th>
              <th scope="col">Expires (UTC)</th>
              <th scope="col">State</th>
              <th scope="col" class="cell--actions">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {(links ?? []).map((link) => (
              <tr key={link.id}>
                <td data-label="Object key" class="cell--key">
                  <span class="mono">{link.key}</span>
                  <span class="cell__sub">{link.bucket}</span>
                </td>
                <td data-label="Version" class="mono">{shortVersion(link.version_id)}</td>
                <td data-label="Creator">{link.created_by}</td>
                <td data-label="Expires (UTC)" class="mono">{formatTime(link.expires_at)}</td>
                <td data-label="State">
                  <span class={`state state--${link.state}`}>{link.state}</span>
                </td>
                <td class="cell--actions">
                  {mayRevoke(link) && (
                    <button type="button" class="button button--small" onClick={() => void revoke(link)}>
                      Revoke link
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {links?.length === 0 && <p class="empty">No share links yet.</p>}
    </section>
  );
}
