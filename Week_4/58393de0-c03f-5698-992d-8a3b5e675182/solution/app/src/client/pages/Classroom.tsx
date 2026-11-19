import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { warmUp } from "../geometry";
import { copy, STATE_LABELS } from "../../shared/copy";
import { wireToDisplay } from "../../shared/rules";
import type { Classroom as ClassroomData, ClassroomEducator, RosterStudent } from "../../shared/types";
import { Glancet } from "../glancet/Glancet";
import { api, ApiError } from "../lib/api";
import { Link } from "../lib/router";
import { useStatus } from "../lib/status";
import { controlAfterRemoval, sortStudents, studentRemoved, studentRenamed, type SortOrder } from "../roster/classroomState";
import { ConfirmDialog } from "../roster/ConfirmDialog";
import { ASSISTANT_EMAIL_KEY, controlProps, findControl, JOIN_CODE_KEY, renameKey, watchKey } from "../roster/controls";
import { failureMessage } from "../roster/failure";
import { HandInFiles } from "../roster/HandInFiles";
import { Instructors } from "../roster/Instructors";
import { JoinCodeDialog } from "../roster/JoinCodeDialog";
import { RenameDialog } from "../roster/RenameDialog";
import { Roster } from "../roster/Roster";
import { TimesDialog, type TimesPatch } from "../roster/TimesDialog";
import { useDialogTarget } from "../roster/useDialogTarget";
import { useRoster } from "../roster/useRoster";
import "../roster/roster.css";

/** The dashboard names the classroom it just created here, so its heading takes focus on arrival. */
const FOCUS_HEADING_KEY = "qy-focus-heading";

function NoAccess({ message }: { message: string }) {
  return (
    <div className="column section">
      <h1>{message}</h1>
      <Link to="/dashboard" className="pill">Back to dashboard</Link>
    </div>
  );
}

