import { signinPage, signupPage, shelfPage, verifyPage } from './pages/account';
import { collectionPage, collectionsPage } from './pages/collections';
import { dashboardPage } from './pages/dashboard';
import { editorPage } from './pages/editor';
import { embedPage } from './pages/embed';
import { explorePage } from './pages/explore';
import { historyPage } from './pages/history';
import { landingPage } from './pages/landing';
import { mount, route } from './router';
import { loadSession } from './store';

route('/', landingPage);
route('/signup', signupPage);
route('/signin', signinPage);
route('/verify', verifyPage);
route('/dashboard', dashboardPage);
route('/explore', explorePage);
route('/collections', collectionsPage);
route('/collections/:id', collectionPage);
route('/shelf', shelfPage);
route('/pen/:id', editorPage);
route('/pen/:id/history', historyPage);
route('/embed/:id', embedPage);

const start = async (): Promise<void> => {
  await loadSession();
  mount();
};

void start();
