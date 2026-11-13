// Holds, booked appointments, consignors, the ladder and members.
import { useState } from "react";
import type { Appointment, Consignor, Hold, Ladder, Member, Payout, Piece } from "../../shared/api";
import { CONSIGNOR_STATUSES, labelOf, PIECE_STATUSES, ROLES, type Role } from "../../shared/catalog";
import { formatDate, formatDateTime, formatIban, formatMoney } from "../../shared/format";
import { api } from "../api";
import { useAction, useDialog, useFields, usePoll, type DialogControl, type Poll } from "../hooks";
import { announce, focusHeading } from "../state";
import { MainAction } from "../ui/bars";
import { Dialog } from "../ui/Dialog";
import { Button, DialogForm, Email, Empty, Heading, Link, NotFound, Problems, RadioGroup, SelectField, Skeleton, TableFrame, TextField } from "../ui/kit";

function openerRef(control: DialogControl) {
  return (element: HTMLButtonElement | null): void => {
    control.opener.current = element;
  };
}

function RowButton({ label, selected, onSelect }: { label: string; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" className="row-button" aria-pressed={selected} aria-label={label} onClick={onSelect}>
      Show
    </button>
  );
}

export function HoldsScreen() {
  const poll = usePoll(() => api<{ holds: Hold[] }>("/api/holds"), "holds");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const holds = poll.data?.holds ?? null;
  const selected = holds?.find((hold) => hold.id === selectedId) ?? holds?.[0];
  return (
    <main className="page">
      <div className="screen-head">
        <Heading>Holds</Heading>
        <MainAction>
          <Link to="/staff/till" className="button primary">
            Till
          </Link>
        </MainAction>
      </div>
      <div className="split">
        <div className="split-main">
          {holds === null ? (
            <Skeleton />
          ) : (
            <TableFrame name="Holds">
              <thead>
                <tr>
                  <th scope="col">Tag code</th>
                  <th scope="col">Shopper</th>
                  <th scope="col">Held until</th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {holds.map((hold) => (
                  <tr key={hold.id} className={hold.id === selected?.id ? "selected" : undefined}>
                    <td className="num">
                      <Link to={`/staff/holds/${hold.id}`}>{hold.tagCode}</Link>
                    </td>
                    <td>{hold.shopperName}</td>
                    <td className="num">{formatDateTime(hold.endsAt)}</td>
                    <td>
                      <RowButton label={`Show ${hold.tagCode}`} selected={hold.id === selected?.id} onSelect={() => setSelectedId(hold.id)} />
                    </td>
                  </tr>
                ))}
                {holds.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">
                      No piece is on hold right now.
                    </td>
                  </tr>
                )}
              </tbody>
            </TableFrame>
          )}
        </div>
        <aside className="detail" aria-label="Selected hold">
          {selected ? (
            <>
              <h2 className="num">{selected.tagCode}</h2>
              <p>{selected.shopperName}</p>
              <p className="muted">{selected.shopperEmail}</p>
              <p className="num">Held until {formatDateTime(selected.endsAt)}</p>
              <Link to={`/staff/holds/${selected.id}`}>Open this hold</Link>
            </>
          ) : (
            <Empty title="No holds are active." />
          )}
        </aside>
      </div>
    </main>
  );
}

function ReleaseForm({ hold, control, poll }: { hold: Hold; control: DialogControl; poll: Poll<{ hold: Hold }> }) {
  const action = useAction();
  const submit = async (): Promise<void> => {
    await api(`/api/holds/${hold.id}/release`, { method: "POST" });
    await poll.refresh();
    announce("Hold released.");
    control.close({ returnFocus: false });
    focusHeading();
  };
  return (
    <DialogForm action={action} submit="Release hold" cancel="Keep hold" onSubmit={submit} onCancel={() => control.close()}>
      <p>{hold.tagCode} goes back on the rail at once.</p>
    </DialogForm>
  );
}

const HOLD_STATUS: Record<Hold["status"], string> = { active: "Active", released: "Released", ended: "Ended" };