export default function Classroom({ id }: { id: string }) {
  const { announce } = useStatus();
  const [order, setOrder] = useState<SortOrder>("nickname");
  const [watching, setWatching] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const [joinCodeOpen, setJoinCodeOpen] = useState(false);
  const [timesOpen, setTimesOpen] = useState(false);
  const [handInOpen, setHandInOpen] = useState(false);
  const renaming = useDialogTarget<RosterStudent>();
  const removing = useDialogTarget<RosterStudent>();
  const removingAssistant = useDialogTarget<ClassroomEducator>();
  const heading = useRef<HTMLHeadingElement>(null);
  const landing = useRef<string | null>(null);
  const live = useRef({ order, watching });
  live.current = { order, watching };

  /** A Glancet whose Student left closes at once; focus moves on only when it was inside the viewer. */
  const closeWatchFor = useCallback((student: RosterStudent, classroom: ClassroomData, sorted: readonly RosterStudent[]) => {
    if (live.current.watching !== student.id) return;
    if (findControl("glancet")?.contains(document.activeElement)) landing.current = controlAfterRemoval(sorted, student.id);
    announce(copy.glancetRemoved(student.nickname, classroom.name));
    setWatching(null);
  }, [announce]);

  const onStudentRemoved = useCallback((student: RosterStudent, remaining: ClassroomData) => {
    closeWatchFor(student, remaining, sortStudents([...remaining.students, student], live.current.order));
  }, [closeWatchFor]);

  useEffect(warmUp, []);
  const { phase, classroom, update, replace, reload } = useRoster(id, onStudentRemoved);
  const ready = phase.kind === "ready";

  useEffect(() => {
    if (!ready || window.sessionStorage.getItem(FOCUS_HEADING_KEY) !== id) return;
    window.sessionStorage.removeItem(FOCUS_HEADING_KEY);
    heading.current?.focus();
  }, [ready, id]);

  /** The control focus was promised to, once; a closing dialog asks for it so the move waits until the dialog has let go of focus. */
  const takeLanding = useCallback((): HTMLElement | null => {
    const key = landing.current;
    landing.current = null;
    return key ? findControl(key) : null;
  }, []);

  const dialogOpen = renaming.open || removing.open || removingAssistant.open;
  useEffect(() => {
    if (!dialogOpen) takeLanding()?.focus();
  });

  const students = useMemo(() => (classroom ? sortStudents(classroom.students, order) : []), [classroom, order]);
  const watched = classroom?.students.find((student) => student.id === watching) ?? null;

  const watch = useCallback((student: RosterStudent) => {
    setWatching(student.id);
    setFocusRequest((count) => count + 1);
  }, []);

  const closeViewer = useCallback(() => {
    const opener = live.current.watching;
    setWatching(null);
    if (opener) findControl(watchKey(opener))?.focus({ preventScroll: true });
  }, []);

  const fail = useCallback((error: unknown) => announce(failureMessage(error)), [announce]);

  if (phase.kind === "failed") return <NoAccess message={phase.message} />;
  if (phase.kind === "ended") return <NoAccess message={copy.notFound} />;
  if (!classroom) return <div className="column section" />;

  const isOwner = classroom.role === "owner";
  const base = `/api/classrooms/${id}`;

  const newCode = async () => {
    try {
      const { joinCode } = await api.post<{ joinCode: string }>(`${base}/join-code`);
      update((current) => ({ ...current, joinCode }));
      announce(copy.newJoinCode);
    } catch (error) {
      fail(error);
    }
  };

  const saveTimes = async (patch: TimesPatch) => {
    try {
      if (Object.keys(patch).length > 0) replace(await api.patch<ClassroomData>(base, patch));
    } catch (error) {
      if (error instanceof ApiError && Object.keys(error.fields).length > 0) throw error;
      fail(error);
    }
    setTimesOpen(false);
  };

  const handInAll = async () => {
    try {
      replace(await api.post<ClassroomData>(`${base}/hand-in`));
      announce(copy.handedIn(classroom.name));
    } catch (error) {
      fail(error);
    }
    setHandInOpen(false);
  };

  const archive = async () => {
    try {
      replace(await api.post<ClassroomData>(`${base}/archive`));
      announce(copy.archivedClassroom(classroom.name));
    } catch (error) {
      fail(error);
    }
  };

  const renameStudent = async (student: RosterStudent, nickname: string) => {
    const renamed = await api.patch<{ id: string; nickname: string }>(`${base}/students/${student.id}`, { nickname });
    landing.current = renameKey(student.id);
    update((current) => studentRenamed(current, renamed.id, renamed.nickname));
    announce(copy.renamed(renamed.nickname));
    renaming.hide();
  };

  const removeStudent = async (student: RosterStudent) => {
    try {
      await api.delete(`${base}/students/${student.id}`);
    } catch (error) {
      fail(error);
      removing.hide();
      void reload();
      return;
    }
    update((current) => {
      const remaining = studentRemoved(current, student.id);
      const sorted = sortStudents([...remaining.students, student], live.current.order);
      landing.current = controlAfterRemoval(sorted, student.id);
      closeWatchFor(student, remaining, sorted);
      return remaining;
    });
    announce(copy.removedStudent(student.nickname));
    removing.hide();
  };

  const addAssistant = async (email: string) => {
    const added = await api.post<ClassroomEducator>(`${base}/educators`, { email: email.trim() });
    update((current) => ({ ...current, educators: [...current.educators, added] }));
    announce(copy.addedAssistant(added.displayName));
  };

  const removeAssistant = async (educator: ClassroomEducator) => {
    try {
      await api.delete(`${base}/educators/${educator.id}`);
      landing.current = ASSISTANT_EMAIL_KEY;
      update((current) => ({ ...current, educators: current.educators.filter((other) => other.id !== educator.id) }));
      announce(copy.removedAssistant(educator.displayName));
    } catch (error) {
      fail(error);
    }
    removingAssistant.hide();
  };

  const joinCodeButton = (
    <button type="button" className="pill" onClick={() => setJoinCodeOpen(true)} {...controlProps(JOIN_CODE_KEY)}>Show join code</button>
  );
  const empty = classroom.students.length === 0;
  const { target: renameTarget } = renaming;
  const { target: removeTarget } = removing;
  const { target: assistantTarget } = removingAssistant;
  const zone = classroom.timeZone;

  return (
    <div className="column section classroom">
      <header className="classroom-head">
        <h1 ref={heading} tabIndex={-1}>{classroom.name}</h1>
        <span className="state-label">{STATE_LABELS[classroom.state]}</span>
        <div className="classroom-lines">
          <p>{copy.joinWindow(wireToDisplay(classroom.joinOpensLocal), wireToDisplay(classroom.joinClosesLocal), zone)}</p>
          <p>{copy.handInLine(wireToDisplay(classroom.handInLocal), zone)}</p>
        </div>
        <div className="pill-row">
          {empty ? null : joinCodeButton}
          {isOwner ? <button type="button" className="pill pill--outline" onClick={() => setTimesOpen(true)}>Edit times</button> : null}
          <button type="button" className="pill pill--outline" onClick={() => setHandInOpen(true)}>Hand in all projects</button>
          {isOwner ? <button type="button" className="pill pill--danger-quiet" onClick={() => void archive()}>Archive classroom</button> : null}
        </div>
      </header>

      <Roster
        students={students}
        order={order}
        onOrder={setOrder}
        timeZone={zone}
        onWatch={watch}
        onRename={renaming.show}
        onRemove={removing.show}
        joinCodeAction={joinCodeButton}
      />
      <Glancet student={watched} focusRequest={focusRequest} onClose={closeViewer} />

      <Instructors educators={classroom.educators} isOwner={isOwner} onAdd={addAssistant} onRemove={removingAssistant.show} />
      <HandInFiles classroomId={id} />

      <JoinCodeDialog open={joinCodeOpen} code={classroom.joinCode} onNewCode={() => void newCode()} onClose={() => setJoinCodeOpen(false)} />
      <TimesDialog open={timesOpen} classroom={classroom} onSave={saveTimes} onCancel={() => setTimesOpen(false)} />
      {renameTarget ? (
        <RenameDialog open={renaming.open} student={renameTarget} onSave={(nickname) => renameStudent(renameTarget, nickname)} onCancel={renaming.hide} returnFocus={takeLanding} />
      ) : null}
      {removeTarget ? (
        <ConfirmDialog
          open={removing.open}
          title={`Remove ${removeTarget.nickname}?`}
          body="They lose access to this classroom, and their projects and files are deleted. Their nickname becomes free."
          confirmLabel="Remove from classroom"
          onConfirm={() => removeStudent(removeTarget)}
          onCancel={removing.hide}
          returnFocus={takeLanding}
        />
      ) : null}
      {assistantTarget ? (
        <ConfirmDialog
          open={removingAssistant.open}
          title={`Remove ${assistantTarget.displayName}?`}
          body="They lose access to this classroom and its Students' projects."
          confirmLabel="Remove from classroom"
          onConfirm={() => removeAssistant(assistantTarget)}
          onCancel={removingAssistant.hide}
          returnFocus={takeLanding}
        />
      ) : null}
      <ConfirmDialog
        open={handInOpen}
        title="Hand in all projects?"
        body="Every Student's projects become read-only now. This cannot be undone."
        confirmLabel="Hand in now"
        onConfirm={handInAll}
        onCancel={() => setHandInOpen(false)}
      />
    </div>
  );
}
