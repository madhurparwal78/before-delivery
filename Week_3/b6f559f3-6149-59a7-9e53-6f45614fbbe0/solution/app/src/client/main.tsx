import { createRoot } from 'react-dom/client';
import './tokens.css';
import { parseRoute, usePath } from './router';
import { SessionProvider } from './session';
import { Editor } from './screens/Editor';
import { Invite } from './screens/Invite';
import { Landing } from './screens/Landing';
import { Missing } from './screens/Missing';
import { Projects } from './screens/Projects';
import { SignIn } from './screens/SignIn';

function Screens() {
  const route = parseRoute(usePath());
  switch (route.name) {
    case 'landing':
      return <Landing />;
    case 'signin':
      return <SignIn />;
    case 'projects':
      return <Projects />;
    case 'editor':
      return <Editor key={route.projectId} projectId={route.projectId} />;
    case 'invite':
      return <Invite token={route.token} />;
    case 'missing':
      return <Missing />;
  }
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <SessionProvider>
    <Screens />
  </SessionProvider>,
);
