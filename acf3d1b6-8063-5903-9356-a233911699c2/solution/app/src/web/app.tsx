import { createContext, type ComponentType } from 'preact';
import { useContext } from 'preact/hooks';
import { LocationProvider, Route, Router } from 'preact-iso';
import { exec } from 'preact-iso/router';
import { InvitePage, LoginPage, SignupPage } from './account/account.js';
import type { Area, PageData } from './data.js';
import { PublicLayout } from './public/chrome.js';
import { ExamplesPage } from './public/examples.js';
import { HomePage } from './public/home.js';
import {
  EnterpriseContactPage,
  EnterprisePage,
  ModelLicensingPage,
  NotFoundPage,
  PrivacyPage,
  ResearchPage,
  ResourcesPage,
  TeamPlanPage,
  UseCasesPage,
  WorkflowsPage,
} from './public/pages.js';
import { PricingPage } from './public/pricing.js';
import { ProductPage } from './public/product.js';
import { SessionProvider, StudioLayout } from './studio/layout.js';
import { StudioHome } from './studio/home.js';
import { ProjectPage, ProjectsPage } from './studio/projects.js';
import { CreditsPage, GenerationPage, TeamPage } from './studio/pages.js';
import { ToastProvider } from './ui/toast.js';

interface Page {
  path: string;
  title: string;
  area: Area;
  component: ComponentType<{ params: Record<string, string> }>;
}

const inPublic = (Content: ComponentType) => () => (
  <PublicLayout>
    <Content />
  </PublicLayout>
);

const inStudio = (Content: ComponentType<{ id: string }>) => ({ params }: { params: Record<string, string> }) => (
  <StudioLayout>
    <Content id={params.id} />
  </StudioLayout>
);

/** The data the server sent with the first HTML. */
const PageDataContext = createContext<PageData>({});

function InviteRoute({ params }: { params: Record<string, string> }) {
  return <InvitePage token={params.token} initial={useContext(PageDataContext).invitation} />;
}

const PAGES: Page[] = [
  { path: '/', title: 'Kinora — Building Real-World Intelligence', area: 'public', component: inPublic(HomePage) },
  { path: '/product', title: 'Kinora Creative — the creative suite', area: 'public', component: inPublic(ProductPage) },
  { path: '/pricing', title: 'Pricing — Kinora', area: 'public', component: inPublic(PricingPage) },
  { path: '/team-plan', title: 'Kinora Team', area: 'public', component: inPublic(TeamPlanPage) },
  { path: '/enterprise', title: 'Kinora for Enterprise', area: 'public', component: inPublic(EnterprisePage) },
  { path: '/enterprise-contact', title: 'Contact sales — Kinora', area: 'public', component: inPublic(EnterpriseContactPage) },
  { path: '/model-licensing', title: 'Model licensing — Kinora', area: 'public', component: inPublic(ModelLicensingPage) },
  { path: '/examples', title: 'Examples — Kinora', area: 'public', component: inPublic(ExamplesPage) },
  { path: '/use-cases', title: 'Use cases — Kinora', area: 'public', component: inPublic(UseCasesPage) },
  { path: '/workflows', title: 'Kinora Workflows', area: 'public', component: inPublic(WorkflowsPage) },
  { path: '/research', title: 'Research — Kinora', area: 'public', component: inPublic(ResearchPage) },
  { path: '/resources', title: 'Resources — Kinora', area: 'public', component: inPublic(ResourcesPage) },
  { path: '/privacy', title: 'Privacy — Kinora', area: 'public', component: inPublic(PrivacyPage) },
  { path: '/signup', title: 'Create your account — Kinora', area: 'account', component: SignupPage },
  { path: '/login', title: 'Log in — Kinora', area: 'account', component: LoginPage },
  {
    path: '/invite/:token',
    title: 'Join a team — Kinora',
    area: 'invite',
    component: InviteRoute,
  },
  { path: '/studio', title: 'Studio — Kinora', area: 'studio', component: inStudio(StudioHome) },
  { path: '/studio/projects', title: 'Projects — Kinora Studio', area: 'studio', component: inStudio(ProjectsPage) },
  { path: '/studio/projects/:id', title: 'Project — Kinora Studio', area: 'studio', component: inStudio(ProjectPage) },
  { path: '/studio/generations/:id', title: 'Generation — Kinora Studio', area: 'studio', component: inStudio(GenerationPage) },
  { path: '/studio/credits', title: 'Credits — Kinora Studio', area: 'studio', component: inStudio(CreditsPage) },
  { path: '/studio/team', title: 'Team — Kinora Studio', area: 'studio', component: inStudio(TeamPage) },
];

const NOT_FOUND = { title: 'Page not found — Kinora', area: 'missing' as Area, params: {} as Record<string, string> };

/** The page an address shows, with its route parameters; anything else is not found. */
export function resolvePage(path: string): { title: string; area: Area; params: Record<string, string> } {
  for (const page of PAGES) {
    const match = exec(path, page.path);
    if (match) return { title: page.title, area: page.area, params: match.params };
  }
  return NOT_FOUND;
}

const studioPath = (href: string) => /^\/studio(\/|$|\?)/.test(href);

/** Links inside one area route in the page; a link into or out of the studio loads the page from the server. */
const sameArea = { test: (href: string) => studioPath(href) === studioPath(location.pathname) };

const Missing = inPublic(NotFoundPage);

export function App({ url, data }: { url?: string; data: PageData }) {
  const Provider = LocationProvider as ComponentType<{ url?: string; scope: unknown }>;
  return (
    <Provider url={url} scope={sameArea}>
      <PageDataContext.Provider value={data}>
      <ToastProvider>
        <SessionProvider initial={data.me}>
          <Router onRouteChange={(next) => (document.title = resolvePage(new URL(next, location.origin).pathname).title)}>
            {[...PAGES.map((page) => <Route key={page.path} path={page.path} component={page.component} />),
              <Route key="missing" default component={Missing} />]}
          </Router>
        </SessionProvider>
      </ToastProvider>
      </PageDataContext.Provider>
    </Provider>
  );
}
