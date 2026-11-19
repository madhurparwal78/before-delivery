import { useEffect, useState } from "react";
import { Plus, Users } from "lucide-react";
import { STATE_LABELS } from "../../shared/copy";
import type { Classroom } from "../../shared/types";
import { api, ApiError } from "../lib/api";
import { Link } from "../lib/router";
import { useSettling } from "../lib/settling";
import { useStatus } from "../lib/status";
import { useStreamEvent } from "../lib/stream";
import { Doodle } from "../projects/Doodle";
import { ProjectLibrary } from "../projects/ProjectLibrary";
import { CreateClassroomDialog } from "./CreateClassroomDialog";
import "./pages.css";

const FIRST_ZONE = "America/Chicago";

/** The card's facts are a list of their own, named for the classroom, so each card is a list inside the `Classrooms` list. */
function ClassroomCard({ classroom }: { classroom: Classroom }) {
  const count = classroom.students.length;
  return (
    <li className="card classroom-card">
      <ul className="classroom-facts" aria-label={`Classrooms: ${classroom.name}`}>
        <li><span className={`state-chip state-chip--${classroom.state}`}>{STATE_LABELS[classroom.state]}</span></li>
        <li><Link className="stretch-link classroom-name" to={`/classrooms/${classroom.id}`}>{classroom.name}</Link></li>
        <li className="hint classroom-count">
          <Users size={16} aria-hidden="true" />
          <span><span className="figures">{count}</span> {count === 1 ? "student" : "students"}</span>
        </li>
      </ul>
    </li>
  );
}

export default function Dashboard() {
  const { announce } = useStatus();
  const [classrooms, setClassrooms] = useState<Classroom[] | null>(null);
  const [creating, setCreating] = useState(false);
  useSettling(classrooms === null);

  useEffect(() => {
    api.get<{ classrooms: Classroom[] }>("/api/classrooms").then(
      (body) => setClassrooms(body.classrooms),
      (error: unknown) => { if (error instanceof ApiError) announce(error.message); setClassrooms([]); },
    );
  }, [announce]);

  const update = (id: string, change: (classroom: Classroom) => Classroom) =>
    setClassrooms((current) => current && current.map((room) => (room.id === id ? change(room) : room)));

  useStreamEvent("classroom-state", (event) =>
    update(event.classroomId, (room) => ({ ...room, state: event.state, serverNow: event.serverNow, secondsToHandIn: event.secondsToHandIn })));
  useStreamEvent("student-joined", (event) =>
    update(event.classroomId, (room) => (room.students.some((s) => s.id === event.student.id)
      ? room
      : { ...room, students: [...room.students, { id: event.student.id, nickname: event.student.nickname, handedIn: false, latestProject: null }] })));
  useStreamEvent("student-removed", (event) =>
    update(event.classroomId, (room) => ({ ...room, students: room.students.filter((s) => s.id !== event.studentId) })));

  const open = () => setCreating(true);
  const lastZone = classrooms?.find((room) => room.role === "owner")?.timeZone ?? FIRST_ZONE;

  return (
    <div className="column page-body">
      <h1>Dashboard</h1>
      <section className="home-section" aria-labelledby="classrooms-heading">
        <div className="section-head">
          <h2 id="classrooms-heading">Classrooms</h2>
          {classrooms && classrooms.length > 0 ? (
            <button className="pill" type="button" onClick={open}><Plus size={20} aria-hidden="true" />Create classroom</button>
          ) : null}
        </div>
        {classrooms === null ? null : classrooms.length > 0 ? (
          <ul className="card-grid card-grid--3" aria-label="Classrooms">
            {classrooms.map((classroom) => <ClassroomCard key={classroom.id} classroom={classroom} />)}
          </ul>
        ) : (
          <div className="empty-state">
            <Doodle />
            <p>No classrooms yet. Create one to get a join code for your class.</p>
            <button className="pill" type="button" onClick={open}><Plus size={20} aria-hidden="true" />Create classroom</button>
          </div>
        )}
      </section>
      <ProjectLibrary />
      <CreateClassroomDialog open={creating} defaultZone={lastZone} onClose={() => setCreating(false)} />
    </div>
  );
}
