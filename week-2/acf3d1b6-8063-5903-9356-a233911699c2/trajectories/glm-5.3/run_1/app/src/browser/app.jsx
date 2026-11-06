// The app: routes for the public site and the signed-in studio.
import { LocationProvider, Router, useLocation } from 'preact-iso';
import { HomePage, ProductPage, PricingPage, TeamPlanPage, EnterprisePage,
  LicensingPage, ExamplesPage, UseCasesPage, WorkflowsPage, ResearchPage,
  ResourcesPage, PrivacyPage, NotFoundPage } from './public.jsx';
import { SignupPage, LoginPage, InvitePage, EnterpriseContactPage } from './forms.jsx';
import { StudioHomePage, StudioProjectsPage, StudioProjectPage,
  StudioGenerationPage, StudioCreditsPage, StudioTeamPage } from './studio.jsx';

function Routes({ navigate }) {
  return (
    <Router>
      <HomePage path="/" />
      <ProductPage path="/product" />
      <PricingPage path="/pricing" />
      <TeamPlanPage path="/team-plan" />
      <EnterprisePage path="/enterprise" />
      <EnterpriseContactPage path="/enterprise-contact" />
      <LicensingPage path="/model-licensing" />
      <ExamplesPage path="/examples" />
      <UseCasesPage path="/use-cases" />
      <WorkflowsPage path="/workflows" />
      <ResearchPage path="/research" />
      <ResourcesPage path="/resources" />
      <PrivacyPage path="/privacy" />
      <SignupPage path="/signup" navigate={navigate} />
      <LoginPage path="/login" navigate={navigate} />
      <InvitePage path="/invite/:token" navigate={navigate} />
      <StudioHomePage path="/studio" navigate={navigate} />
      <StudioProjectsPage path="/studio/projects" navigate={navigate} />
      <StudioProjectPage path="/studio/projects/:id" navigate={navigate} />
      <StudioGenerationPage path="/studio/generations/:id" navigate={navigate} />
      <StudioCreditsPage path="/studio/credits" navigate={navigate} />
      <StudioTeamPage path="/studio/team" navigate={navigate} />
      <NotFoundPage default />
    </Router>
  );
}

function RoutesWithNavigation() {
  const loc = useLocation();
  const navigate = (href) => loc.route(href);
  return <Routes navigate={navigate} />;
}

/** The whole app, server-rendered with `url` and hydrated in the browser. */
export function App({ url }) {
  return (
    <LocationProvider url={url}>
      <RoutesWithNavigation />
    </LocationProvider>
  );
}
