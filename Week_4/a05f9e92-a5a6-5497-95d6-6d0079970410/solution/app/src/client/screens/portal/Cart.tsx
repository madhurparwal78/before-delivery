import { useRef, useState } from "react";
import type { Value } from "../../../shared/expression.js";
import { ApiFailure, del, failureText, get, post } from "../../lib/api.js";
import { useAnnounce } from "../../lib/announce.js";
import { navigate } from "../../lib/router.js";
import { useSession } from "../../lib/session.js";
import { Button, Page, Rest, useLoad } from "../../lib/ui.js";
import { gate, PortalActions, refreshCart, type CartLine } from "./common.js";
import type { ShownItem } from "./ItemForm.js";

interface Submitted {
  request: { number: string; items: Array<{ number: string }> };
}

/** A fresh key for every submit attempt; the server stores the answer under it. */
function attemptKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function shownValue(item: ShownItem | undefined, name: string, value: Value): string {
  const variable = item?.variables.find((candidate) => candidate.name === name);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const choice = variable?.choices.find((candidate) => candidate.value === String(value));
  return choice ? choice.label : String(value);
}

export function Cart(): JSX.Element {
  const session = useSession();
  const announce = useAnnounce();
  const username = session.user?.username ?? "";
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const { state, reload } = useLoad(async () => {
    const [lines, { items }] = await Promise.all([refreshCart(username), get<{ items: ShownItem[] }>("/api/catalog/items")]);
    return { lines, items };
  }, [username, session.accessVersion]);
  if (state.status !== "ready") return gate(state, "Cart", reload);
  const { lines, items } = state.data;
  const nameOf = (id: string): string => items.find((item) => item.id === id)?.name ?? id;

  const remove = (line: CartLine): void => {
    setMessage(null);
    del(`/api/cart/lines/${line.id}`).then(
      async () => {
        await refreshCart(username);
        reload();
        heading.current?.focus();
      },
      (error: unknown) => setMessage(failureText(error)),
    );
  };

  const submit = (): void => {
    setBusy(true);
    setMessage(null);
    post<Submitted>("/api/cart/checkout", { requested_for: null }, { "Idempotency-Key": attemptKey() }).then(
      async ({ request }) => {
        await refreshCart(username);
        announce(`Request ${request.number} submitted with ${request.items.length} items.`);
        navigate(`/portal/requests/${request.number}`);
      },
      (error: unknown) => {
        setBusy(false);
        const fields = error instanceof ApiFailure ? Object.keys(error.fields ?? {}).length : 0;
        const text = fields > 0 ? `${fields} problems to fix before saving.` : failureText(error);
        setMessage(text);
        announce(text);
      },
    );
  };

  return (
    <Page subject="Cart">
      <PortalActions />
      <Rest narrow className="portal-column">
        <h2 ref={heading} tabIndex={-1}>
          Your cart
        </h2>
        {lines.length === 0 ? (
          message ? null : <p className="muted">Your cart is empty.</p>
        ) : (
          <ul className="cart-lines">
            {lines.map((line) => {
              const item = items.find((candidate) => candidate.id === line.item);
              return (
                <li key={line.id} className="cart-line">
                  <div className="cart-line-body">
                    <h3>{nameOf(line.item)}</h3>
                    <dl className="cart-values">
                      {Object.entries(line.variables).map(([name, value]) => (
                        <div key={name}>
                          <dt>{item?.variables.find((variable) => variable.name === name)?.label ?? name}</dt>
                          <dd>{shownValue(item, name, value)}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                  <Button variant="outline" onClick={() => remove(line)} aria-label={`Remove ${nameOf(line.item)}`}>
                    Remove
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {message ? <p className="form-error">{message}</p> : null}
        <div className="row">
          <Button onClick={submit} busy={busy} disabled={busy}>
            {busy ? "Submitting..." : "Submit request"}
          </Button>
        </div>
      </Rest>
    </Page>
  );
}