export function HoldScreen({ id }: { id: string }) {
  const poll = usePoll(() => api<{ hold: Hold }>(`/api/holds/${id}`), id);
  const release = useDialog("Release hold");
  const hold = poll.data?.hold;
  if (poll.failure) return <NotFound />;
  return (
    <main className="page narrow">
      {hold ? (
        <>
          <div className="screen-head">
            <Heading className="num">{`Hold ${hold.tagCode}`}</Heading>
            <MainAction>
              <button ref={openerRef(release)} type="button" className="button primary" disabled={hold.status !== "active"} onClick={release.open}>
                Release
              </button>
            </MainAction>
          </div>
          <dl className="facts wide">
            <div>
              <dt>Status</dt>
              <dd>{HOLD_STATUS[hold.status]}</dd>
            </div>
            <div>
              <dt>Shopper</dt>
              <dd>{hold.shopperName}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{hold.shopperEmail}</dd>
            </div>
            <div>
              <dt>Held from</dt>
              <dd className="num">{formatDateTime(hold.startsAt)}</dd>
            </div>
            <div>
              <dt>Held until</dt>
              <dd className="num">{formatDateTime(hold.endsAt)}</dd>
            </div>
          </dl>
          <p>
            <Link to={`/staff/pieces/${hold.pieceId}`}>Open the piece</Link>
          </p>
          <Dialog control={release}>
            <ReleaseForm hold={hold} control={release} poll={poll} />
          </Dialog>
        </>
      ) : (
        <Skeleton />
      )}
    </main>
  );
}

