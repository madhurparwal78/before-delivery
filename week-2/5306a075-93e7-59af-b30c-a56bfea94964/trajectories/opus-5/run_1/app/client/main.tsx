import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/fraunces/latin-600.css';
import './styles.css';
import { AppProvider, useApp } from './app-state';
import { Shell } from './components/Shell';
import { Companies, CompanyDetail } from './screens/Companies';
import { FeatureDetail } from './screens/FeatureDetail';
import { Features } from './screens/Features';
import { Import } from './screens/Import';
import { Inbox } from './screens/Inbox';
import { Invite } from './screens/Invite';
import { Roadmap } from './screens/Roadmap';
import { Settings } from './screens/Settings';
import { SignIn } from './screens/SignIn';
import { navigate, useRoute } from './router';

function Screen(): JSX.Element | null {
  const route = useRoute();
  if (route.startsWith('/inbox')) return <Inbox />;
  if (route === '/features') return <Features />;
  if (route.startsWith('/features/')) return <FeatureDetail />;
  if (route === '/roadmap') return <Roadmap />;
  if (route === '/companies') return <Companies />;
  if (route.startsWith('/companies/')) return <CompanyDetail />;
  if (route === '/import') return <Import />;
  if (route === '/settings') return <Settings />;
  return null;
}

function Routes(): JSX.Element | null {
  const app = useApp();
  const route = useRoute();

  useEffect(() => {
    if (!app.ready) return;
    if (app.user === null && route !== '/signin' && !route.startsWith('/invite/')) navigate('/signin');
    if (app.user !== null && (route === '/signin' || route === '/')) navigate('/inbox');
  }, [app.ready, app.user, route]);

  if (route.startsWith('/invite/')) return <Invite />;
  if (!app.ready) return null;
  if (app.user === null) return <SignIn />;
  return (
    <Shell>
      <Screen />
    </Shell>
  );
}

const container = document.getElementById('root');
if (container !== null) {
  createRoot(container).render(
    <StrictMode>
      <AppProvider>
        <Routes />
      </AppProvider>
    </StrictMode>,
  );
}
