import { api } from './api.js';
import { signInPage, signUpPage } from './pages/auth.js';
import { classPage, classesPage } from './pages/classes.js';
import { classroomPage } from './pages/classroom.js';
import { lessonPage } from './pages/lesson.js';
import { roomEditorPage } from './pages/roomEditor.js';
import { joinPage, notFoundPage, reviewPage, summaryPage } from './pages/simple.js';
import { navigate } from './shell.js';

const mount = document.querySelector<HTMLElement>('#app');
let current: HTMLElement | null = null;

function show(page: HTMLElement): void {
  if (mount === null) return;
  current?.dispatchEvent(new CustomEvent('slatehall:leave'));
  current = page;
  mount.replaceChildren(page);
}

function pageFor(path: string): HTMLElement | null {
  const parts = path.split('/').filter((part) => part !== '');
  const [first, second, third] = parts;
  if (parts.length === 0 || first === undefined) return null;
  if (parts.length === 1) {
    if (first === 'sign-up') return signUpPage();
    if (first === 'sign-in') return signInPage();
    if (first === 'classes') return classesPage();
    if (first === 'join') return joinPage();
    return notFoundPage();
  }
  if (first === 'classes' && second !== undefined) {
    if (parts.length === 2) return classPage(second);
    if (parts.length === 3 && third === 'room') return roomEditorPage(second);
  }
  if (first === 'lessons' && second !== undefined && parts.length === 2) return lessonPage(second);
  if (first === 'sessions' && second !== undefined) {
    if (parts.length === 2) return classroomPage(second);
    if (parts.length === 3 && third === 'summary') return summaryPage(second);
  }
  if (first === 'review' && second !== undefined && parts.length === 2) return reviewPage(second);
  return notFoundPage();
}

function render(): void {
  const page = pageFor(location.pathname);
  if (page !== null) {
    show(page);
    return;
  }
  void (async () => {
    const answer = await api.get<{ role: string }>('/api/me');
    if (answer.error !== null) {
      navigate('/sign-in');
      return;
    }
    navigate(answer.body.role === 'teacher' ? '/classes' : '/join');
  })();
}

addEventListener('popstate', render);
render();
