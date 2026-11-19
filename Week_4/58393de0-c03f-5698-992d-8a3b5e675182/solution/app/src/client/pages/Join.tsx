import { useRef, useState, type FormEvent } from "react";
import type { Account } from "../../shared/types";
import { copy } from "../../shared/copy";
import { normalizeJoinCode } from "../../shared/rules";
import { Field } from "../forms/Field";
import { fieldErrors } from "../forms/fields";
import { api, ApiError } from "../lib/api";
import { Link, useRouter } from "../lib/router";
import { useSession } from "../lib/session";
import { useStatus } from "../lib/status";
import "./pages.css";

type JoinField = "code" | "nickname";

/** Error codes whose copy sits under `Class code`. */
const CODE_ERRORS: readonly string[] = ["unknown_code", "join_closed", "classroom_full", "too_many_attempts"];

/** The classroom the server holds for this browser between the code step and the nickname step. */
interface PendingJoin {
  /** The normalised code that opened it; null when the session was already pending on arrival. */
  code: string | null;
  classroomName: string;
}

export default function Join() {
  const { navigate } = useRouter();
  const { account, pendingJoin, setAccount } = useSession();
  const { announce } = useStatus();
  const [code, setCode] = useState("");
  const [nickname, setNickname] = useState("");
  const [errors, setErrors] = useState<Partial<Record<JoinField, string>>>({});
  const [busy, setBusy] = useState(false);
  const pending = useRef<PendingJoin | null>(pendingJoin ? { code: null, classroomName: pendingJoin.classroomName } : null);
  const waiting = pending.current?.code === null && !account ? pending.current.classroomName : null;

  const fail = (found: Partial<Record<JoinField, string>>, fallback: string) => {
    setErrors(found);
    const messages = Object.values(found);
    announce(messages.length > 0 ? messages.join(" ") : fallback);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors({});
    const wanted = normalizeJoinCode(code);
    try {
      let session = pending.current;
      if (!session || (session.code ?? "") !== wanted) {
        const opened = await api.post<{ classroom: { name: string } }>("/api/join/code", { code: wanted });
        session = { code: wanted, classroomName: opened.classroom.name };
        pending.current = session;
      }
      const joined = await api.post<{ account: Account }>("/api/join/nickname", { nickname });
      pending.current = null;
      setAccount(joined.account);
      announce(copy.joined(session.classroomName, joined.account.nickname ?? nickname));
      navigate("/class");
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (CODE_ERRORS.includes(error.code) || error.status === 401) pending.current = null;
      if (CODE_ERRORS.includes(error.code)) fail({ code: error.message }, error.message);
      else if (error.code === "nickname_taken") fail({ nickname: error.message }, error.message);
      else if (error.code === "validation") fail(fieldErrors(error, ["code", "nickname"]), error.message);
      else fail({}, error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="column page-body">
      <form className="card auth-card" onSubmit={(event) => void submit(event)} noValidate>
        <h1>Join your class</h1>
        <p className="hint">
          {waiting ? `Joining ${waiting}. Choose your nickname.` : "Type the class code and the nickname your instructor gave you."}
        </p>
        <Field label="Class code" error={errors.code}>
          {(control) => (
            <input
              {...control}
              className="code-input"
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          )}
        </Field>
        <Field label="Nickname" error={errors.nickname}>
          {(control) => <input {...control} type="text" autoComplete="off" value={nickname} onChange={(e) => setNickname(e.target.value)} />}
        </Field>
        <button className="pill stretch-narrow" type="submit" disabled={busy}>Join class</button>
        <p className="hint auth-switch">Running a class? <Link to="/signup?type=educator">Create an Educator account</Link></p>
      </form>
    </div>
  );
}