export function AppointmentsScreen() {
  const poll = usePoll(() => api<{ appointments: Appointment[] }>("/api/appointments"), "appointments");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const appointments = poll.data?.appointments ?? null;
  const selected = appointments?.find((item) => item.id === selectedId) ?? appointments?.[0];
  return (
    <main className="page">
      <div className="screen-head">
        <Heading>Booked appointments</Heading>
        <MainAction>
          <Link to="/appointments" className="button primary">
            Public appointment page
          </Link>
        </MainAction>
      </div>
      <div className="split">
        <div className="split-main">
          {appointments === null ? (
            <Skeleton />
          ) : (
            <TableFrame name="Appointments">
              <thead>
                <tr>
                  <th scope="col">Slot</th>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {appointments.map((item) => (
                  <tr key={item.id} className={item.id === selected?.id ? "selected" : undefined}>
                    <td className="num">{formatDateTime(item.startsAt)}</td>
                    <td>{item.name}</td>
                    <td><Email address={item.email} /></td>
                    <td>
                      <RowButton label={`Show ${formatDateTime(item.startsAt)}`} selected={item.id === selected?.id} onSelect={() => setSelectedId(item.id)} />
                    </td>
                  </tr>
                ))}
                {appointments.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">
                      Nothing is booked yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </TableFrame>
          )}
        </div>
        <aside className="detail" aria-label="Selected appointment">
          {selected ? (
            <>
              <h2 className="num">{formatDateTime(selected.startsAt)}</h2>
              <p>{selected.name}</p>
              <p className="muted"><Email address={selected.email} /></p>
            </>
          ) : (
            <Empty title="No slots are booked." />
          )}
        </aside>
      </div>
    </main>
  );
}

function ConsignorForm({ control, consignor, onSaved }: { control: DialogControl; consignor?: Consignor; onSaved: () => Promise<void> }) {
  const action = useAction();
  const initial = { name: consignor?.name ?? "", email: consignor?.email ?? "", phone: consignor?.phone ?? "", iban: consignor?.iban ? formatIban(consignor.iban) : "" };
  const form = useFields(control.name, initial);
  const submit = async (): Promise<void> => {
    const changed = Object.fromEntries(Object.entries(form.values).filter(([name, value]) => !consignor || value !== initial[name as keyof typeof initial]));
    await api(consignor ? `/api/consignors/${consignor.id}` : "/api/consignors", { method: consignor ? "PATCH" : "POST", json: changed });
    await onSaved();
    announce("Consignor saved.");
    control.close();
  };
  return (
    <DialogForm action={action} submit="Save consignor" onSubmit={submit} onCancel={() => control.close()}>
      <TextField form={form} action={action} name="name" label="Name" />
      <TextField form={form} action={action} name="email" type="email" label="Email" />
      <TextField form={form} action={action} name="phone" type="tel" label="Phone" />
      <TextField form={form} action={action} name="iban" label="IBAN" />
    </DialogForm>
  );
}

export function ConsignorsScreen() {
  const poll = usePoll(() => api<{ consignors: Consignor[] }>("/api/consignors"), "consignors");
  const create = useDialog("New consignor");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const consignors = poll.data?.consignors ?? null;
  const selected = consignors?.find((item) => item.id === selectedId) ?? consignors?.[0];
  return (
    <main className="page">
      <div className="screen-head">
        <Heading>Consignors</Heading>
        <MainAction>
          <button ref={openerRef(create)} type="button" className="button primary" onClick={create.open}>
            New consignor
          </button>
        </MainAction>
      </div>
      <div className="split">
        <div className="split-main">
          {consignors === null ? (
            <Skeleton />
          ) : (
            <TableFrame name="Consignors">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">IBAN</th>
                  <th scope="col">Status</th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {consignors.map((item) => (
                  <tr key={item.id} className={item.id === selected?.id ? "selected" : undefined}>
                    <td>
                      <Link to={`/staff/consignors/${item.id}`}>{item.name}</Link>
                    </td>
                    <td><Email address={item.email} /></td>
                    <td className="num nowrap">{item.iban ? formatIban(item.iban) : "None"}</td>
                    <td>{labelOf(CONSIGNOR_STATUSES, item.status)}</td>
                    <td>
                      <RowButton label={`Show ${item.name}`} selected={item.id === selected?.id} onSelect={() => setSelectedId(item.id)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableFrame>
          )}
        </div>
        <aside className="detail" aria-label="Selected consignor">
          {selected ? (
            <>
              <h2>{selected.name}</h2>
              <p className="muted"><Email address={selected.email} /></p>
              <p className="muted num">{selected.phone}</p>
              <p className="num">{selected.iban ? formatIban(selected.iban) : "No IBAN on file"}</p>
              {selected.iban && !selected.ibanValid && <p className="field-error">This IBAN doesn&apos;t pass its check.</p>}
              <Link to={`/staff/consignors/${selected.id}`}>Open this consignor</Link>
            </>
          ) : (
            <Empty title="No consignors yet." />
          )}
        </aside>
      </div>
      <Dialog control={create}>
        <ConsignorForm control={create} onSaved={poll.refresh} />
      </Dialog>
    </main>
  );
}

interface ConsignorDetail {
  consignor: Consignor;
  pieces: Piece[];
  payouts: Payout[];
}

function EraseForm({ consignor, control, poll }: { consignor: Consignor; control: DialogControl; poll: Poll<ConsignorDetail> }) {
  const action = useAction();
  const submit = async (): Promise<void> => {
    const { consignor: erased } = await api<{ consignor: Consignor }>(`/api/consignors/${consignor.id}/erase`, { method: "POST" });
    await poll.refresh();
    announce(erased.status === "erased" ? "Consignor erased." : "Erasing photos — this consignor shows Erased once every photo is gone.");
    control.close({ returnFocus: false });
    focusHeading();
  };
  return (
    <DialogForm action={action} submit="Erase" onSubmit={submit} onCancel={() => control.close()}>
      <p>Their name, email, phone and IBAN are removed for good, their unsold pieces are archived and those photos are deleted. Past sales stay with Erased consignor.</p>
    </DialogForm>
  );
}

export function ConsignorScreen({ id, role }: { id: string; role: Role }) {
  const poll = usePoll(() => api<ConsignorDetail>(`/api/consignors/${id}`), id);
  const edit = useDialog("Edit consignor");
  const erase = useDialog("Erase consignor");
  const action = useAction();
  const data = poll.data;
  if (poll.failure) return <NotFound />;
  if (!data) {
    return (
      <main className="page">
        <Skeleton />
      </main>
    );
  }
  const { consignor, pieces, payouts } = data;
  const active = consignor.status === "active";
  const sendAddress = (): Promise<void> =>
    action.run(async () => {
      await api(`/api/consignors/${id}/portal-link`, { method: "POST" });
      announce("A new page address is on its way by mail.");
    });
  const endAddress = (): Promise<void> =>
    action.run(async () => {
      await api(`/api/consignors/${id}/portal-link`, { method: "DELETE" });
      announce("The page address has ended.");
    });
  return (
    <main className="page">
      <div className="screen-head">
        <Heading>{consignor.name}</Heading>
        <MainAction>
          <Button action={action} kind="primary" disabled={!active} onClick={() => void sendAddress()}>
            Send page address
          </Button>
        </MainAction>
      </div>
      <Problems action={action} />
      <div className="split">
        <div className="split-main">
          <h2>Pieces</h2>
          <TableFrame name="Consignor pieces">
            <thead>
              <tr>
                <th scope="col">Tag code</th>
                <th scope="col">Description</th>
                <th scope="col">Status</th>
                <th scope="col" className="amount">Price</th>
              </tr>
            </thead>
            <tbody>
              {pieces.map((piece) => (
                <tr key={piece.id}>
                  <td className="num">
                    <Link to={`/staff/pieces/${piece.id}`}>{piece.tagCode}</Link>
                  </td>
                  <td>{piece.description}</td>
                  <td>{labelOf(PIECE_STATUSES, piece.status)}</td>
                  <td className="amount num">{formatMoney(piece.currentPriceCents)}</td>
                </tr>
              ))}
              {pieces.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No pieces yet.
                  </td>
                </tr>
              )}
            </tbody>
          </TableFrame>
          <h2>Payouts</h2>
          <TableFrame name="Consignor payouts">
            <thead>
              <tr>
                <th scope="col">Payout</th>
                <th scope="col">Status</th>
                <th scope="col" className="amount">Amount</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((payout) => (
                <tr key={payout.id}>
                  <td className="num">{payout.id}</td>
                  <td>{payout.reason ?? "Paid"}</td>
                  <td className="amount num">{formatMoney(payout.amountCents)}</td>
                </tr>
              ))}
              {payouts.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    No payouts yet.
                  </td>
                </tr>
              )}
            </tbody>
          </TableFrame>
        </div>
        <aside className="detail" aria-label="Consignor details">
          <dl className="facts">
            <div>
              <dt>Status</dt>
              <dd>
                <span>{labelOf(CONSIGNOR_STATUSES, consignor.status)}</span>
              </dd>
            </div>
            {active && (
              <>
                <div>
                  <dt>Email</dt>
                  <dd>{consignor.email ? <Email address={consignor.email} /> : "None"}</dd>
                </div>
                <div>
                  <dt>Phone</dt>
                  <dd className="num">{consignor.phone ?? "None"}</dd>
                </div>
                <div>
                  <dt>IBAN</dt>
                  <dd className="num">{consignor.iban ? formatIban(consignor.iban) : "None"}</dd>
                </div>
              </>
            )}
            <div>
              <dt>With the shop since</dt>
              <dd className="num">{formatDate(consignor.createdAt.slice(0, 10))}</dd>
            </div>
          </dl>
          {active && (
            <div className="actions column">
              <button ref={openerRef(edit)} type="button" className="button secondary" onClick={edit.open}>
                Edit consignor
              </button>
              {role === "owner" && (
                <>
                  <Button action={action} onClick={() => void endAddress()}>
                    End page address
                  </Button>
                  <button ref={openerRef(erase)} type="button" className="button secondary" onClick={erase.open}>
                    Erase consignor
                  </button>
                </>
              )}
            </div>
          )}
        </aside>
      </div>
      <Dialog control={edit}>
        <ConsignorForm control={edit} consignor={consignor} onSaved={poll.refresh} />
      </Dialog>
      <Dialog control={erase}>
        <EraseForm consignor={consignor} control={erase} poll={poll} />
      </Dialog>
    </main>
  );
}

function LadderForm({ control, poll }: { control: DialogControl; poll: Poll<{ ladders: Ladder[] }> }) {
  const action = useAction();
  const form = useFields(control.name, { effectiveOn: "", firstMarkdownPercent: "", firstMarkdownDay: "", secondMarkdownPercent: "", secondMarkdownDay: "", periodEndDay: "" });
  const whole = (text: string): number | null => (/^\d{1,4}$/.test(text.trim()) ? Number(text) : null);
  const submit = async (): Promise<void> => {
    const { effectiveOn, firstMarkdownPercent, firstMarkdownDay, secondMarkdownPercent, secondMarkdownDay, periodEndDay } = form.values;
    const { ladder } = await api<{ ladder: Ladder }>("/api/ladders", {
      method: "POST",
      json: { effectiveOn, firstMarkdownPercent: whole(firstMarkdownPercent), firstMarkdownDay: whole(firstMarkdownDay), secondMarkdownPercent: whole(secondMarkdownPercent), secondMarkdownDay: whole(secondMarkdownDay), periodEndDay: whole(periodEndDay) },
    });
    await poll.refresh();
    announce(`Ladder saved. It applies to pieces taken in from ${formatDate(ladder.effectiveOn)}.`);
    control.close();
  };
  return (
    <DialogForm action={action} submit="Save ladder" onSubmit={submit} onCancel={() => control.close()}>
      <TextField form={form} action={action} name="effectiveOn" label="Takes effect on" hint="As YYYY-MM-DD" />
      <div className="choice-grid">
        <TextField form={form} action={action} name="firstMarkdownPercent" label="First markdown percent" inputMode="numeric" />
        <TextField form={form} action={action} name="firstMarkdownDay" label="First markdown day" inputMode="numeric" />
        <TextField form={form} action={action} name="secondMarkdownPercent" label="Second markdown percent" inputMode="numeric" />
        <TextField form={form} action={action} name="secondMarkdownDay" label="Second markdown day" inputMode="numeric" />
      </div>
      <TextField form={form} action={action} name="periodEndDay" label="Period end day" inputMode="numeric" />
    </DialogForm>
  );
}

export function LadderScreen() {
  const poll = usePoll(() => api<{ ladders: Ladder[] }>("/api/ladders"), "ladders");
  const change = useDialog("Change ladder");
  const ladders = poll.data?.ladders ?? null;
  const latest = ladders?.at(-1);
  return (
    <main className="page">
      <div className="screen-head">
        <Heading>Markdown ladder</Heading>
        <MainAction>
          <button ref={openerRef(change)} type="button" className="button primary" onClick={change.open}>
            Change ladder
          </button>
        </MainAction>
      </div>
      <div className="split">
        <div className="split-main">
          {ladders === null ? (
            <Skeleton />
          ) : (
            <TableFrame name="Ladders">
              <thead>
                <tr>
                  <th scope="col">Takes effect on</th>
                  <th scope="col">First markdown</th>
                  <th scope="col">Second markdown</th>
                  <th scope="col">Period ends</th>
                </tr>
              </thead>
              <tbody>
                {ladders.map((ladder) => (
                  <tr key={ladder.id}>
                    <td className="num">{formatDate(ladder.effectiveOn)}</td>
                    <td className="num">
                      <span className="accent">{ladder.firstMarkdownPercent}% off</span> from day {ladder.firstMarkdownDay}
                    </td>
                    <td className="num">
                      <span className="accent">{ladder.secondMarkdownPercent}% off</span> from day {ladder.secondMarkdownDay}
                    </td>
                    <td className="num">Day {ladder.periodEndDay}</td>
                  </tr>
                ))}
              </tbody>
            </TableFrame>
          )}
        </div>
        <aside className="detail" aria-label="How the ladder works">
          <h2>How it works</h2>
          <p>Every piece keeps the ladder in force on its intake date, on every screen and in every payout.</p>
          {latest && <p className="muted num">The latest change takes effect on {formatDate(latest.effectiveOn)}.</p>}
        </aside>
      </div>
      <Dialog control={change}>
        <LadderForm control={change} poll={poll} />
      </Dialog>
    </main>
  );
}

function AddMemberForm({ control, poll }: { control: DialogControl; poll: Poll<{ members: Member[] }> }) {
  const action = useAction();
  const form = useFields(control.name, { name: "", email: "", password: "", role: "assistant" }, ["password"]);
  const submit = async (): Promise<void> => {
    await api("/api/members", { method: "POST", json: form.values });
    await poll.refresh();
    announce("Member added.");
    control.close();
  };
  return (
    <DialogForm action={action} submit="Save member" onSubmit={submit} onCancel={() => control.close()}>
      <TextField form={form} action={action} name="name" label="Name" />
      <TextField form={form} action={action} name="email" type="email" label="Email" />
      <TextField form={form} action={action} name="password" type="password" label="Starting password" autoComplete="new-password" />
      <RadioGroup label="Role" name="role" options={ROLES.filter((role) => role.value !== "owner")} value={form.values.role} onChange={(value) => form.set("role", value)} grid error={action.problem?.fields.role} />
    </DialogForm>
  );
}

function RemoveMemberForm({ member, control, onRemoved }: { member: Member; control: DialogControl; onRemoved: () => Promise<void> }) {
  const action = useAction();
  const submit = async (): Promise<void> => {
    await api(`/api/members/${member.id}`, { method: "DELETE" });
    await onRemoved();
    announce("Member removed.");
    control.close({ returnFocus: false });
    focusHeading();
  };
  return (
    <DialogForm action={action} submit="Remove member" onSubmit={submit} onCancel={() => control.close()}>
      <p>{member.name} can no longer sign in, and their open sessions end now.</p>
    </DialogForm>
  );
}

function MemberDetail({ member, poll }: { member: Member; poll: Poll<{ members: Member[] }> }) {
  const action = useAction();
  const remove = useDialog("Remove member");
  const form = useFields("Member role", { role: member.role });
  const changeRole = (role: string): Promise<void> =>
    action.run(async () => {
      form.set("role", role);
      await api(`/api/members/${member.id}`, { method: "PATCH", json: { role } });
      await poll.refresh();
      announce("Role changed.");
    });
  return (
    <>
      <h2>{member.name}</h2>
      <p className="muted"><Email address={member.email} /></p>
      <Problems action={action} />
      {member.role === "owner" ? (
        <p>{labelOf(ROLES, member.role)}</p>
      ) : (
        <>
          <SelectField
            form={{ values: form.values, set: (_name, value) => void changeRole(value) }}
            action={action}
            name="role"
            label="Role"
            options={ROLES.filter((role) => role.value !== "owner")}
          />
          <button ref={openerRef(remove)} type="button" className="button secondary" onClick={remove.open}>
            Remove member
          </button>
          <Dialog control={remove}>
            <RemoveMemberForm member={member} control={remove} onRemoved={poll.refresh} />
          </Dialog>
        </>
      )}
    </>
  );
}

export function MembersScreen() {
  const poll = usePoll(() => api<{ members: Member[] }>("/api/members"), "members");
  const add = useDialog("Add member");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const members = poll.data?.members ?? null;
  const selected = members?.find((member) => member.id === selectedId) ?? members?.[0];
  return (
    <main className="page">
      <div className="screen-head">
        <Heading>Members</Heading>
        <MainAction>
          <button ref={openerRef(add)} type="button" className="button primary" onClick={add.open}>
            Add member
          </button>
        </MainAction>
      </div>
      <div className="split">
        <div className="split-main">
          {members === null ? (
            <Skeleton />
          ) : (
            <TableFrame name="Members">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Role</th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.id} className={member.id === selected?.id ? "selected" : undefined}>
                    <td>{member.name}</td>
                    <td><Email address={member.email} /></td>
                    <td>{labelOf(ROLES, member.role)}</td>
                    <td>
                      <RowButton label={`Show ${member.name}`} selected={member.id === selected?.id} onSelect={() => setSelectedId(member.id)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableFrame>
          )}
        </div>
        <aside className="detail" aria-label="Selected member">
          {selected && <MemberDetail key={selected.id} member={selected} poll={poll} />}
        </aside>
      </div>
      <Dialog control={add}>
        <AddMemberForm control={add} poll={poll} />
      </Dialog>
    </main>
  );
}
