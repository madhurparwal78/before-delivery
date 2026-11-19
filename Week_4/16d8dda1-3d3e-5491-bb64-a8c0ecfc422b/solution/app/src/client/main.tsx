import './styles.css';
import './pages/pages.css';
import './classroom/classroom.css';
import { StrictMode, useEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { loadMe } from './me';
import { navigate, usePath } from './router';
import { ClassPage } from './pages/ClassPage';
import { ClassesPage } from './pages/Classes';
import { JoinPage } from './pages/Join';
import { LessonPage } from './pages/LessonPage';
import { ReviewPage } from './pages/Review';
import { RoomEditorPage } from './pages/RoomEditor';
import { SignInPage } from './pages/SignIn';
import { SignUpPage } from './pages/SignUp';
import { SummaryPage } from './pages/Summary';
import { ClassroomPage } from './classroom/ClassroomPage';
import { NotFound } from './ui/feedback';

type Match = (parts: string[]) => ReactNode | undefined;

const routes: Match[] = [
  ([a]) => (a === undefined ? <Start /> : undefined),
  ([a, b]) => (a === 'sign-up' && b === undefined ? <SignUpPage /> : undefined),
  ([a, b]) => (a === 'sign-in' && b === undefined ? <SignInPage /> : undefined),
  ([a, b]) => (a === 'join' && b === undefined ? <JoinPage /> : undefined),
  ([a, b]) => (a === 'classes' && b === undefined ? <ClassesPage /> : undefined),
  ([a, b, c]) => (a === 'classes' && b && c === undefined ? <ClassPage classId={b} /> : undefined),
  ([a, b, c, d]) => (a === 'classes' && b && c === 'room' && d === undefined ? <RoomEditorPage classId={b} /> : undefined),
  ([a, b, c]) => (a === 'lessons' && b && c === undefined ? <LessonPage lessonId={b} /> : undefined),
  ([a, b, c]) => (a === 'sessions' && b && c === undefined ? <ClassroomPage sessionId={b} /> : undefined),
  ([a, b, c, d]) => (a === 'sessions' && b && c === 'summary' && d === undefined ? <SummaryPage sessionId={b} /> : undefined),
  ([a, b, c]) => (a === 'review' && b && c === undefined ? <ReviewPage sessionId={b} /> : undefined),
];

/** `/` sends a signed-in teacher to their classes and everyone else to the join page. */
function Start() {
  useEffect(() => {
    void loadMe().then((next) => navigate(next.state === 'signed-in' && next.me.role === 'teacher' ? '/classes' : '/join', true));
  }, []);
  return null;
}

function decodeParts(path: string): string[] | null {
  try {
    return path.split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
}

function App() {
  const parts = decodeParts(usePath());
  for (const match of routes) {
    const page = parts && match(parts);
    if (page) return page;
  }
  return <NotFound />;
}

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element.');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
