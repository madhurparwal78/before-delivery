import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { banners, errorSummaryLine } from '../../shared/copy';
import { useApp } from '../state/store';
import { focusIds } from '../state/focus';

export type Layout = 'desk' | 'tablet' | 'phone';

function readLayout(): Layout {
  if (window.matchMedia('(min-width: 1024px)').matches) return 'desk';
  if (window.matchMedia('(min-width: 600px)').matches) return 'tablet';
  return 'phone';
}

export function useLayout(): Layout {
  const [layout, setLayout] = useState<Layout>(() => readLayout());
  useEffect(() => {
    const update = (): void => setLayout(readLayout());
    window.addEventListener('resize', update);
    update();
    return () => window.removeEventListener('resize', update);
  }, []);
  return layout;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = (): void => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

const focusableSelector =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap(
  containerRef: React.RefObject<HTMLElement | null>,
  active: boolean,
): void {
  useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return;
      const container = containerRef.current;
      if (!container) return;
      const focusable = [...container.querySelectorAll<HTMLElement>(focusableSelector)].filter(
        (element) => element.offsetParent !== null || element === document.activeElement,
      );
      if (focusable.length === 0) return;
      const first = focusable[0] as HTMLElement;
      const last = focusable[focusable.length - 1] as HTMLElement;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [containerRef, active]);
}

export interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  initialFocusId?: string;
}

export function Dialog({ title, onClose, children, initialFocusId }: DialogProps): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(containerRef, true);

  useEffect(() => {
    const app = document.getElementById('app');
    app?.setAttribute('inert', '');
    app?.setAttribute('aria-hidden', 'true');
    return () => {
      app?.removeAttribute('inert');
      app?.removeAttribute('aria-hidden');
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const preferred = initialFocusId ? document.getElementById(initialFocusId) : null;
    const target =
      preferred ?? container.querySelector<HTMLElement>(focusableSelector) ?? container;
    target.focus();
  }, [initialFocusId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  return createPortal(
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} ref={containerRef}>
        <h2 className="dialog-title">{title}</h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export interface FieldError {
  field: string;
  message: string;
}

export function ErrorSummary({
  form,
  errors,
}: {
  form: string;
  errors: FieldError[];
}): ReactElement | null {
  if (errors.length === 0) return null;
  return (
    <div className="error-summary" role="alert" id={focusIds.errorSummary(form)} tabIndex={-1}>
      <p className="error-summary-line">{errorSummaryLine}</p>
      <ul>
        {errors.map((error) => (
          <li key={error.field}>
            <a
              href={`#${form}-${error.field}`}
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(`${form}-${error.field}`)?.focus();
              }}
            >
              {error.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FieldMessage({ message }: { message?: string }): ReactElement | null {
  if (!message) return null;
  return <p className="field-message">{message}</p>;
}

export function PendingMark(): ReactElement {
  return <span className="pending-mark" aria-hidden="true" />;
}

export function LiveRegions(): ReactElement {
  const { announcement, teamUpdates } = useApp();
  return (
    <>
      <div className="live-region" role="status" aria-label="Announcements">
        {announcement}
      </div>
      <div className="live-region" role="status" aria-label="Team updates">
        {teamUpdates}
      </div>
    </>
  );
}

export function ServiceBanners(): ReactElement | null {
  const { status, refreshStatus, refreshPlacements, refreshObjects } = useApp();
  const services = status.services;
  const retry = useCallback(() => {
    void refreshStatus();
    void refreshPlacements().catch(() => undefined);
    void refreshObjects().catch(() => undefined);
  }, [refreshObjects, refreshPlacements, refreshStatus]);

  useEffect(() => {
    if (services.database !== 'down') return undefined;
    const timer = window.setTimeout(() => {
      document.getElementById(focusIds.databaseRetry)?.focus();
    }, 0);
    const keepFocus = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return;
      event.preventDefault();
      document.getElementById(focusIds.databaseRetry)?.focus();
    };
    document.addEventListener('keydown', keepFocus, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', keepFocus, true);
    };
  }, [services.database]);

  if (
    services.database === 'up' &&
    services.imageStore === 'up' &&
    services.mailRelay === 'up'
  ) {
    return null;
  }
  return (
    <div className="banners">
      {services.database === 'down' ? (
        <div className="banner" role="alert">
          <span>{banners.database}</span>
          <button type="button" id={focusIds.databaseRetry} onClick={retry}>
            Try again
          </button>
        </div>
      ) : null}
      {services.imageStore === 'down' ? (
        <div className="banner" role="alert">
          {banners.imageStore}
        </div>
      ) : null}
      {services.mailRelay === 'down' ? (
        <div className="banner" role="alert">
          {banners.mailRelay}
        </div>
      ) : null}
    </div>
  );
}

export function SkipLink(): ReactElement {
  return (
    <a
      className="skip-link"
      href="#main"
      onClick={(event) => {
        event.preventDefault();
        const main = document.getElementById('main');
        main?.focus();
      }}
    >
      Skip to main content
    </a>
  );
}

export function ViewGroup({ className }: { className?: string }): ReactElement {
  const { viewParam, chooseView } = useApp();
  const current = viewParam === 'wall' ? 'wall' : viewParam === 'plan' ? 'plan' : 'light';
  return (
    <div className={`view-group${className ? ` ${className}` : ''}`} role="group" aria-label="View">
      {(['plan', 'wall', 'light'] as const).map((view) => (
        <button
          key={view}
          type="button"
          aria-pressed={current === view}
          onClick={() => chooseView(view)}
        >
          {view === 'plan' ? 'Plan' : view === 'wall' ? 'Wall' : 'Light'}
        </button>
      ))}
    </div>
  );
}

export function Header({
  showViewGroup,
  extra,
}: {
  showViewGroup: boolean;
  extra?: ReactNode;
}): ReactElement {
  const { staffList, staffId, setStaffId, unit, setUnit, path, navigate } = useApp();
  const layout = useLayout();
  return (
    <header className="staff-header">
      <SkipLink />
      <span className="product-name">Hangline</span>
      <nav aria-label="Sections">
        <a
          href="/"
          aria-current={path === '/' ? 'page' : undefined}
          onClick={(event) => {
            event.preventDefault();
            navigate('/');
          }}
        >
          Gallery
        </a>
        <a
          href="/records"
          aria-current={path.startsWith('/records') ? 'page' : undefined}
          onClick={(event) => {
            event.preventDefault();
            navigate('/records');
          }}
        >
          Loan register
        </a>
      </nav>
      <label className="staff-picker">
        <span>Working as</span>
        <select value={staffId} onChange={(event) => setStaffId(event.target.value)}>
          {staffList.map((member) => (
            <option key={member.id} value={member.id}>
              {`${member.name} (${member.role})`}
            </option>
          ))}
        </select>
      </label>
      <div className="units-toggle" role="radiogroup" aria-label="Units">
        {(['cm', 'in'] as const).map((value) => (
          <label key={value}>
            <input
              type="radio"
              name="units"
              value={value}
              checked={unit === value}
              onChange={() => setUnit(value)}
            />
            <span>{value}</span>
          </label>
        ))}
      </div>
      {showViewGroup && layout !== 'phone' ? <ViewGroup /> : null}
      {extra}
    </header>
  );
}
