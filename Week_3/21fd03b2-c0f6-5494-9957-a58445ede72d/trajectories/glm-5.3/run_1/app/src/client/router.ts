// Tiny routing layer: path-driven screens rendered into #root.

export type Route =
  | { name: 'landing' }
  | { name: 'sign-in'; invite?: string; return?: string }
  | { name: 'sign-up'; invite?: string }
  | { name: 'workspaces-new' }
  | { name: 'workspace'; wid: string }
  | { name: 'project'; wid: string; pid: string }
  | { name: 'editor'; wid: string; sid: string }
  | { name: 'settings'; wid: string }
  | { name: 'activity'; wid: string }
  | { name: 'invite'; token: string }
  | { name: 'lab'; token: string }
  | { name: 'view'; token: string }
  | { name: 'view-scene'; token: string; sid: string }
  | { name: 'not-found' };

export function parseRoute(pathname: string, search: string): Route {
  const params = new URLSearchParams(search);
  const parts = pathname.split('/').filter((p) => p.length > 0);
  if (parts.length === 0) return { name: 'landing' };
  if (parts[0] === 'sign-in') {
    const invite = params.get('invite');
    const ret = params.get('return');
    const route: Route = { name: 'sign-in' };
    if (invite !== null) route.invite = invite;
    if (ret !== null) route.return = ret;
    return route;
  }
  if (parts[0] === 'sign-up') {
    const invite = params.get('invite');
    const route: Route = { name: 'sign-up' };
    if (invite !== null) route.invite = invite;
    return route;
  }
  if (parts[0] === 'workspaces' && parts[1] === 'new') return { name: 'workspaces-new' };
  if (parts[0] === 'w') {
    const wid = parts[1] ?? '';
    if (parts.length === 2) return { name: 'workspace', wid };
    if (parts[2] === 'p' && parts[3]) return { name: 'project', wid, pid: parts[3] };
    if (parts[2] === 's' && parts[3]) return { name: 'editor', wid, sid: parts[3] };
    if (parts[2] === 'settings') return { name: 'settings', wid };
    if (parts[2] === 'activity') return { name: 'activity', wid };
    return { name: 'workspace', wid };
  }
  if (parts[0] === 'invite' && parts[1]) return { name: 'invite', token: parts[1] };
  if (parts[0] === 'lab' && parts[1]) return { name: 'lab', token: parts[1] };
  if (parts[0] === 'view' && parts[1]) {
    if (parts[2] === 's' && parts[3]) return { name: 'view-scene', token: parts[1], sid: parts[3] };
    return { name: 'view', token: parts[1] };
  }
  return { name: 'not-found' };
}

export function pathFor(route: Route): string {
  switch (route.name) {
    case 'landing': return '/';
    case 'sign-in': return '/sign-in';
    case 'sign-up': return '/sign-up';
    case 'workspaces-new': return '/workspaces/new';
    case 'workspace': return `/w/${route.wid}`;
    case 'project': return `/w/${route.wid}/p/${route.pid}`;
    case 'editor': return `/w/${route.wid}/s/${route.sid}`;
    case 'settings': return `/w/${route.wid}/settings`;
    case 'activity': return `/w/${route.wid}/activity`;
    case 'invite': return `/invite/${route.token}`;
    case 'lab': return `/lab/${route.token}`;
    case 'view': return `/view/${route.token}`;
    case 'view-scene': return `/view/${route.token}/s/${route.sid}`;
    case 'not-found': return '/not-found';
  }
}

export function navigate(path: string, replace = false): void {
  if (replace) {
    history.replaceState(null, '', path);
  } else {
    history.pushState(null, '', path);
  }
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function encodeReturn(pathname: string, search: string): string {
  // percent-encode everything except letters, digits and -_.!~*'()
  const raw = pathname + (search.length > 0 ? search : '');
  let out = '';
  const safe = /[A-Za-z0-9\-_.!~*'()]/;
  for (const ch of raw) {
    if (safe.test(ch)) out += ch;
    else {
      for (const byte of new TextEncoder().encode(ch)) {
        out += '%' + byte.toString(16).toUpperCase().padStart(2, '0');
      }
    }
  }
  return out;
}
