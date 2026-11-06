/** The job's other tabs: Setup, People & visits, Costs, Access, Outbox, and
 *  the trades' House access region. */

import { useEffect, useState } from "react";
import { api, TRADE_LABELS, type AccessCard, type Costs, type Item, type JobData, type Member, type TradeKey, type Visit } from "../api.js";
import { Dialog, formatLocalMinute, money } from "../components.js";

export function JobTabs({ tab, data, setData, online, announce, refresh }: {
  tab: string;
  data: JobData;
  setData: (fn: (prev: JobData) => JobData) => void;
  online: boolean;
  announce: (message: string) => void;
  refresh: () => Promise<void>;
}): JSX.Element {
  if (tab === "Setup") return <SetupTab data={data} online={online} announce={announce} refresh={refresh} />;
  if (tab === "People & visits") return <PeopleTab data={data} online={online} announce={announce} refresh={refresh} />;
  if (tab === "Costs") return <CostsTab data={data} setData={setData} online={online} announce={announce} refresh={refresh} />;
  if (tab === "Access") return <AccessTab data={data} online={online} announce={announce} />;
  if (tab === "Outbox") return <OutboxTab data={data} />;
  return <></>;
}

// --- Setup ---

function SetupTab({ data, online, announce, refresh }: { data: JobData; online: boolean; announce: (m: string) => void; refresh: () => Promise<void> }): JSX.Element {
  const [dialog, setDialog] = useState<string | null>(null);
  const [roomName, setRoomName] = useState("");
  const [corners, setCorners] = useState("");
  const [revisionPoints, setRevisionPoints] = useState("");
  const [revisionRooms, setRevisionRooms] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [uploadPlanFile, setUploadPlanFile] = useState(false);
  const job = data.job;

  const parseCorners = (text: string): { x: number; y: number }[] | null => {
    const pts: { x: number; y: number }[] = [];
    for (const pair of text.split(";")) {
      const trimmed = pair.trim();
      if (trimmed === "") continue;
      const match = /^(\d+(?:\.\d{1,2})?)\s*,\s*(\d+(?:\.\d{1,2})?)$/.exec(trimmed);
      if (match === null) return null;
      pts.push({ x: Number(match[1]) / 100, y: Number(match[2]) / 100 });
    }
    return pts.length >= 4 ? pts : null;
  };

  const cornersOf = (room: { outline: { x: number; y: number }[] }): string =>
    room.outline.map((pt) => `${round2(pt.x * 100)},${round2(pt.y * 100)}`).join("; ");

  const addRoom = async (): Promise<void> => {
    const outline = parseCorners(corners);
    if (outline === null) {
      announce("Not saved: Check the highlighted fields.");
      return;
    }
    setBusy(true);
    try {
      await api("POST", `/api/jobs/${job.id}/rooms`, { name: roomName, outline });
      announce("Room saved.");
      setDialog(null);
      setRoomName("");
      setCorners("");
      await refresh();
    } catch (err) {
      const body = (err as { body?: { fields?: Record<string, string> } }).body;
      announce(`Not saved: ${body?.fields?.outline ?? (err as { message?: string }).message}`);
    } finally {
      setBusy(false);
    }
  };

  const uploadPlan = async (file: File): Promise<void> => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await api("PUT", `/api/jobs/${job.id}/plan`, undefined, { multipart: form });
      announce("Plan uploaded.");
      await refresh();
    } catch (err) {
      announce(`Not saved: ${(err as { message?: string }).message}`);
    } finally {
      setBusy(false);
      setUploadPlanFile(false);
    }
  };

  const uploadRevision = async (file: File): Promise<void> => {
    setBusy(true);
    try {
      const rooms = data.rooms.map((room) => {
        const cornersText = revisionRooms[room.id] ?? cornersOf(room);
        return { room_id: room.id, outline: parseCorners(cornersText) ?? room.outline };
      });
      const form = new FormData();
      form.append("file", file);
      form.append("reference_points", revisionPoints);
      form.append("rooms", JSON.stringify(rooms));
      const res = await api<{ revision: number; moved: number; needs_review: number }>("POST", `/api/jobs/${job.id}/plan/revisions`, undefined, { multipart: form });
      announce(`Plan revision ${res.revision} uploaded: ${res.moved} pins moved, ${res.needs_review} need review.`);
      setDialog(null);
      await refresh();
    } catch (err) {
      const body = (err as { body?: { fields?: Record<string, string> } }).body;
      announce(`Not saved: ${body?.fields?.reference_points ?? body?.fields?.rooms ?? (err as { message?: string }).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="tab-panel" aria-label="Setup">
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="primary" disabled={!online} onClick={() => setUploadPlanFile(true)}>Upload plan</button>
        <button type="button" disabled={!online} onClick={() => {
          setRevisionRooms({});
          setDialog("revision");
        }}>Upload revision</button>
      </div>
      {uploadPlanFile && (
        <p>
          <label htmlFor="plan-file">Upload plan</label>
          <input id="plan-file" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => {
            const f = e.target.files?.[0];
            if (f !== undefined) void uploadPlan(f);
          }} />
        </p>
      )}
      {dialog === "revision" && (
        <Dialog title="Upload plan revision" onClose={() => setDialog(null)}>
          <div className="field">
            <label htmlFor="revision-file">Revision image</label>
            <input id="revision-file" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => {
              revisionFile = e.target.files?.[0] ?? null;
            }} />
          </div>
          <div className="field">
            <label htmlFor="reference-points">Reference points</label>
            <input id="reference-points" type="text" placeholder="10,10 > 12,10; 90,10 > 92,10; 10,90 > 12,90" value={revisionPoints} onChange={(e) => setRevisionPoints(e.target.value)} />
          </div>
          {data.rooms.map((room) => (
            <div className="field" key={room.id}>
              <label htmlFor={`room-corners-${room.id}`}>{room.name} corners</label>
              <input
                id={`room-corners-${room.id}`} type="text"
                defaultValue={revisionRooms[room.id] ?? cornersOf(room)}
                onChange={(e) => setRevisionRooms((prev) => ({ ...prev, [room.id]: e.target.value }))}
              />
            </div>
          ))}
          <div className="row">
            <button
              type="button" className="primary" disabled={busy}
              onClick={() => { if (revisionFile !== null) void uploadRevision(revisionFile); }}
            >
              Upload revision
            </button>
          </div>
        </Dialog>
      )}

      <h2>Plan revisions</h2>
      <table aria-label="Plan revisions">
        <thead><tr><th>Revision</th><th>Uploaded by</th><th>Uploaded at</th><th className="num">Pins moved</th><th className="num">Need review</th></tr></thead>
        <tbody>
          {data.planRevisions.map((rev) => (
            <tr key={rev.revision}>
              <td className="num">{rev.revision}</td>
              <td>{rev.uploaded_by.name}</td>
              <td className="num">{formatLocalMinute(rev.created_at)}</td>
              <td className="num">{rev.moved}</td>
              <td className="num">{rev.needs_review}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Rooms</h2>
      <button type="button" disabled={!online} onClick={() => setDialog("room")}>Add room</button>
      {dialog === "room" && (
        <Dialog title="Add room" onClose={() => setDialog(null)}>
          <div className="field">
            <label htmlFor="room-name">Room name</label>
            <input id="room-name" type="text" value={roomName} onChange={(e) => setRoomName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="room-corners">Corners</label>
            <input id="room-corners" type="text" placeholder="4,5; 52,5; 52,30; 40,30; 40,47; 4,47" value={corners} onChange={(e) => setCorners(e.target.value)} />
          </div>
          <div className="row">
            <button type="button" className="primary" disabled={busy} onClick={() => { void addRoom(); }}>Save room</button>
          </div>
        </Dialog>
      )}
      <table aria-label="Rooms">
        <thead><tr><th>Room</th><th>Corners</th></tr></thead>
        <tbody>
          {data.rooms.map((room) => (
            <tr key={room.id}>
              <td>{room.name}</td>
              <td className="mono">{cornersOf(room)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

let revisionFile: File | null = null;

function round2(v: number): string {
  return String(Math.round(v * 100) / 100);
}

// --- People & visits ---

function PeopleTab({ data, online, announce, refresh }: { data: JobData; online: boolean; announce: (m: string) => void; refresh: () => Promise<void> }): JSX.Element {
  const [dialog, setDialog] = useState<string | null>(null);
  const [person, setPerson] = useState({ name: "", email: "", phone: "", role: "lead", trade: "electrical", initial_password: "" });
  const [visit, setVisit] = useState({ member_id: "", starts: "", ends: "", repeats: "none", weekdays: "", every: 2, ends_kind: "count", end_date: "", count: 10 });
  const [moveVisit, setMoveVisit] = useState<{ id: string; date: string } | null>(null);
  const [moveTimes, setMoveTimes] = useState({ starts: "", ends: "" });
  const isOwner = data.job.my_role === "owner";
  const job = data.job;

  const addPerson = async (): Promise<void> => {
    try {
      await api("POST", `/api/jobs/${job.id}/members`, {
        name: person.name, email: person.email, phone: person.phone,
        role: person.role, trade: person.role === "trade" ? person.trade : null,
        initial_password: person.initial_password === "" ? undefined : person.initial_password,
      });
      announce("Person added.");
      setDialog(null);
      await refresh();
    } catch (err) {
      const body = (err as { body?: { fields?: Record<string, string> } }).body;
      const message = body?.fields !== undefined ? Object.values(body.fields)[0] : (err as { message?: string }).message;
      announce(`Not saved: ${message}`);
    }
  };

  const endRole = async (member: Member): Promise<void> => {
    try {
      await api("DELETE", `/api/jobs/${job.id}/members/${member.id}`);
      announce(`Role ended for ${member.name}.`);
      await refresh();
    } catch (err) {
      announce(`Not saved: ${(err as { message?: string }).message}`);
    }
  };

  const scheduleVisit = async (): Promise<void> => {
    try {
      const body: Record<string, unknown> = {
        member_id: visit.member_id,
        starts_at: visit.starts.replace(" ", "T"),
        ends_at: visit.ends.replace(" ", "T"),
        recurrence: null,
      };
      if (visit.repeats === "daily") body.recurrence = { freq: "daily", until: visit.ends_kind === "date" ? visit.end_date : null, count: visit.ends_kind === "count" ? visit.count : null };
      if (visit.repeats === "weekly") body.recurrence = { freq: "weekly", weekdays: ["MO", "TU", "WE", "TH", "FR", "SA", "SU"].filter((d, idx) => visit.weekdays.includes(d)), until: visit.ends_kind === "date" ? visit.end_date : null, count: visit.ends_kind === "count" ? visit.count : null };
      if (visit.repeats === "every_n_days") body.recurrence = { freq: "every_n_days", interval: visit.every, until: visit.ends_kind === "date" ? visit.end_date : null, count: visit.ends_kind === "count" ? visit.count : null };
      await api("POST", `/api/jobs/${job.id}/visits`, body);
      announce("Visit scheduled.");
      setDialog(null);
      await refresh();
    } catch (err) {
      const body = (err as { body?: { fields?: Record<string, string> } }).body;
      const message = body?.fields !== undefined ? Object.values(body.fields)[0] : (err as { message?: string }).message;
      announce(`Not saved: ${message}`);
    }
  };

  const occurrenceRows = data.visits
    .flatMap((v) => v.occurrences.map((o) => ({ visit: v, occ: o })))
    .sort((a, b) => (a.occ.starts_at < b.occ.starts_at ? -1 : 1));

  return (
    <section className="tab-panel" aria-label="People and visits">
      <h2>People</h2>
      <table aria-label="People">
        <thead><tr><th>Name</th><th>Role</th><th>Trade</th>{isOwner ? <th>Email</th> : null}</tr></thead>
        <tbody>
          {data.members.map((member) => (
            <tr key={member.id}>
              <td>{member.name}</td>
              <td>{roleLabel(member.role)}</td>
              <td>{member.trade === null ? "" : TRADE_LABELS[member.trade]}</td>
              {isOwner ? <td>{member.email}</td> : null}
              {isOwner && member.role !== "owner" && (
                <td><button type="button" className="quiet" onClick={() => {
                  setDialog(`end-${member.id}`);
                }}>End role for {member.name}</button></td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {isOwner && <button type="button" className="primary" disabled={!online} onClick={() => setDialog("person")}>Add person</button>}
      {dialog === "person" && (
        <Dialog title="Add person" onClose={() => setDialog(null)}>
          <div className="field"><label htmlFor="person-name">Name</label><input id="person-name" type="text" value={person.name} onChange={(e) => setPerson({ ...person, name: e.target.value })} /></div>
          <div className="field"><label htmlFor="person-email">Email</label><input id="person-email" type="text" value={person.email} onChange={(e) => setPerson({ ...person, email: e.target.value })} /></div>
          <div className="field"><label htmlFor="person-phone">Phone</label><input id="person-phone" type="text" value={person.phone} onChange={(e) => setPerson({ ...person, phone: e.target.value })} /></div>
          <div className="field">
            <label htmlFor="person-role">Role</label>
            <select id="person-role" value={person.role} onChange={(e) => setPerson({ ...person, role: e.target.value })}>
              <option value="lead">Lead carpenter</option>
              <option value="trade">Trade</option>
              <option value="homeowner">Homeowner</option>
            </select>
          </div>
          {person.role === "trade" && (
            <div className="field">
              <label htmlFor="person-trade">Trade</label>
              <select id="person-trade" value={person.trade} onChange={(e) => setPerson({ ...person, trade: e.target.value as TradeKey })}>
                {(Object.keys(TRADE_LABELS) as TradeKey[]).map((t) => <option key={t} value={t}>{TRADE_LABELS[t]}</option>)}
              </select>
            </div>
          )}
          <div className="field"><label htmlFor="person-password">Initial password</label><input id="person-password" type="text" value={person.initial_password} onChange={(e) => setPerson({ ...person, initial_password: e.target.value })} /></div>
          <div className="row"><button type="button" className="primary" onClick={() => { void addPerson(); }}>Add</button></div>
        </Dialog>
      )}
      {dialog !== null && dialog.startsWith("end-") && (
        <Dialog title="End role" onClose={() => setDialog(null)}>
          <p>End this person's role on the job?</p>
          <div className="row">
            <button type="button" className="primary" onClick={() => {
              const member = data.members.find((m) => `end-${m.id}` === dialog);
              if (member !== undefined) void endRole(member);
              setDialog(null);
            }}>End role</button>
          </div>
        </Dialog>
      )}

      <h2>Site visits</h2>
      <button type="button" disabled={!online} onClick={() => setDialog("visit")}>Schedule visit</button>
      {dialog === "visit" && (
        <Dialog title="Schedule visit" onClose={() => setDialog(null)}>
          <div className="field">
            <label htmlFor="visit-person">Person</label>
            <select id="visit-person" value={visit.member_id} onChange={(e) => setVisit({ ...visit, member_id: e.target.value })}>
              <option value="" disabled>Pick a person</option>
              {data.members.filter((m) => m.role === "trade").map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div className="field"><label htmlFor="visit-starts">Starts</label><input id="visit-starts" type="text" placeholder="YYYY-MM-DD HH:MM" value={visit.starts} onChange={(e) => setVisit({ ...visit, starts: e.target.value })} /></div>
          <div className="field"><label htmlFor="visit-ends">Ends</label><input id="visit-ends" type="text" placeholder="YYYY-MM-DD HH:MM" value={visit.ends} onChange={(e) => setVisit({ ...visit, ends: e.target.value })} /></div>
          <div className="field">
            <label htmlFor="visit-repeats">Repeats</label>
            <select id="visit-repeats" value={visit.repeats} onChange={(e) => setVisit({ ...visit, repeats: e.target.value })}>
              <option value="none">Does not repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="every_n_days">Every N days</option>
            </select>
          </div>
          {visit.repeats === "weekly" && (
            <fieldset className="field">
              <legend>Weekdays</legend>
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
                <label key={day} style={{ display: "inline-flex", gap: 4, marginRight: 10 }}>
                  <input type="checkbox" /> {day}
                </label>
              ))}
            </fieldset>
          )}
          {visit.repeats === "every_n_days" && (
            <div className="field"><label htmlFor="visit-every">Every how many days</label><input id="visit-every" type="text" value={visit.every} onChange={(e) => setVisit({ ...visit, every: Number(e.target.value) })} /></div>
          )}
          {visit.repeats !== "none" && (
            <>
              <div className="field">
                <label htmlFor="visit-endskind">Ends</label>
                <select id="visit-endskind" value={visit.ends_kind} onChange={(e) => setVisit({ ...visit, ends_kind: e.target.value })}>
                  <option value="date">On date</option>
                  <option value="count">After count</option>
                </select>
              </div>
              {visit.ends_kind === "date" && (
                <div className="field"><label htmlFor="visit-enddate">End date</label><input id="visit-enddate" type="text" placeholder="YYYY-MM-DD" value={visit.end_date} onChange={(e) => setVisit({ ...visit, end_date: e.target.value })} /></div>
              )}
              {visit.ends_kind === "count" && (
                <div className="field"><label htmlFor="visit-count">Occurrences</label><input id="visit-count" type="text" value={visit.count} onChange={(e) => setVisit({ ...visit, count: Number(e.target.value) })} /></div>
              )}
            </>
          )}
          <div className="row"><button type="button" className="primary" onClick={() => { void scheduleVisit(); }}>Save visit</button></div>
        </Dialog>
      )}
      {moveVisit !== null && (
        <Dialog title="Move visit" onClose={() => setMoveVisit(null)}>
          <div className="field"><label htmlFor="move-starts">Starts</label><input id="move-starts" type="text" value={moveTimes.starts} onChange={(e) => setMoveTimes({ ...moveTimes, starts: e.target.value })} /></div>
          <div className="field"><label htmlFor="move-ends">Ends</label><input id="move-ends" type="text" value={moveTimes.ends} onChange={(e) => setMoveTimes({ ...moveTimes, ends: e.target.value })} /></div>
          <div className="row">
            <button type="button" className="primary" onClick={() => {
              void (async () => {
                try {
                  await api("PUT", `/api/jobs/${job.id}/visits/${moveVisit.id}/occurrences/${moveVisit.date}`, {
                    starts_at: moveTimes.starts.replace(" ", "T"),
                    ends_at: moveTimes.ends.replace(" ", "T"),
                  });
                  announce("Visit moved.");
                  setMoveVisit(null);
                  await refresh();
                } catch (err) {
                  announce(`Not saved: ${(err as { message?: string }).message}`);
                }
              })();
            }}>Move visit</button>
          </div>
        </Dialog>
      )}
      <table aria-label="Site visits">
        <thead><tr><th>Person</th><th>Starts</th><th>Ends</th><th>Status</th></tr></thead>
        <tbody>
          {occurrenceRows.map(({ visit, occ }) => (
            <tr key={`${visit.id}-${occ.date}`}>
              <td>{visit.member_name}</td>
              <td className="num">{formatLocalMinute(occ.starts_at)}</td>
              <td className="num">{formatLocalMinute(occ.ends_at)}</td>
              <td>{occ.status === "scheduled" ? "Scheduled" : occ.status === "moved" ? "Moved" : "Cancelled"}</td>
              {occ.status !== "cancelled" && (
                <td>
                  <button type="button" className="quiet" onClick={() => {
                    setMoveVisit({ id: visit.id, date: occ.date });
                    setMoveTimes({ starts: formatLocalMinute(occ.starts_at), ends: formatLocalMinute(occ.ends_at) });
                  }}>Move visit on {formatLocalMinute(occ.starts_at)}</button>
                  <button type="button" className="quiet" onClick={() => {
                    void (async () => {
                      try {
                        await api("DELETE", `/api/jobs/${job.id}/visits/${visit.id}/occurrences/${occ.date}`);
                        announce("Visit cancelled.");
                        await refresh();
                      } catch (err) {
                        announce(`Not saved: ${(err as { message?: string }).message}`);
                      }
                    })();
                  }}>Cancel visit on {formatLocalMinute(occ.starts_at)}</button>
                </td>
              )}
              {isFirstOccurrence(visit, occ.date) && (
                <td>
                  <button type="button" className="quiet" onClick={() => {
                    void (async () => {
                      try {
                        await api("DELETE", `/api/jobs/${job.id}/visits/${visit.id}`);
                        await refresh();
                      } catch (err) {
                        announce(`Not saved: ${(err as { message?: string }).message}`);
                      }
                    })();
                  }}>Delete visit on {formatLocalMinute(occ.starts_at)}</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function isFirstOccurrence(visit: Visit, date: string): boolean {
  const dates = visit.occurrences.map((o) => o.date).sort();
  return dates[0] === date;
}

function roleLabel(role: string): string {
  return role === "owner" ? "Owner" : role === "lead" ? "Lead carpenter" : role === "trade" ? "Trade" : "Homeowner";
}

// --- Costs ---

function CostsTab({ data, setData, online, announce, refresh }: {
  data: JobData;
  setData: (fn: (prev: JobData) => JobData) => void;
  online: boolean;
  announce: (m: string) => void;
  refresh: () => Promise<void>;
}): JSX.Element {
  const isOwner = data.job.my_role === "owner";
  const [contingency, setContingency] = useState("");
  const [changeOrder, setChangeOrder] = useState({ description: "", amount: "" });
  const costs = data.costs;

  useEffect(() => {
    if (costs !== null && contingency === "") setContingency(costs.contingency_percent);
  }, [costs, contingency]);

  const saveContingency = async (): Promise<void> => {
    try {
      await api("PUT", `/api/jobs/${data.job.id}/contingency`, { percent: contingency });
      announce("Contingency saved.");
      await refresh();
    } catch (err) {
      const body = (err as { body?: { fields?: Record<string, string> } }).body;
      announce(`Not saved: ${body?.fields?.percent ?? (err as { message?: string }).message}`);
    }
  };

  const addChangeOrder = async (): Promise<void> => {
    try {
      await api("POST", `/api/jobs/${data.job.id}/change-orders`, changeOrder);
      announce("Change order added.");
      setChangeOrder({ description: "", amount: "" });
      await refresh();
    } catch (err) {
      const body = (err as { body?: { fields?: Record<string, string> } }).body;
      announce(`Not saved: ${body?.fields !== undefined ? Object.values(body.fields)[0] : (err as { message?: string }).message}`);
    }
  };

  const approve = async (id: string): Promise<void> => {
    try {
      await api("POST", `/api/jobs/${data.job.id}/change-orders/${id}/approve`);
      announce("Change order approved.");
      await refresh();
    } catch (err) {
      announce(`Not saved: ${(err as { message?: string }).message}`);
    }
  };

  if (costs === null) return <section className="tab-panel"><p>Loading…</p></section>;

  return (
    <section className="tab-panel" aria-label="Costs">
      <div className="costs-layout">
        <div>
          <h2>Cost by room</h2>
          <table aria-label="Cost by room">
            <thead><tr><th>Room</th><th className="num">Subtotal</th></tr></thead>
            <tbody>
              {costs.by_room.map((row) => (
                <tr key={row.room_id}><td>{row.name}</td><td className="num">{money(row.subtotal)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h2>Cost by trade</h2>
          <table aria-label="Cost by trade">
            <thead><tr><th>Trade</th><th className="num">Subtotal</th></tr></thead>
            <tbody>
              {costs.by_trade.map((row) => (
                <tr key={String(row.trade)}><td>{row.trade === null ? "Crew" : TRADE_LABELS[row.trade]}</td><td className="num">{money(row.subtotal)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="totals-lines" aria-label="Totals">
        <div><span>Subtotal</span><span>{money(costs.items_subtotal)}</span></div>
        <div><span>Change orders</span><span>{money(costs.change_orders_total)}</span></div>
        <div><span>Contingency {Number(costs.contingency_percent).toFixed(2)}%</span><span>{money(costs.contingency)}</span></div>
        <div><span>Total</span><span>{money(costs.total)}</span></div>
      </div>
      {isOwner && (
        <div style={{ display: "flex", gap: 8, alignItems: "end", margin: "16px 0" }}>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="contingency">Contingency percent</label>
            <input id="contingency" type="text" value={contingency} onChange={(e) => setContingency(e.target.value)} disabled={!online} />
          </div>
          <button type="button" disabled={!online} onClick={() => { void saveContingency(); }}>Save contingency</button>
        </div>
      )}
      <h2>Change orders</h2>
      <table aria-label="Change orders">
        <thead><tr><th>Description</th><th className="num">Amount</th><th>Status</th><th>Approved at</th></tr></thead>
        <tbody>
          {data.changeOrders.map((order) => (
            <tr key={order.id}>
              <td>{order.description}</td>
              <td className="num">{money(order.amount)}</td>
              <td>{order.status === "pending" ? "Pending" : "Approved"}</td>
              <td className="num">{order.approved_at === null ? "" : formatLocalMinute(order.approved_at)}</td>
              {isOwner && order.status === "pending" && (
                <td><button type="button" className="quiet" onClick={() => { void approve(order.id); }}>Approve {order.description}</button></td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="co-description">Change order description</label>
          <input id="co-description" type="text" value={changeOrder.description} onChange={(e) => setChangeOrder({ ...changeOrder, description: e.target.value })} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="co-amount">Change order amount</label>
          <input id="co-amount" type="text" value={changeOrder.amount} onChange={(e) => setChangeOrder({ ...changeOrder, amount: e.target.value })} />
        </div>
        <button type="button" disabled={!online} onClick={() => { void addChangeOrder(); }}>Add change order</button>
      </div>
    </section>
  );
}

// --- Access ---

export function HouseAccessRegion({ jobId, announce, online, nextVisit }: {
  jobId: string;
  announce: (m: string) => void;
  online: boolean;
  nextVisit: { starts_at: string; ends_at: string } | null;
}): JSX.Element {
  const [card, setCard] = useState<AccessCard | null>(null);
  const [busy, setBusy] = useState(false);

  const reveal = async (): Promise<void> => {
    setBusy(true);
    try {
      const res = await api<AccessCard>("GET", `/api/jobs/${jobId}/access`);
      setCard(res);
      const until = res.visible_until === null ? "" : ` Codes visible until ${res.visible_until.slice(11, 16)}`;
      announce(`Codes shown.${until}`);
    } catch (err) {
      const body = (err as { body?: { error?: string; message?: string } }).body;
      if (body?.error === "outside_site_visit") {
        const next = nextVisit === null ? "" : ` Next visit: ${nextVisit.starts_at.slice(0, 16).replace("T", " ")}`;
        announce(`${body.message}${next}`);
      } else {
        announce(body?.message ?? "Something went wrong.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="access-region" aria-label="House access">
      <h2 style={{ fontSize: "1.1rem" }}>House access</h2>
      {card === null ? (
        <div>
          <button type="button" onClick={() => { void reveal(); }} disabled={busy || !online}>Show access codes</button>
        </div>
      ) : (
        <>
          <dl className="house-access-values">
            <dt>Lockbox</dt><dd>{card.lockbox_code}</dd>
            <dt>Alarm</dt><dd>{card.alarm_code}</dd>
            <dt>Garage</dt><dd>{card.garage_code}</dd>
            <dt>House note</dt><dd>{card.house_note}</dd>
          </dl>
          {card.visible_until !== null && <p>Codes visible until {card.visible_until.slice(11, 16)}</p>}
          <button type="button" onClick={() => { setCard(null); announce("Codes hidden."); }}>Hide access codes</button>
        </>
      )}
    </section>
  );
}

function AccessTab({ data, online, announce }: { data: JobData; online: boolean; announce: (m: string) => void }): JSX.Element {
  const isOwner = data.job.my_role === "owner";
  const [card, setCard] = useState<AccessCard | null>(null);
  const [reveals, setReveals] = useState<{ name: string; role: string; revealed_at: string }[]>([]);
  const job = data.job;

  useEffect(() => {
    void (async () => {
      try {
        const res = await api<AccessCard>("GET", `/api/jobs/${job.id}/access`);
        setCard(res);
      } catch {
        setCard(null);
      }
      if (isOwner) {
        const log = await api<{ reveals: { name: string; role: string; revealed_at: string }[] }>("GET", `/api/jobs/${job.id}/access/reveals`);
        setReveals(log.reveals);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (): Promise<void> => {
    if (card === null) return;
    try {
      await api("PUT", `/api/jobs/${job.id}/access`, {
        lockbox_code: card.lockbox_code, alarm_code: card.alarm_code,
        garage_code: card.garage_code, house_note: card.house_note,
      });
      announce("Access card saved.");
    } catch (err) {
      const body = (err as { body?: { fields?: Record<string, string> } }).body;
      announce(`Not saved: ${body?.fields !== undefined ? Object.values(body.fields)[0] : (err as { message?: string }).message}`);
    }
  };

  return (
    <section className="tab-panel" aria-label="Access">
      <h2>Access card</h2>
      {card === null ? (
        <p>Codes are not available right now.</p>
      ) : isOwner ? (
        <div style={{ maxWidth: 460, display: "grid", gap: 10 }}>
          <div className="field"><label htmlFor="lockbox">Lockbox code</label><input id="lockbox" type="text" value={card.lockbox_code} onChange={(e) => setCard({ ...card, lockbox_code: e.target.value })} disabled={!online} /></div>
          <div className="field"><label htmlFor="alarm">Alarm code</label><input id="alarm" type="text" value={card.alarm_code} onChange={(e) => setCard({ ...card, alarm_code: e.target.value })} disabled={!online} /></div>
          <div className="field"><label htmlFor="garage">Garage code</label><input id="garage" type="text" value={card.garage_code} onChange={(e) => setCard({ ...card, garage_code: e.target.value })} disabled={!online} /></div>
          <div className="field"><label htmlFor="housenote">House note</label><textarea id="housenote" value={card.house_note} onChange={(e) => setCard({ ...card, house_note: e.target.value })} disabled={!online} /></div>
          <div><button type="button" className="primary" disabled={!online} onClick={() => { void save(); }}>Save access card</button></div>
        </div>
      ) : (
        <dl className="house-access-values">
          <dt>Lockbox</dt><dd>{card.lockbox_code}</dd>
          <dt>Alarm</dt><dd>{card.alarm_code}</dd>
          <dt>Garage</dt><dd>{card.garage_code}</dd>
          <dt>House note</dt><dd>{card.house_note}</dd>
        </dl>
      )}
      {isOwner && (
        <>
          <h2>Code reveals</h2>
          <table aria-label="Code reveals">
            <thead><tr><th>Person</th><th>Role</th><th>Revealed at</th></tr></thead>
            <tbody>
              {reveals.map((reveal) => (
                <tr key={reveal.revealed_at + reveal.name}>
                  <td>{reveal.name}</td>
                  <td>{roleLabel(reveal.role)}</td>
                  <td className="num">{formatLocalMinute(reveal.revealed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

// --- Outbox ---

function OutboxTab({ data }: { data: JobData }): JSX.Element {
  return (
    <section className="tab-panel" aria-label="Outbox">
      <h2>Outbox</h2>
      <table aria-label="Outbox">
        <thead><tr><th>Sent to</th><th>Subject</th><th>Status</th><th>Queued at</th></tr></thead>
        <tbody>
          {data.outbox.map((entry) => (
            <tr key={entry.id}>
              <td>{entry.to}</td>
              <td>{entry.subject}</td>
              <td>{entry.status === "queued" ? "Not sent yet" : "Sent"}</td>
              <td className="num">{formatLocalMinute(entry.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
