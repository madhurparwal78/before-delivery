// The fleet register: every instrument as a numbered catalogue row; the owner adds instruments and students.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import type { Family, Instrument, School } from "../../shared/api.js";
import { INSTRUMENT_STATUS_WORDS, INSTRUMENT_TYPES, instrumentName, sizesFor, sizeWord, type InstrumentType,
  type Size } from "../../shared/vocabulary.js";
import { call, NETWORK_COPY } from "../api.js";
import { Link, useUser } from "../app.js";
import { useFieldErrors } from "../components/fieldErrors.js";
import { errorNotice, Dialog, Field, info, quiet, Status, type Notice } from "../components/ui.js";
import { useBand, type Band } from "../hooks.js";
import { rememberHeaderOrigin } from "../motion.js";

const COLUMNS: Record<Exclude<Band, "narrow">, readonly string[]> = {
  medium: ["No.", "Serial", "Instrument", "Size", "School", "Status"],
  wide: ["No.", "Serial", "Instrument", "Size", "Model", "School", "Status"],
};

function cell(column: string, item: Instrument): ReactNode {
  switch (column) {
    case "No.": return <span className="figure index">{String(item.index).padStart(3, "0")}</span>;
    case "Serial": return item.contract_id
      ? <Link to={`/contracts/${item.contract_id}`} className="figure serial" onFollow={(anchor) => {
        const entry = anchor.closest("tr, li");
        if (item.contract_id && entry) rememberHeaderOrigin(item.contract_id, entry.getBoundingClientRect());
      }}>{item.serial}</Link>
      : <span className="figure serial">{item.serial}</span>;
    case "Instrument": return instrumentName(item.instrument_type);
    case "Size": return <span className={item.size === "full" ? "size-word" : "figure"}>{sizeWord(item.size)}</span>;
    case "Model": return item.model;
    case "School": return item.school_name ?? <span className="muted">—</span>;
    default: return <span className={`word word--${item.status}`}>{INSTRUMENT_STATUS_WORDS[item.status]}</span>;
  }
}

