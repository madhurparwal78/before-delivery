import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { icon, type IconName } from '../../shared/icons';
import type { MeJson, SiteJson } from '../../shared/types';
import { api } from './api';
import { openDialog, type OpenDialog } from '../shared/dialog';
import { bindThemeSwitch } from '../shared/theme';

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <span class="icon-wrap" dangerouslySetInnerHTML={{ __html: icon(name, size) }} />;
}

/** A native modal dialog named by its heading, with Tab kept inside and focus returned to the opener. */
export function Modal(props: { title: string; onClose: () => void; returnTo?: HTMLElement | null; focusHeading?: boolean; children: ComponentChildren; class?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const session = useRef<OpenDialog | null>(null);
  const close = useRef(props.onClose);
  close.current = props.onClose;
  const opener = useRef(props.returnTo ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  useLayoutEffect(() => {
    const element = dialog.current as HTMLDialogElement;
    session.current = openDialog(element, {
      returnTo: opener.current,
      focus: props.focusHeading ? heading.current : null,
      onClose: () => close.current(),
    });
    return () => session.current?.close();
  }, []);
  const id = `dialog-${props.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
  return (
    <dialog ref={dialog} class={`modal ${props.class ?? ''}`} aria-labelledby={id}>
      <h2 id={id} ref={heading} tabIndex={-1}>
        {props.title}
      </h2>
      {props.children}
    </dialog>
  );
}

export function ThemeSwitch() {
  const group = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (group.current) {
      bindThemeSwitch(group.current);
    }
  }, []);
  return (
    <div class="theme-switch" role="radiogroup" aria-label="Theme" ref={group}>
      {(
        [
          ['light', 'Light', 'sun'],
          ['dark', 'Dark', 'moon'],
          ['system', 'System', 'monitor'],
        ] as const
      ).map(([value, label, glyph]) => (
        <label class="theme-option" key={value}>
          <input type="radio" name="theme" value={value} defaultChecked={value === 'system'} />
          <Icon name={glyph} size={16} />
          <span>{label}</span>
        </label>
      ))}
    </div>
  );
}

export function signOut(): void {
  void api('DELETE', '/api/session').then(() => location.assign('/signin'));
}

/** Where the Editor and Analytics links of a team's first site lead. */
export function siteLinks(sites: SiteJson[]): { editorHref: string | null; analyticsHref: string | null } {
  const [site] = sites;
  const version = site?.versions.find((candidate) => candidate.default) ?? site?.versions[0];
  return {
    editorHref: site && version ? `/app/sites/${site.slug}/${version.slug}/pages/` : null,
    analyticsHref: site ? `/app/sites/${site.slug}/analytics` : null,
  };
}

type AppScreen = 'home' | 'team' | 'analytics' | 'redirects';

/** The header of the screens that are not the editor page itself: the same links everywhere, the current one marked. */
export function AppHeader(props: { me: MeJson; current: AppScreen; editorHref: string | null; analyticsHref: string | null; children?: ComponentChildren }) {
  const link = (screen: AppScreen, href: string, label: string) => (
    <a class="button" href={href} aria-current={props.current === screen ? 'page' : undefined}>
      {label}
    </a>
  );
  return (
    <header class="topbar">
      <div class="topbar-row">
        <div class="titles">
          <a class="site-name" href="/app" aria-current={props.current === 'home' ? 'page' : undefined}>
            Galley
          </a>
          <span class="version-name">{props.me.team.name}</span>
        </div>
        <div class="topbar-end">
          {props.editorHref && (
            <a class="button" href={props.editorHref}>
              Editor
            </a>
          )}
          {props.analyticsHref && link('analytics', props.analyticsHref, 'Analytics')}
          {props.me.role === 'owner' && link('team', '/app/team', 'Team')}
          <ThemeSwitch />
          <button type="button" class="button" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}

/** Mark the field a failure concerns. */
export function fieldProps(id: string, message: string | undefined) {
  return message ? { 'aria-invalid': 'true' as const, 'aria-describedby': `${id}-error` } : {};
}

export function FieldError(props: { id: string; message: string | undefined }) {
  return props.message ? (
    <p class="field-error" id={`${props.id}-error`}>
      {props.message}
    </p>
  ) : null;
}
