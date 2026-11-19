import { useEffect, useState, useCallback, ReactNode, MouseEvent } from "react";

/** A tiny same-origin router: path segments and history push. */

export function useRoute(): { path: string; segments: string[] } {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = (): void => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return { path, segments: path.split("/").filter(s => s.length > 0) };
}

export function navigate(path: string, replace = false): void {
  if (replace) window.history.replaceState({}, "", path);
  else window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function useNavigate(): (path: string, replace?: boolean) => void {
  return useCallback((path: string, replace = false) => navigate(path, replace), []);
}

/** An anchor that routes in place. */
export function Link(props: { to: string; className?: string; children: ReactNode; ariaCurrent?: "page" | undefined }): ReactNode {
  const href = props.to;
  const onClick = (e: MouseEvent): void => {
    e.preventDefault();
    navigate(props.to);
  };
  const current = window.location.pathname === href;
  return (
    <a
      href={href}
      className={props.className}
      onClick={onClick}
      aria-current={props.ariaCurrent ?? (current ? "page" : undefined)}
    >
      {props.children}
    </a>
  );
}
