import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Kit, OutboxItem, ReadToken } from "../../shared/types";
import { api, ApiError } from "../lib/api";
import { notify } from "../lib/notices";
import { useShell } from "../lib/session";
import { Page, SelectField, TextField, onSubmit } from "../ui";

export function Profile(): ReactNode {
  const { session } = useShell();
  return (
    <Page className="profile">
      {session.isOwner ? (
        <OwnerProfile />
      ) : (
        <section aria-label="Your account">
          <p>{session.person.name}</p>
          <p className="muted">{session.person.email}</p>
        </section>
      )}
    </Page>
  );
}

function OwnerProfile(): ReactNode {
  return (
    <>
      <Availability />
      <Tokens />
      <Kits />
      <Outbox />
    </>
  );
}

function Availability(): ReactNode {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | undefined>();
  useEffect(() => {
    void api.get<{ availability: string }>("/api/profile").then((profile) => setText(profile.availability));
  }, []);
  const save = async (): Promise<void> => {
    try {
      await api.put("/api/profile", { availability: text });
      setError(undefined);
      notify("Availability saved.");
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      setError(failure.fields["availability"] ?? failure.message);
      notify(failure.message);
    }
  };
  return (
    <section aria-label="Availability">
      <p className="section-title">Availability</p>
      <form onSubmit={onSubmit(() => void save())}>
        <TextField label="Availability" name="availability" value={text} onChange={setText} error={error} />
        <button type="submit">Save availability</button>
      </form>
    </section>
  );
}

function Tokens(): ReactNode {
  const { socket } = useShell();
  const [tokens, setTokens] = useState<ReadToken[]>([]);
  const [windows, setWindows] = useState<Record<string, number>>({});
  const timers = useRef(new Map<string, number>());
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();

  /** Shows a window count, and resets it to 0 once that window has passed. */
  const hold = useCallback((id: string, count: number, endsInMs: number): void => {
    setWindows((current) => ({ ...current, [id]: count }));
    window.clearTimeout(timers.current.get(id));
    timers.current.set(id, window.setTimeout(() => setWindows((current) => ({ ...current, [id]: 0 })), endsInMs));
  }, []);

  const load = useCallback(async (): Promise<void> => {
    const { items } = await api.get<{ items: ReadToken[] }>("/api/tokens");
    setTokens(items);
    for (const item of items) hold(item.id, item.window_requests, item.window_ends_in_ms);
  }, [hold]);

  useEffect(() => {
    void load();
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, [load]);

  useEffect(
    () =>
      socket.onMessage((message) => {
        if (message.type === "token_window") hold(message.token_id, message.count, message.window_ends_in_ms);
      }),
    [socket, hold],
  );

  const create = async (): Promise<void> => {
    notify("Making token…");
    try {
      const made = await api.post<{ token: string }>("/api/tokens", { name });
      setFresh(made.token);
      setName("");
      setError(undefined);
      notify("Copy this token now; it will not be shown again.");
      await load();
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      setError(failure.fields["name"] ?? failure.message);
      notify(failure.message);
    }
  };

  const revoke = async (token: ReadToken): Promise<void> => {
    await api.del(`/api/tokens/${token.id}`);
    notify(`${token.name} revoked.`);
    await load();
  };

  return (
    <section role="region" aria-label="Read tokens">
      <p className="section-title">Read tokens</p>
      <p className="muted">
        API base path <code className="mono">/api/v1</code>
      </p>
      <form onSubmit={onSubmit(() => void create())}>
        <TextField label="Token name" name="name" value={name} onChange={setName} error={error} />
        <button type="submit">New read token</button>
      </form>
      {fresh ? (
        <p>
          <code className="mono" data-fresh-token="">
            {fresh}
          </code>{" "}
          <button type="button" onClick={() => void navigator.clipboard.writeText(fresh)}>
            Copy token
          </button>
        </p>
      ) : null}
      {tokens.length === 0 ? <p className="empty">No read tokens yet.</p> : null}
      <ul className="plain-list">
        {tokens.map((token) => {
          const shown = windows[token.id] ?? 0;
          return (
            <li key={token.id}>
              <span>{token.name}</span> <span className="muted">requests in this window </span>
              <span data-token-window={shown} className="tnum">
                {shown}
              </span>{" "}
              <button type="button" aria-label={`Revoke ${token.name}`} onClick={() => void revoke(token)}>
                Revoke
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const WEIGHTS = [
  { value: "400", label: "400" },
  { value: "600", label: "600" },
];

function Kits(): ReactNode {
  const [kits, setKits] = useState<Kit[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [textColour, setTextColour] = useState("ffffff");
  const [boxColour, setBoxColour] = useState("000000");
  const [weight, setWeight] = useState("600");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = async (): Promise<void> => setKits((await api.get<{ items: Kit[] }>("/api/kits")).items);
  useEffect(() => {
    void load();
  }, []);

  const save = async (): Promise<void> => {
    const body = { name, text_colour: textColour, box_colour: boxColour, font_weight: Number(weight) };
    try {
      if (editing) await api.put(`/api/kits/${editing}`, body);
      else await api.post("/api/kits", body);
      setErrors({});
      setEditing(null);
      setName("");
      notify(`${name} saved.`);
      await load();
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      setErrors(failure.fields);
      notify(failure.message);
    }
  };

  return (
    <section role="region" aria-label="Brand kits">
      <p className="section-title">Brand kits</p>
      <form onSubmit={onSubmit(() => void save())}>
        <TextField label="Kit name" name="name" value={name} onChange={setName} error={errors["name"]} />
        <TextField label="Text colour" name="text_colour" value={textColour} onChange={setTextColour} error={errors["text_colour"]} />
        <TextField label="Box colour" name="box_colour" value={boxColour} onChange={setBoxColour} error={errors["box_colour"]} />
        <SelectField label="Weight" name="font_weight" value={weight} onChange={setWeight} options={WEIGHTS} error={errors["font_weight"]} />
        <button type="submit">Save kit</button>
      </form>
      <ul className="plain-list">
        {kits.map((kit) => (
          <li key={kit.id}>
            <span>{kit.name}</span> <span className="muted tnum">{kit.text_colour} on {kit.box_colour}, {kit.font_weight}</span>{" "}
            <button
              type="button"
              aria-label={`Edit ${kit.name}`}
              onClick={() => {
                setEditing(kit.id);
                setName(kit.name);
                setTextColour(kit.text_colour);
                setBoxColour(kit.box_colour);
                setWeight(String(kit.font_weight));
              }}
            >
              Edit
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Outbox(): ReactNode {
  const [items, setItems] = useState<OutboxItem[] | null>(null);
  useEffect(() => {
    void api.get<{ items: OutboxItem[] }>("/api/outbox").then((result) => setItems(result.items));
  }, []);
  return (
    <section role="region" aria-label="Outbox">
      <p className="section-title">Outbox</p>
      {items && items.length === 0 ? <p className="empty">The outbox is empty.</p> : null}
      <ul className="plain-list table">
        {(items ?? []).map((item) => (
          <li key={item.id}>
            <span>{item.subject}</span> <span className="muted">{item.to}</span> <span className="tnum">{item.state}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
