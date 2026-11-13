import { useEffect } from 'react';
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from 'react';
import { matchPage, type PageName } from '../shared/pages.ts';
import { navigate, usePath } from './history.ts';
import { AuthPage } from './pages/AuthPage.tsx';
import { FoldersPage } from './pages/FoldersPage.tsx';
import { LandingPage } from './pages/LandingPage.tsx';
import { NotFoundPage } from './pages/NotFoundPage.tsx';
import { DrawingPage } from './drawing/DrawingPage.tsx';
import { ReviewPage } from './review/ReviewPage.tsx';
import { ViewLinkPage } from './review/ViewLinkPage.tsx';

// Pages by path (the paths live in shared/pages.ts, which the server also uses). Links inside the app use <Link to>; code navigates with navigate(path) from ./history.ts.

interface PageView {
  /** the document title, so every screen names itself */
  title: string;
  render: (params: readonly string[]) => ReactNode;
}

const PAGE_VIEWS: Record<PageName, PageView> = {
  landing: { title: 'Plotfold', render: () => <LandingPage /> },
  register: { title: 'Create account – Plotfold', render: () => <AuthPage mode="register" /> },
  signin: { title: 'Sign in – Plotfold', render: () => <AuthPage mode="signin" /> },
  folders: { title: 'Folders – Plotfold', render: () => <FoldersPage /> },
  drawing: { title: 'Drawing – Plotfold', render: ([id]) => <DrawingPage id={id} /> },
  review: { title: 'Review – Plotfold', render: ([id]) => <ReviewPage id={id} /> },
  viewLink: { title: 'Shared version – Plotfold', render: ([token]) => <ViewLinkPage token={token} /> },
};

interface Resolved { title: string; page: ReactNode }

function resolve(path: string): Resolved {
  const match = matchPage(path);
  if (!match) return { title: 'Not found – Plotfold', page: <NotFoundPage /> };
  const view = PAGE_VIEWS[match.page];
  return { title: view.title, page: view.render(match.params.map(decodeURIComponent)) };
}

/** Renders the page for the current location. */
export function Router() {
  const { title, page } = resolve(usePath());
  useEffect(() => {
    document.title = title;
  }, [title]);
  return <>{page}</>;
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { to: string };

/** An anchor that navigates inside the app without a reload; modified clicks keep the browser's behaviour. */
export function Link({ to, onClick, ...rest }: LinkProps) {
  function follow(event: MouseEvent<HTMLAnchorElement>): void {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  }
  return <a href={to} onClick={follow} {...rest} />;
}
