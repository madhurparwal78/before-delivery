// The client entry: routes, session bootstrap and the auth listener.
import { route, startRouter, navigate } from './router.js';
import { registerCalendarRoutes, registerDropPublicRoute } from './calendar.js';
import { registerAuthRoutes } from './auth-screens.js';
import { registerPlannerRoute } from './planner.js';
import { registerClaimRoutes } from './claim-press.js';
import { apiOk, ROLE_HOME, type MemberOut } from './api.js';

registerCalendarRoutes();
registerDropPublicRoute();
registerAuthRoutes();
registerPlannerRoute();
registerClaimRoutes();

// Staff routes live behind the session; the shared staff module registers them.
void (async () => {
  const { registerStaffRoutes } = await import('./staff.js');
  registerStaffRoutes();
})();

// On sign-in, remember the member so staff screens know their role.
document.addEventListener('hourline:signed-in', (e: Event) => {
  const member = (e as CustomEvent<MemberOut>).detail;
  void (async () => {
    const helpers = await import('./staff-helpers.js');
    helpers.ensureMember();
    void helpers; void member;
  })();
});

// A 401 mid-action leads to the sign-in screen, keeping the current path.
document.addEventListener('hourline:auth', (e: Event) => {
  const fail = (e as CustomEvent<{ code: string }>).detail;
  void navigate(`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`, { wipe: true });
  void fail;
});

// Restore the session on load so a reload of a staff path stays signed in.
void (async () => {
  try {
    const res = await apiOk<{ member: MemberOut }>('GET', '/api/auth/session');
    const helpers = await import('./staff-helpers.js');
    helpers.ensureMember();
    void res;
    void ROLE_HOME;
  } catch { /* signed out */ }
})();

startRouter();
