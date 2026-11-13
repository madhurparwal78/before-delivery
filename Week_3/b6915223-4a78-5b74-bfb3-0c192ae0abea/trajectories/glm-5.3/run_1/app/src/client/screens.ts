export type Screen =
  | { name: 'signin' }
  | { name: 'team'; view: 'pitch' | 'list'; leagueId: string | null }
  | { name: 'transfers'; view: 'pitch' | 'list'; position: string; club: string; maxPrice: string; sort: string }
  | { name: 'leagues' }
  | { name: 'league'; leagueId: string }
  | { name: 'memberHistory'; leagueId: string; managerId: string }
  | { name: 'history' }
  | { name: 'operator' };

export function parseScreen(pathname: string, query: URLSearchParams): Screen {
  if (pathname === '/signin') return { name: 'signin' };
  if (pathname === '/team') {
    return { name: 'team', view: viewOf(query), leagueId: query.get('league') };
  }
  if (pathname === '/transfers') {
    return {
      name: 'transfers',
      view: viewOf(query),
      position: query.get('position') ?? 'All',
      club: query.get('club') ?? 'All',
      maxPrice: query.get('max_price') ?? 'Any',
      sort: query.get('sort') ?? 'price_desc',
    };
  }
  if (pathname === '/leagues') return { name: 'leagues' };
  if (pathname.startsWith('/leagues/')) {
    const parts = pathname.split('/').filter((part) => part !== '');
    if (parts.length === 3) return { name: 'league', leagueId: parts[1] };
    if (parts.length === 5) return { name: 'memberHistory', leagueId: parts[1], managerId: parts[3] };
  }
  if (pathname === '/history') return { name: 'history' };
  if (pathname === '/operator') return { name: 'operator' };
  return { name: 'team', view: 'pitch', leagueId: null };
}

function viewOf(query: URLSearchParams): 'pitch' | 'list' {
  return query.get('view') === 'list' ? 'list' : 'pitch';
}

export function pathOf(screen: Screen): string {
  switch (screen.name) {
    case 'signin':
      return '/signin';
    case 'team': {
      const params = new URLSearchParams();
      params.set('view', screen.view);
      if (screen.leagueId !== null) params.set('league', screen.leagueId);
      return `/team?${params.toString()}`;
    }
    case 'transfers': {
      const params = new URLSearchParams();
      params.set('view', screen.view);
      if (screen.position !== 'All') params.set('position', screen.position);
      if (screen.club !== 'All') params.set('club', screen.club);
      if (screen.maxPrice !== 'Any') params.set('max_price', screen.maxPrice);
      if (screen.sort !== 'price_desc') params.set('sort', screen.sort);
      return `/transfers?${params.toString()}`;
    }
    case 'leagues':
      return '/leagues';
    case 'league':
      return `/leagues/${screen.leagueId}`;
    case 'memberHistory':
      return `/leagues/${screen.leagueId}/members/${screen.managerId}`;
    case 'history':
      return '/history';
    case 'operator':
      return '/operator';
  }
}