export function Register(): ReactNode {
  const user = useUser();
  const band = useBand();
  const [instruments, setInstruments] = useState<Instrument[] | null>(null);
  const [notice, setNotice] = useState<Notice>(quiet);
  const [dialog, setDialog] = useState<"instrument" | "student" | null>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const openers = { instrument: useRef<HTMLButtonElement>(null), student: useRef<HTMLButtonElement>(null) };
  const succeeded = useRef(false);

  const load = useCallback(async () => {
    const result = await call<{ instruments: Instrument[] }>("GET", "/api/instruments");
    if (result.ok) setInstruments(result.data.instruments);
    else setNotice(errorNotice(NETWORK_COPY));
  }, []);

  useEffect(() => { void load(); }, [load]);

  const done = (message: string): void => {
    succeeded.current = true;
    setDialog(null);
    setNotice(info(message));
    void load();
  };
  const closeTo = (which: "instrument" | "student") => (): HTMLElement | null => {
    const target = succeeded.current ? status.current : openers[which].current;
    succeeded.current = false;
    return target;
  };

  return (
    <section className="page register">
      <header className="page__head">
        <p className="eyebrow">Keel &amp; Bell Music</p>
        <h1>Fleet register</h1>
        <p className="lede">Every serialized instrument in the fleet, numbered in serial order, with the school of the contract that holds it.</p>
        {user.role === "owner" && (
          <div className="page__actions">
            <button ref={openers.instrument} type="button" className="button button--primary" onClick={() => setDialog("instrument")}>
              <Plus size={18} aria-hidden="true" />Add instrument
            </button>
            <button ref={openers.student} type="button" className="button button--secondary" onClick={() => setDialog("student")}>
              <Plus size={18} aria-hidden="true" />Add student
            </button>
          </div>
        )}
        <Status ref={status} label="Register status" notice={notice} />
      </header>
      {instruments === null ? <p className="muted">Loading the register…</p> : band === "narrow" ? (
        <ul className="register-list" aria-label="Fleet register" role="list">
          {instruments.map((item) => (
            <li key={item.serial} className={item.contract_id ? "register-row register-row--linked" : "register-row"}>
              <p className="register-list__line">{cell("No.", item)} {cell("Serial", item)}</p>
              <p className="register-list__line">{item.label} {cell("Status", item)}</p>
            </li>
          ))}
        </ul>
      ) : (
        <table className={`register-table register-table--${band}`} aria-label="Fleet register" role="table">
          <thead role="rowgroup">
            <tr role="row">{COLUMNS[band].map((c) => <th key={c} scope="col" role="columnheader" className={`col-${c.replace(".", "").toLowerCase()}`}>{c}</th>)}</tr>
          </thead>
          <tbody role="rowgroup">
            {instruments.map((item) => (
              <tr key={item.serial} role="row" className={item.contract_id ? "register-row register-row--linked" : "register-row"}>
                {COLUMNS[band].map((c) => <td key={c} role="cell" className={`col-${c.replace(".", "").toLowerCase()}`}>{cell(c, item)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {user.role === "owner" && (
        <>
          <Dialog open={dialog === "instrument"} title="Add instrument" onClose={() => setDialog(null)} returnFocus={closeTo("instrument")}>
            <AddInstrument setNotice={setNotice} onAdded={(serial) => done(`Added ${serial}.`)} onCancel={() => setDialog(null)} />
          </Dialog>
          <Dialog open={dialog === "student"} title="Add student" onClose={() => setDialog(null)} returnFocus={closeTo("student")}>
            <AddStudent setNotice={setNotice} onAdded={done} onCancel={() => setDialog(null)} />
          </Dialog>
        </>
      )}
    </section>
  );
}

interface FormProps { setNotice: (notice: Notice) => void; onCancel: () => void }

function AddInstrument({ setNotice, onAdded, onCancel }: FormProps & { onAdded: (serial: string) => void }): ReactNode {
  const [serial, setSerial] = useState("");
  const [type, setType] = useState<InstrumentType>("flute");
  const [size, setSize] = useState<Size>("full");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const fields = useFieldErrors("add-instrument");
  return (
    <form className="form" noValidate onSubmit={(event) => {
      event.preventDefault();
      setBusy(true);
      setNotice(info("Saving…"));
      void call<{ instrument: Instrument }>("POST", "/api/instruments", { serial, instrument_type: type, size, model }).then((r) => {
        setBusy(false);
        if (r.ok) {
          fields.clear();
          onAdded(r.data.instrument.serial);
        } else if (r.status === 422 && r.error?.fields) {
          setNotice(errorNotice("Check the highlighted fields."));
          fields.show(r.error.fields, ["serial", "instrument_type", "size", "model"]);
        } else if (r.status === 409) {
          fields.clear();
          setNotice(errorNotice(`Serial ${serial} is already in the fleet.`));
        } else {
          setNotice(errorNotice(NETWORK_COPY));
        }
      });
    }}>
      <Field label="Serial" htmlFor={fields.bind("serial").id} error={fields.errors.serial} errorId={fields.errorId("serial")}>
        <input {...fields.bind("serial")} className="figure" value={serial} autoCapitalize="characters"
          onChange={(e) => setSerial(e.currentTarget.value)} />
      </Field>
      <Field label="Instrument" htmlFor={fields.bind("instrument_type").id} error={fields.errors.instrument_type} errorId={fields.errorId("instrument_type")}>
        <select {...fields.bind("instrument_type")} value={type} onChange={(e) => {
          const next = INSTRUMENT_TYPES.find((t) => t === e.currentTarget.value) ?? "flute";
          setType(next);
          setSize(sizesFor(next)[0]);
        }}>
          {INSTRUMENT_TYPES.map((t) => <option key={t} value={t}>{instrumentName(t)}</option>)}
        </select>
      </Field>
      <Field label="Size" htmlFor={fields.bind("size").id} error={fields.errors.size} errorId={fields.errorId("size")}>
        <select {...fields.bind("size")} value={size} onChange={(e) => setSize(sizesFor(type).find((s) => s === e.currentTarget.value) ?? "full")}>
          {sizesFor(type).map((s) => <option key={s} value={s}>{sizeWord(s)}</option>)}
        </select>
      </Field>
      <Field label="Model" htmlFor={fields.bind("model").id} error={fields.errors.model} errorId={fields.errorId("model")}>
        <input {...fields.bind("model")} value={model} onChange={(e) => setModel(e.currentTarget.value)} />
      </Field>
      <div className="dialog__actions">
        <button type="submit" className="button button--primary" disabled={busy}>Save instrument</button>
        <button type="button" className="button button--secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function AddStudent({ setNotice, onAdded, onCancel }: FormProps & { onAdded: (message: string) => void }): ReactNode {
  const [families, setFamilies] = useState<Family[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [familyId, setFamilyId] = useState("");
  const [schoolId, setSchoolId] = useState("");
  const [name, setName] = useState("");
  const [grade, setGrade] = useState("");
  const [busy, setBusy] = useState(false);
  const fields = useFieldErrors("add-student");

  useEffect(() => {
    void call<{ families: Family[] }>("GET", "/api/families").then((r) => {
      if (r.ok) {
        setFamilies(r.data.families);
        setFamilyId((current) => current || r.data.families[0]?.id || "");
      }
    });
    void call<{ schools: School[] }>("GET", "/api/schools").then((r) => {
      if (r.ok) {
        setSchools(r.data.schools);
        setSchoolId((current) => current || r.data.schools[0]?.id || "");
      }
    });
  }, []);

  return (
    <form className="form" noValidate onSubmit={(event) => {
      event.preventDefault();
      setBusy(true);
      setNotice(info("Saving…"));
      const gradeValue = /^\d{1,2}$/.test(grade.trim()) ? Number(grade.trim()) : null;
      void call<{ student: { name: string; school_id: string } }>("POST", "/api/students",
        { family_id: familyId, school_id: schoolId, name, grade: gradeValue }).then((r) => {
        setBusy(false);
        if (r.ok) {
          fields.clear();
          const school = schools.find((s) => s.id === r.data.student.school_id);
          onAdded(`Added ${r.data.student.name} to ${school?.name ?? r.data.student.school_id}.`);
        } else if (r.status === 422 && r.error?.fields) {
          setNotice(errorNotice("Check the highlighted fields."));
          fields.show(r.error.fields, ["family_id", "school_id", "name", "grade"]);
        } else {
          setNotice(errorNotice(NETWORK_COPY));
        }
      });
    }}>
      <Field label="Family" htmlFor={fields.bind("family_id").id} error={fields.errors.family_id} errorId={fields.errorId("family_id")}>
        <select {...fields.bind("family_id")} value={familyId} onChange={(e) => setFamilyId(e.currentTarget.value)}>
          {families.map((f) => <option key={f.id} value={f.id}>{f.parent_name} ({f.id})</option>)}
        </select>
      </Field>
      <Field label="School" htmlFor={fields.bind("school_id").id} error={fields.errors.school_id} errorId={fields.errorId("school_id")}>
        <select {...fields.bind("school_id")} value={schoolId} onChange={(e) => setSchoolId(e.currentTarget.value)}>
          {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </Field>
      <Field label="Student name" htmlFor={fields.bind("name").id} error={fields.errors.name} errorId={fields.errorId("name")}>
        <input {...fields.bind("name")} value={name} onChange={(e) => setName(e.currentTarget.value)} />
      </Field>
      <Field label="Grade" htmlFor={fields.bind("grade").id} error={fields.errors.grade} errorId={fields.errorId("grade")}>
        <input {...fields.bind("grade")} className="figure" inputMode="numeric" value={grade} onChange={(e) => setGrade(e.currentTarget.value)} />
      </Field>
      <div className="dialog__actions">
        <button type="submit" className="button button--primary" disabled={busy}>Save student</button>
        <button type="button" className="button button--secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
