import { useCountdown } from "../lib/countdown";
import { useSession } from "../lib/session";
import { useSettling } from "../lib/settling";
import { ProjectLibrary } from "../projects/ProjectLibrary";
import "./pages.css";

export default function StudentHome() {
  const { account } = useSession();
  const { classroom, text } = useCountdown(account?.classroomId ?? null);
  useSettling(!classroom);
  if (!classroom) return null;
  return (
    <div className="column page-body">
      <p className="eyebrow">Your class</p>
      <h1>{classroom.name}</h1>
      <p className="countdown figures">{text}</p>
      <ProjectLibrary zone={classroom.timeZone} />
    </div>
  );
}
