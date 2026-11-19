import { useEffect, useState, type FormEvent } from "react";
import { can, roleLabel } from "../../shared/roles";
import { api, ApiFailure, GENERIC_ERROR } from "../lib/api";
import { announce, notify } from "../lib/feedback";
import { navigate } from "../lib/router";
import { useMe, useSession } from "../session";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { InlineAlert } from "../ui/InlineAlert";
import { VisibilityChoice } from "./CreateBoardDialog";
import type { Board, InviteRow, MemberRole, Members, Visibility } from "../../shared/types";

export function AddSectionDialog({ boardId, onClose }: { boardId: number; onClose: () => void }) {
  const { config } = useSession();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/boards/${boardId}/sections`, { name });
      onClose();
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === "section_name_taken") setError(`This board already has a section called ${name.trim()}.`);
      else if (failure instanceof ApiFailure && failure.field === "name") setError(`Section names are 1 to ${config.limits.board_name_max} characters.`);
      else setError(GENERIC_ERROR);
      setBusy(false);
    }
  };

  return (
    <Dialog title="Add section" onClose={onClose}>
      <form className="stack" onSubmit={(event) => void submit(event)}>
        <Field label="Name" error={error}>{(props) => <input {...props} type="text" value={name} data-autofocus autoComplete="off" onChange={(event) => setName(event.target.value)} />}</Field>
        <div className="actions">
          <Button variant="primary" type="submit" busy={busy} busyLabel="Creating">Create</Button>
        </div>
      </form>
    </Dialog>
  );
}

export function EditBoardDialog({ board, onClose }: { board: Board; onClose: () => void }) {
  const { config } = useSession();
  const [name, setName] = useState(board.name);
  const [visibility, setVisibility] = useState<Visibility>(board.visibility);
  const [cover, setCover] = useState<string>(board.cover === null ? "" : String(board.cover));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/api/boards/${board.id}`, { name, visibility, cover: cover === "" ? null : Number(cover) });
      onClose();
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === "board_name_taken") setError(`You already have a board called ${name.trim()}.`);
      else if (failure instanceof ApiFailure && failure.field === "name") setError(`Board names are 1 to ${config.limits.board_name_max} characters.`);
      else setError(GENERIC_ERROR);
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    setDeleting(true);
    try {
      await api.remove(`/api/boards/${board.id}`);
      announce("Board deleted");
      navigate("/boards");
    } catch {
      setError(GENERIC_ERROR);
      setConfirming(false);
      setDeleting(false);
    }
  };

  return (
    <>
      <Dialog title="Edit board" onClose={onClose}>
        <form className="stack" onSubmit={(event) => void submit(event)}>
          <Field label="Name" error={error}>{(props) => <input {...props} type="text" value={name} data-autofocus autoComplete="off" onChange={(event) => setName(event.target.value)} />}</Field>
          <VisibilityChoice value={visibility} onChange={setVisibility} />
          <Field label="Cover">
            {(props) => (
              <select {...props} value={cover} onChange={(event) => setCover(event.target.value)}>
                <option value="">Automatic</option>
                {board.pins.map((pin) => (
                  <option key={pin.id} value={String(pin.id)}>{pin.title}</option>
                ))}
              </select>
            )}
          </Field>
          <div className="actions actions--split">
            <Button variant="danger" onClick={() => setConfirming(true)}>Delete board</Button>
            <Button variant="primary" type="submit" busy={busy} busyLabel="Saving">Save changes</Button>
          </div>
        </form>
      </Dialog>
      {confirming ? (
        <Dialog title={`Delete ${board.name}?`} role="alertdialog" onClose={() => setConfirming(false)}>
          <div className="stack">
            <p>The board, its sections and every pin on it are removed at once. This cannot be undone.</p>
            <div className="actions">
              <Button onClick={() => setConfirming(false)} data-autofocus>Cancel</Button>
              <Button variant="danger" busy={deleting} busyLabel="Deleting" onClick={() => void remove()}>Delete board</Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}

export function InviteDialog({ boardId, onClose }: { boardId: number; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("editor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const sent = await api.post<{ email: string }>(`/api/boards/${boardId}/invites`, { email, role });
      notify(`Invite sent to ${sent.email}`);
      onClose();
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === "already_member") setError(`${email.trim()} is already on this board.`);
      else if (failure instanceof ApiFailure && failure.field === "email") setError("Enter a valid email address.");
      else setError(GENERIC_ERROR);
      setBusy(false);
    }
  };

  return (
    <Dialog title="Invite collaborators" onClose={onClose}>
      <form className="stack" noValidate onSubmit={(event) => void submit(event)}>
        <Field label="Email" error={error}>{(props) => <input {...props} type="email" value={email} data-autofocus autoComplete="off" onChange={(event) => setEmail(event.target.value)} />}</Field>
        <div role="radiogroup" aria-label="Role" className="choice">
          {(["editor", "viewer"] as const).map((option) => (
            <label key={option} className="choice-option">
              <input type="radio" name="role" checked={role === option} onChange={() => setRole(option)} />
              <span>{roleLabel(option)}</span>
            </label>
          ))}
        </div>
        <div className="actions">
          <Button variant="primary" type="submit" busy={busy} busyLabel="Sending">Send invite</Button>
        </div>
      </form>
    </Dialog>
  );
}

export function CollaboratorsDialog({ board, onClose }: { board: Board; onClose: () => void }) {
  const me = useMe();
  const [members, setMembers] = useState<Members | null>(null);
  const [chosen, setChosen] = useState<Record<number, MemberRole>>({});
  const [error, setError] = useState<string | null>(null);
  const owner = can(board.role, "manage_members");

  const load = async (): Promise<void> => setMembers(await api.get<Members>(`/api/boards/${board.id}/members`));
  useEffect(() => {
    void load();
  }, [board.id]);

  const guard = async (work: () => Promise<void>): Promise<void> => {
    setError(null);
    try {
      await work();
      await load();
    } catch {
      setError(GENERIC_ERROR);
    }
  };

  const changeRole = (userId: number, name: string, role: MemberRole): Promise<void> => {
    setChosen((held) => ({ ...held, [userId]: role }));
    return guard(async () => {
      await api.patch(`/api/boards/${board.id}/members/${userId}`, { role });
      announce(`${name} is now ${role === "editor" ? "an editor" : "a viewer"}`);
    }).finally(() => setChosen(({ [userId]: _settled, ...rest }) => rest));
  };
  const remove = (userId: number, name: string): Promise<void> =>
    guard(async () => {
      await api.remove(`/api/boards/${board.id}/members/${userId}`);
      announce(`${name} was removed`);
    });
  const withdraw = (invite: InviteRow): Promise<void> => guard(() => api.remove(`/api/invites/${invite.id}`));
  const leave = async (): Promise<void> => {
    try {
      await api.remove(`/api/boards/${board.id}/members/${me.id}`);
      announce(`You left ${board.name}`);
      onClose();
      navigate("/");
    } catch {
      setError(GENERIC_ERROR);
    }
  };

  return (
    <Dialog title="Collaborators" onClose={onClose}>
      <div className="stack">
        {error ? <InlineAlert>{error}</InlineAlert> : null}
        <ul className="plain-rows">
          <li className="row">
            <span>{board.owner.name}</span>
            <span className="meta">Owner</span>
          </li>
          {members?.members.map((member) => (
            <li key={member.user.id} className="row">
              <span>{member.user.name}</span>
              {owner ? (
                <>
                  <select aria-label={`Role for ${member.user.name}`} value={chosen[member.user.id] ?? member.role} onChange={(event) => void changeRole(member.user.id, member.user.name, event.target.value === "viewer" ? "viewer" : "editor")}>
                    <option value="editor">{roleLabel("editor")}</option>
                    <option value="viewer">{roleLabel("viewer")}</option>
                  </select>
                  <Button aria-label={`Remove ${member.user.name}`} onClick={() => void remove(member.user.id, member.user.name)}>Remove</Button>
                </>
              ) : (
                <span className="meta">{roleLabel(member.role)}</span>
              )}
            </li>
          ))}
          {owner
            ? members?.invites.map((invite) => (
                <li key={invite.id} className="row">
                  <span>{invite.email}</span>
                  <span className="meta">{`Invited as ${invite.role === "editor" ? "editor" : "viewer"}`}</span>
                  <Button aria-label={`Withdraw invite to ${invite.email}`} onClick={() => void withdraw(invite)}>Withdraw</Button>
                </li>
              ))
            : null}
        </ul>
        {can(board.role, "leave") ? (
          <div className="actions">
            <Button variant="danger" onClick={() => void leave()}>Leave board</Button>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
