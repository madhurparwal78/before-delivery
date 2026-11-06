// The workspace console `/console/...` (brief: Screens and layout, Console; Interactions, Tab order).
import type { JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { ApiError, type Bucket, type Me, type Region, type Role, api, loadRegions } from "./api";
import { SUSPENDED_BANNER, generalCopy } from "./copy";
import { Dialog, Field, Status } from "./dialog";
import { Icon } from "./icons";
import { ObjectView, focusHeadingOf } from "./objects";
import { type Place, follow, navigate } from "./router";
import { SharedLinks } from "./share";
import { Team } from "./team";
import { AccessKeys } from "./keys";
import { UsagePage } from "./usage";
import { Deliveries, Webhooks } from "./webhooks";
import { Security } from "./security";

// Everything a console page needs to know about who is looking at which workspace.
export interface Scope {
  me: Me;
  ws: string;
  workspaceName: string;
  role: Role;
  regions: Region[];
  buckets: Bucket[];
  regionName: (id: string) => string;
  reloadBuckets: () => Promise<void>;
  // Copy for an answer no action-specific line covers; a suspension answer also raises the banner.
  report: (error: unknown) => string;
  setShareStatus: (text: string) => void;
}

const ISOLATION_COPY = "This bucket isn't in your workspace.";

const PAGES = {
  _links: "Share links", _team: "Team", _keys: "Access keys", _usage: "Usage", _webhooks: "Webhooks", _security: "Security",
} as const;
type PageId = keyof typeof PAGES;
const OWNER_PAGES: readonly PageId[] = ["_team", "_keys", "_usage", "_webhooks", "_security"];

function isPage(segment: string): segment is PageId {
  return segment in PAGES;
}

function placementNames(bucket: Bucket, regionName: (id: string) => string): string {
  return bucket.placement.map(regionName).join(", ");
}

interface RailProps {
  scope: Scope;
  bucket: string | null;
  page: PageId | null;
  objectsHref: string;
  onNavigate: () => void;
  onNewBucket: () => void;
}

function Rail({ scope, bucket, page, objectsHref, onNavigate, onNewBucket }: RailProps): JSX.Element {
  const go = (event: MouseEvent, href: string): void => {
    follow(event, href);
    onNavigate();
  };
  const canWrite = scope.role !== "viewer";
  const workspaceLinks: [string, string, boolean][] = [
    ["Objects", objectsHref, page === null],
    ...(Object.keys(PAGES) as PageId[])
      .filter((id) => scope.role === "owner" || !OWNER_PAGES.includes(id))
      .map((id): [string, string, boolean] => [PAGES[id], `/console/${scope.ws}/${id}`, page === id]),
  ];
  return (
    <div class="rail">
      <p class="rail__workspace">{scope.workspaceName}</p>
      <nav aria-label="Buckets" class="rail__section rail__section--buckets">
        <h2 class="rail__heading" aria-hidden="true">
          Buckets
        </h2>
        <ul class="rail__list">
          {scope.buckets.map((b) => {
            const href = `/console/${scope.ws}/${b.name}`;
            return (
              <li key={b.name}>
                <a
                  class="rail__bucket"
                  href={href}
                  aria-current={b.name === bucket && page === null ? "page" : undefined}
                  onClick={(e) => go(e, href)}
                >
                  <span class="rail__bucket-name">{b.name}</span>
                  <span class="rail__placement">{placementNames(b, scope.regionName)}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
      {canWrite && (
        <button type="button" class="button rail__new" onClick={onNewBucket}>
          <Icon name="plus" />
          New bucket
        </button>
      )}
      <nav aria-label="Workspace" class="rail__section">
        <ul class="rail__list">
          {workspaceLinks.map(([label, href, current]) => (
            <li key={label}>
              <a class="rail__link" href={href} aria-current={current ? "page" : undefined} onClick={(e) => go(e, href)}>
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <a class="rail__link rail__account" href="/account">
        <Icon name="user" />
        Account
      </a>
      <SignOut />
    </div>
  );
}

export function SignOut(): JSX.Element {
  const signOut = async (): Promise<void> => {
    await api("DELETE", "/api/session");
    location.assign("/signin");
  };
  return (
    <button type="button" class="button button--quiet rail__signout" onClick={() => void signOut()}>
      <Icon name="log-out" />
      Sign out
    </button>
  );
}

const NAME_COPY = "This name doesn't meet the bucket naming rules.";
const PLACEMENT_COPY = "Choose one origin and up to three other regions.";

function NewBucketDialog({ scope, onClose, onStatus }: { scope: Scope; onClose: () => void; onStatus: (text: string, error?: boolean) => void }): JSX.Element {
  const [name, setName] = useState("");
  const [origin, setOrigin] = useState(scope.regions[0]?.id ?? "");
  const [replicas, setReplicas] = useState<string[]>([]);
  const [errors, setErrors] = useState<{ name?: string; placement?: string }>({});
  const [pending, setPending] = useState(false);

  const toggle = (id: string, on: boolean): void => setReplicas(on ? [...replicas, id] : replicas.filter((r) => r !== id));
  const placement = [origin, ...scope.regions.map((r) => r.id).filter((id) => id !== origin && replicas.includes(id))];

  const create = async (event: Event): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setErrors({});
    onStatus(`Creating ${name}…`);
    try {
      const created = await api<Bucket>("POST", `/api/w/${scope.ws}/buckets`, { name, placement });
      onStatus(`Created ${created.name} in ${placementNames(created, scope.regionName)}.`);
      await scope.reloadBuckets();
      onClose();
      focusHeadingOf(created.name);
      navigate(`/console/${scope.ws}/${created.name}`);
    } catch (error) {
      setPending(false);
      if (error instanceof ApiError && error.code === "validation_failed") {
        const fields = error.body.errors ?? {};
        setErrors({ name: fields["name"] ? NAME_COPY : undefined, placement: fields["placement"] ? PLACEMENT_COPY : undefined });
        onStatus(fields["name"] ? NAME_COPY : PLACEMENT_COPY, true);
      } else if (error instanceof ApiError && error.code === "bucket_name_taken") {
        onStatus("That name is taken. Bucket names are unique across all of Farshore.", true);
      } else {
        onStatus(scope.report(error), true);
      }
    }
  };

  return (
    <Dialog title="New bucket" onClose={onClose}>
      <form class="form" onSubmit={create}>
        <Field label="Bucket name" hint="Lowercase letters, digits and hyphens." error={errors.name}>
          {(described, id) => (
            <input id={id} class="mono-input" value={name} autocomplete="off" spellcheck={false} aria-describedby={described}
              aria-invalid={errors.name ? true : undefined} onInput={(e) => setName(e.currentTarget.value)} />
          )}
        </Field>
        <Field label="Origin region">
          {(described, id) => (
            <select id={id} value={origin} aria-describedby={described} onChange={(e) => setOrigin(e.currentTarget.value)}>
              {scope.regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <fieldset class="choices">
          <legend>Replica regions</legend>
          {scope.regions.map((r) => (
            <label key={r.id} class="choice">
              <input type="checkbox" checked={r.id !== origin && replicas.includes(r.id)} disabled={r.id === origin}
                onChange={(e) => toggle(r.id, e.currentTarget.checked)} />
              <span>{r.name}</span>
              {r.id === origin && (
                <span class="choice__note" aria-hidden="true">
                  origin
                </span>
              )}
            </label>
          ))}
          {errors.placement && (
            <p class="field__error">
              <Icon name="circle-x" />
              {errors.placement}
            </p>
          )}
        </fieldset>
        <div class="form__actions">
          <button type="button" class="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" class="button button--primary" disabled={pending}>
            Create bucket
          </button>
        </div>
      </form>
    </Dialog>
  );
}

interface ConsoleProps {
  me: Me;
  place: Place;
}

export function Console({ me, place }: ConsoleProps): JSX.Element {
  const memberships = useMemo(
    () => [...me.memberships].sort((a, b) => a.workspace.name.localeCompare(b.workspace.name)),
    [me],
  );
  const segments = place.path.split("/").filter(Boolean).map(decodeURIComponent);
  const wsInUrl = segments[1];
  const member = memberships.find((m) => m.workspace.slug === (wsInUrl ?? memberships[0]?.workspace.slug));
  const home = member ?? memberships[0];
  const pageSegment = segments[2];
  const page = pageSegment !== undefined && isPage(pageSegment) ? pageSegment : null;
  const bucketInUrl = page === null ? pageSegment : undefined;

  const [regions, setRegions] = useState<Region[]>([]);
  const [buckets, setBuckets] = useState<Bucket[] | null>(null);
  const [suspended, setSuspended] = useState(false);
  const [bucketStatus, setBucketStatus] = useState({ text: "", error: false });
  const [shareStatus, setShareStatus] = useState("");
  const [navOpen, setNavOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [lastBucket, setLastBucket] = useState<string | null>(null);

  const ws = home?.workspace.slug ?? "";
  const reloadBuckets = async (): Promise<void> => {
    setBuckets((await api<{ buckets: Bucket[] }>("GET", `/api/w/${ws}/buckets`)).buckets);
  };

  useEffect(() => {
    void loadRegions().then(setRegions);
  }, []);
  useEffect(() => {
    setBuckets(null);
    setSuspended((document.body.dataset["suspended"] ?? "").split(" ").includes(ws));
    if (ws) void reloadBuckets();
  }, [ws]);

  // `/console` and `/console/<ws>` open the first bucket by name.
  const firstBucket = buckets?.[0]?.name;
  useEffect(() => {
    if (member && page === null && bucketInUrl === undefined && firstBucket) {
      navigate(`/console/${member.workspace.slug}/${firstBucket}`, true);
    }
  }, [member, page, bucketInUrl, firstBucket]);
  useEffect(() => {
    if (bucketInUrl && buckets?.some((b) => b.name === bucketInUrl)) setLastBucket(bucketInUrl);
  }, [bucketInUrl, buckets]);
  useEffect(() => setShareStatus(""), [place.path]);

  const regionName = (id: string): string => regions.find((r) => r.id === id)?.name ?? id;
  const scope: Scope | null =
    home && buckets
      ? {
          me,
          ws,
          workspaceName: home.workspace.name,
          role: home.role,
          regions,
          buckets,
          regionName,
          reloadBuckets,
          report: (error) => {
            if (error instanceof ApiError && error.code === "workspace_suspended") setSuspended(true);
            return generalCopy(error);
          },
          setShareStatus,
        }
      : null;

  const objectsHref = `/console/${ws}${lastBucket ? `/${lastBucket}` : ""}`;
  const rail = (onNavigate: () => void): JSX.Element | null =>
    scope && (
      <Rail
        scope={scope}
        bucket={member ? bucketInUrl ?? null : null}
        page={member ? page : null}
        objectsHref={objectsHref}
        onNavigate={onNavigate}
        onNewBucket={() => {
          setNavOpen(false);
          setCreating(true);
        }}
      />
    );

  // The console's own action results. The object view shows them in its reserved slot under the
  // breadcrumb; every other page shows them above its content.
  const notices = (
    <div class="notices">
      <Status label="Bucket status" text={bucketStatus.text} error={bucketStatus.error} />
      <Status label="Share status" text={shareStatus} />
    </div>
  );

  const centre = ((): JSX.Element | null => {
    if (!scope) return null;
    if (!member) return <Status label="Results status" text={ISOLATION_COPY} class="status--line" />;
    if (page === "_links") return <SharedLinks scope={scope} />;
    if (page === "_team") return <Team scope={scope} />;
    if (page === "_keys") return <AccessKeys scope={scope} />;
    if (page === "_usage") return <UsagePage scope={scope} />;
    if (page === "_security") return <Security key={ws} scope={scope} place={place} />;
    if (page === "_webhooks") {
      const endpointId = segments[3];
      return endpointId && segments[4] === "deliveries" ? (
        <Deliveries key={endpointId} scope={scope} endpointId={endpointId} />
      ) : (
        <Webhooks scope={scope} />
      );
    }
    if (bucketInUrl === undefined) return null;
    const bucket = buckets?.find((b) => b.name === bucketInUrl);
    if (!bucket) return <Status label="Results status" text={ISOLATION_COPY} class="status--line" />;
    return <ObjectView key={`${ws}/${bucket.name}`} scope={scope} bucket={bucket} place={place} notices={notices} />;
  })();

  return (
    <div class="console">
      <a class="skip" href="#objects" onClick={(e) => {
        e.preventDefault();
        document.getElementById("objects")?.focus();
      }}>
        Skip to objects
      </a>
      <header class="console__bar">
        <button type="button" class="button button--icon" aria-label="Workspaces and buckets" onClick={() => setNavOpen(true)}>
          <Icon name="menu" />
        </button>
        <span class="console__bar-name">{home?.workspace.name}</span>
      </header>
      <aside class="console__rail">{rail(() => undefined)}</aside>
      <main id="objects" class="console__main" tabIndex={-1}>
        {suspended && (
          <p role="alert" class="banner">
            <Icon name="circle-x" />
            {SUSPENDED_BANNER}
          </p>
        )}
        {centre?.type !== ObjectView && notices}
        {centre}
      </main>
      {navOpen && (
        <Dialog title="Navigation" titleHidden sheet onClose={() => setNavOpen(false)}>
          <button type="button" class="button button--icon nav-dialog__close" aria-label="Close navigation"
            onClick={() => setNavOpen(false)}>
            <Icon name="x" />
          </button>
          {rail(() => setNavOpen(false))}
        </Dialog>
      )}
      {creating && scope && <NewBucketDialog scope={scope} onClose={() => setCreating(false)} onStatus={(text, error = false) => setBucketStatus({ text, error })} />}
    </div>
  );
}
