import './styles.css';
import type { GuideReading, User, Working } from '../shared/types';
import { fontsReady } from './fonts';
import { mountConfirm, mountSignIn, mountSignUp } from './pages/auth';
import { mountHome } from './pages/home';
import { mountCollection } from './pages/collection';
import { mountDashboard } from './pages/dashboard';
import { mountSearch } from './pages/search';
import { mountEditor } from './editor/editor';
import { Reader, type ReadingGuide } from './reader/reader';

interface Boot {
  page: 'home' | 'reader' | 'embed' | 'editor' | 'dashboard' | 'search' | 'collection' | 'signin' | 'signup' | 'confirm';
  user: User | null;
  guide?: (GuideReading & { fork_source_slug: string | null }) | null;
  working?: Working;
  role?: 'owner' | 'coauthor';
  id?: string;
  ownerId?: string;
}

const boot = JSON.parse(document.getElementById('boot')?.textContent ?? '{"page":"home","user":null}') as Boot;
const app = document.getElementById('app') ?? document.body;
document.documentElement.style.setProperty('--H', `${innerHeight}px`);
await fontsReady();

switch (boot.page) {
  case 'home': mountHome(app, (boot.guide as ReadingGuide | null) ?? null, boot.user); break;
  case 'reader':
  case 'embed': new Reader(boot.guide as ReadingGuide, boot.user, boot.page).mount(app); break;
  case 'signin': mountSignIn(app); break;
  case 'signup': mountSignUp(app); break;
  case 'confirm': void mountConfirm(app, boot.user); break;
  case 'dashboard': mountDashboard(app, boot.user); break;
  case 'search': mountSearch(app); break;
  case 'collection': void mountCollection(app, boot.id!, boot.ownerId!, boot.user); break;
  case 'editor': void mountEditor(app, boot.working!, boot.user!, boot.role!); break;
}
