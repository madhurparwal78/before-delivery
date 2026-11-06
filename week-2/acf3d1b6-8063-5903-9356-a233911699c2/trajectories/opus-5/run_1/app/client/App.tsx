import { LocationProvider, Route, Router } from 'preact-iso';
import { ToastProvider } from './components/ui';
import { AuthProvider } from './store';
import { Home } from './pages/Home';
import { Product } from './pages/Product';
import { Pricing } from './pages/Pricing';
import { TeamPlan } from './pages/TeamPlan';
import { Enterprise, EnterpriseContact, ModelLicensing } from './pages/EnterprisePages';
import { Examples } from './pages/Examples';
import { NotFound, Privacy, Research, Resources, UseCases, Workflows } from './pages/Library';
import { Invite, Login, Signup } from './pages/Auth';
import { StudioHome } from './studio/StudioHome';
import { ProjectTimeline, Projects } from './studio/Projects';
import { GenerationPage } from './studio/GenerationPage';
import { Credits } from './studio/Credits';
import { Team } from './studio/Team';

export function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <LocationProvider>
          <Router>
            <Route path="/" component={Home} />
            <Route path="/product" component={Product} />
            <Route path="/pricing" component={Pricing} />
            <Route path="/team-plan" component={TeamPlan} />
            <Route path="/enterprise" component={Enterprise} />
            <Route path="/enterprise-contact" component={EnterpriseContact} />
            <Route path="/model-licensing" component={ModelLicensing} />
            <Route path="/examples" component={Examples} />
            <Route path="/use-cases" component={UseCases} />
            <Route path="/workflows" component={Workflows} />
            <Route path="/research" component={Research} />
            <Route path="/resources" component={Resources} />
            <Route path="/privacy" component={Privacy} />
            <Route path="/signup" component={Signup} />
            <Route path="/login" component={Login} />
            <Route path="/invite/:token" component={Invite} />
            <Route path="/studio" component={StudioHome} />
            <Route path="/studio/projects" component={Projects} />
            <Route path="/studio/projects/:id" component={ProjectTimeline} />
            <Route path="/studio/generations/:id" component={GenerationPage} />
            <Route path="/studio/credits" component={Credits} />
            <Route path="/studio/team" component={Team} />
            <Route default component={NotFound} />
          </Router>
        </LocationProvider>
      </AuthProvider>
    </ToastProvider>
  );
}
