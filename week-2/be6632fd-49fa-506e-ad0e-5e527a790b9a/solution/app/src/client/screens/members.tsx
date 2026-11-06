// Members and the stockist buyer's store (brief: Staff screens → members, my store; Journeys 3 and 7).
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { marketTime, money } from "../../shared/format";
import { api } from "../api";
import { useDraft } from "../drafts";
import { type Member, ROLE_LABEL, type Role, useSession } from "../session";
import type { Allocation, StaffDrop, Stockist } from "../types";
import { Button, Dialog, EmptyRow, Field, Loading, PageTitle, SelectField, StatusMark, StatusRegion, focusLater, refusalMessage, useMessage, wholeOrText } from "../ui";

const ROLE_OPTIONS = Object.entries(ROLE_LABEL) as Array<[Role, string]>;

export function MembersScreen(): JSX.Element {
  const { member: me } = useSession();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [stockists, setStockists] = useState<Stockist[]>([]);
  const [message, setMessage] = useMessage();
  const [dialog, setDialog] = useState<{ kind: "invite" } | { kind: "role" | "remove"; member: Member } | null>(null);
  const [role, setRole] = useState<Role>("merchandiser");
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const opener = useRef<HTMLElement | null>(null);
  const inviteButton = useRef<HTMLButtonElement>(null);
  const draft = useDraft("invite-member", { email: "", role: "merchandiser", stockistId: "" });
  const producer = me?.role === "launch_producer";
  const load = useCallback(async () => {
    const r = await api<{ items: Member[] }>("GET", "/api/members");
    if (r.ok) setMembers(r.data.items);
    else setMessage(refusalMessage(r));
  }, [setMessage]);
  useEffect(() => {
    void load();
    void api<{ items: Stockist[] }>("GET", "/api/stockists?limit=50").then((r) => r.ok && setStockists(r.data.items));
  }, [load]);
  const close = (target?: () => HTMLElement | null): void => {
    setDialog(null);
    setAlert(null);
    setErrors({});
    focusLater(target ?? (() => opener.current));
  };
  const refuse = (r: { message: string; fields: Record<string, string> }): void => {
    setErrors(r.fields);
    setAlert(r.message);
    setAttempt((n) => n + 1);
  };
  const invite = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setMessage("Sending…");
    const body = { email: draft.value.email, role: draft.value.role, stockistId: draft.value.role === "stockist_buyer" ? draft.value.stockistId || null : null };
    const r = await api("POST", "/api/members/invitations", body);
    setPending(false);
    if (r.ok) {
      setMessage(`If ${draft.value.email.trim()} can be invited, an invitation is on its way.`);
      draft.clear();
      close();
      return;
    }
    setMessage(refusalMessage(r));
    refuse(r);
  };
  const saveRole = async (target: Member): Promise<void> => {
    if (pending) return;
    setPending(true);
    setMessage("Saving role…");
    const r = await api<Member>("PATCH", `/api/members/${target.id}`, { role });
    setPending(false);
    if (r.ok) {
      setMessage("Role updated.");
      await load();
      close();
      return;
    }
    setMessage(refusalMessage(r));
    refuse(r);
  };
  const remove = async (target: Member): Promise<void> => {
    if (pending) return;
    setPending(true);
    setMessage("Removing…");
    const r = await api("DELETE", `/api/members/${target.id}`);
    setPending(false);
    if (r.ok) {
      setMessage("Member removed.");
      await load();
      close(() => document.querySelector<HTMLElement>("main h1"));
      return;
    }
    setMessage(refusalMessage(r));
    refuse(r);
  };
  return (
    <div className="screen">
      <div className="screen-head with-action">
        <div>
          <p className="eyebrow">Workspace</p>
          <PageTitle>Members</PageTitle>
        </div>
        {producer ? (
          <Button
            variant="primary"
            buttonRef={inviteButton}
            onClick={() => {
              opener.current = inviteButton.current;
              setDialog({ kind: "invite" });
            }}
          >
            Invite member
          </Button>
        ) : null}
      </div>
      <StatusRegion name="Members status" message={message} />
      <section className="panel">
        {!members ? <Loading /> : null}
        <div className="table-scroll" tabIndex={0}>
          <table aria-label="Members" className="ruled">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Role</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {members?.length === 0 ? <EmptyRow columns={4} /> : null}
              {members?.map((m) => (
                <tr key={m.id}>
                  <th scope="row">{m.name}</th>
                  <td>{m.email}</td>
                  <td>{ROLE_LABEL[m.role]}</td>
                  <td className="row-actions">
                    {producer ? (
                      <>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={(e) => {
                            opener.current = e.currentTarget;
                            setRole(m.role);
                            setDialog({ kind: "role", member: m });
                          }}
                        >
                          Change role
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={(e) => {
                            opener.current = e.currentTarget;
                            setDialog({ kind: "remove", member: m });
                          }}
                        >
                          Remove
                        </button>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {dialog?.kind === "invite" ? (
        <Dialog title="Invite member" alert={alert} alertKey={attempt} onClose={() => (draft.clear(), close())}>
          <form onSubmit={(e) => void invite(e)} noValidate className="stack">
            <Field id="invite-email" label="Email" type="email" value={draft.value.email} onChange={(email) => draft.set((d) => ({ ...d, email }))} error={errors.email} />
            <SelectField id="invite-role" label="Role" value={draft.value.role} onChange={(r) => draft.set((d) => ({ ...d, role: r }))} options={ROLE_OPTIONS} error={errors.role} />
            {draft.value.role === "stockist_buyer" ? (
              <SelectField
                id="invite-stockist"
                label="Stockist"
                value={draft.value.stockistId}
                onChange={(stockistId) => draft.set((d) => ({ ...d, stockistId }))}
                options={[["", "Choose a stockist"], ...stockists.map((s): [string, string] => [s.id, s.name])]}
                error={errors.stockistId}
              />
            ) : null}
            <div className="dialog-actions">
              <Button type="submit" variant="primary" pending={pending} pendingText="Sending…">
                Send invitation
              </Button>
              <Button onClick={() => (draft.clear(), close())}>Cancel</Button>
            </div>
          </form>
        </Dialog>
      ) : null}
      {dialog?.kind === "role" ? (
        <Dialog title="Change role" alert={alert} alertKey={attempt} onClose={() => close()}>
          <p>{`Choose the role for ${dialog.member.name}. It applies from their next request.`}</p>
          <SelectField id="change-role" label="Role" value={role} onChange={(r) => setRole(r as Role)} options={ROLE_OPTIONS} error={errors.role ?? errors.stockistId} />
          <div className="dialog-actions">
            <Button variant="primary" pending={pending} pendingText="Saving role…" onClick={() => void saveRole(dialog.member)}>
              Save role
            </Button>
            <Button onClick={() => close()}>Cancel</Button>
          </div>
        </Dialog>
      ) : null}
      {dialog?.kind === "remove" ? (
        <Dialog title="Remove member" alert={alert} alertKey={attempt} onClose={() => close()}>
          <p>{`${dialog.member.name} loses access to this workspace at their next request.`}</p>
          <div className="dialog-actions">
            <Button variant="danger" pending={pending} pendingText="Removing…" onClick={() => void remove(dialog.member)}>
              Remove member
            </Button>
            <Button onClick={() => close()}>Cancel</Button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

type BuyerDrop = Pick<StaffDrop, "id" | "name" | "status" | "styles">;

export function MyStoreScreen(): JSX.Element {
  const { member } = useSession();
  const [store, setStore] = useState<Stockist | null>(null);
  const [drops, setDrops] = useState<BuyerDrop[]>([]);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [message, setMessage] = useMessage();
  const [open, setOpen] = useState<BuyerDrop | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const opener = useRef<HTMLElement | null>(null);
  const load = useCallback(async () => {
    const [s, d, a] = await Promise.all([
      api<{ items: Stockist[] }>("GET", "/api/stockists"),
      api<{ items: BuyerDrop[] }>("GET", "/api/drops"),
      api<{ items: Allocation[] }>("GET", "/api/allocations"),
    ]);
    if (s.ok) setStore(s.data.items[0] ?? null);
    if (d.ok) setDrops(d.data.items);
    if (a.ok) setAllocations(a.data.items);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (!store) return <Loading />;
  const send = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!open || pending) return;
    setPending(true);
    setMessage("Sending request…");
    const lines = open.styles.map((s) => ({ styleNumber: s.styleNumber, quantity: wholeOrText(quantities[s.styleNumber] ?? "0") }));
    const r = await api("POST", `/api/drops/${open.id}/requests`, { stockistId: member?.stockistId, lines });
    setPending(false);
    if (r.ok) {
      setMessage("Request saved.");
      setOpen(null);
      setQuantities({});
      await load();
      focusLater(() => opener.current);
      return;
    }
    setMessage(refusalMessage(r));
    setAlert(r.status === 422 ? `${r.message} ${Object.values(r.fields).join(" ")}` : r.message);
    setAttempt((n) => n + 1);
  };
  const confirmed = allocations.filter((a) => a.status === "confirmed");
  return (
    <div className="screen">
      <div className="screen-head">
        <p className="eyebrow">
          {store.city} · {store.currency}
        </p>
        <PageTitle>{store.name}</PageTitle>
        <StatusRegion name="Store status" message={message} />
      </div>
      <section className="panel">
        <h2>Open drops</h2>
        <div className="table-scroll" tabIndex={0}>
          <table aria-label="Open drops" className="ruled">
            <thead>
              <tr>
                <th scope="col">Drop</th>
                <th scope="col">Status</th>
                <th scope="col">Styles</th>
                <th scope="col">Request</th>
              </tr>
            </thead>
            <tbody>
              {drops.length === 0 ? <EmptyRow columns={4} /> : null}
              {drops.map((d) => (
                <tr key={d.id}>
                  <th scope="row">{d.name}</th>
                  <td>
                    <StatusMark status={d.status} />
                  </td>
                  <td className="mono">{d.styles.map((s) => s.styleNumber).join(", ")}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={(e) => {
                        opener.current = e.currentTarget;
                        setAlert(null);
                        setOpen(d);
                      }}
                    >
                      Request quantities
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="split-2">
        <section className="panel">
          <h2>My allocations</h2>
          <div className="table-scroll" tabIndex={0}>
            <table aria-label="My allocations" className="ruled">
              <thead>
                <tr>
                  <th scope="col">Drop</th>
                  <th scope="col">Status</th>
                  <th scope="col">Lines</th>
                </tr>
              </thead>
              <tbody>
                {allocations.length === 0 ? <EmptyRow columns={3} /> : null}
                {allocations.map((a) => (
                  <tr key={a.id}>
                    <th scope="row">{a.dropName}</th>
                    <td>{a.status[0].toUpperCase() + a.status.slice(1)}</td>
                    <td className="mono">{a.lines.map((l) => `${l.styleNumber} ${l.requestedQuantity} / ${l.allocatedQuantity}`).join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel">
          <h2>My invoices</h2>
          <div className="table-scroll" tabIndex={0}>
            <table aria-label="My invoices" className="ruled">
              <thead>
                <tr>
                  <th scope="col">Invoice</th>
                  <th scope="col">Drop</th>
                  <th scope="col" className="num">Total</th>
                  <th scope="col">Confirmed</th>
                </tr>
              </thead>
              <tbody>
                {confirmed.length === 0 ? <EmptyRow columns={4} /> : null}
                {confirmed.map((a) => (
                  <tr key={a.id}>
                    <th scope="row" className="mono">
                      <a href={`/api/allocations/${a.id}/line-sheet.csv`} download>
                        {a.invoiceNumber}
                      </a>
                    </th>
                    <td>{a.dropName}</td>
                    <td className="mono num">{a.totalMinor === null ? "—" : money(a.totalMinor, a.currency)}</td>
                    <td className="mono">{a.confirmedAt ? marketTime(Date.parse(a.confirmedAt)) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      {open ? (
        <Dialog
          title="Request quantities"
          alert={alert}
          alertKey={attempt}
          onClose={() => {
            setOpen(null);
            focusLater(() => opener.current);
          }}
        >
          <form onSubmit={(e) => void send(e)} noValidate className="stack">
            <p>{`Pieces of ${open.name} for ${store.name}.`}</p>
            {open.styles.map((s) => (
              <Field
                key={s.styleNumber}
                id={`request-${s.styleNumber}`}
                label={`${s.styleNumber} quantity`}
                type="number"
                hint={`${s.name}, ${s.colour}`}
                value={quantities[s.styleNumber] ?? "0"}
                onChange={(v) => setQuantities((q) => ({ ...q, [s.styleNumber]: v }))}
              />
            ))}
            <div className="dialog-actions">
              <Button type="submit" variant="primary" pending={pending} pendingText="Sending request…">
                Send request
              </Button>
              <Button
                onClick={() => {
                  setOpen(null);
                  focusLater(() => opener.current);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </div>
  );
}
