// The drafting-table frame (brief: Screens and layout): top bar, the rail with New, destinations, the folder tree
// and the storage meter, the screen's own centre, the uploads panel and the one polite announcements region.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { call } from "../api";
import { bindAnnouncer } from "../announce";
import {
  currentFolder, dismissNotice, folders as folderStore, heldCounts, isStaff, notices, plusBadge, refreshFolders,
  serviceStatus, session, storageFigures,
} from "../data";
import { useStore, Store } from "../store";
import { useMedia, PHONE } from "../media";
import { driveHref, navigate, readAddress, useLocation, withAddress } from "../router";
import { formatSize } from "../format";
import { Icon, type IconName } from "../icons";
import { MenuButton } from "../widgets/Menu";
import { Tree } from "../drive/Tree";
import { NewFolderDialog } from "../drive/dialogs";
import { UploadsPanel } from "../uploads/Panel";
import { addFiles } from "../uploads/manager";
import { stopLive } from "../live";
import { PICKER_OUTAGE, STORAGE_OUTAGE } from "../copy";

const expandedStore = new Store<Set<string>>(new Set());

export function ServiceBanner() {
  const status = useStore(serviceStatus);
  if (status.storage === "up" && status.directory === "up") return null;
  return (
    <section aria-label="Service status" className="banner">
      <Icon name="alert" />
      <div>
        {status.storage === "down" && <p>{STORAGE_OUTAGE}</p>}
        {status.directory === "down" && <p>{PICKER_OUTAGE}</p>}
      </div>
    </section>
  );
}

export function Notices() {
  const list = useStore(notices);
  if (!list.length) return null;
  return (
    <section aria-label="Notices" className="notices">
      <ul>
        {list.map((notice) => (
          <li key={notice.id} className="notice">
            <Icon name="info" />
            <p>{notice.text}</p>
            <button type="button" className="button ghost compact" onClick={() => dismissNotice(notice.id)}>Dismiss</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Meter() {
  const figures = useStore(storageFigures);
  if (!figures) return null;
  const share = Math.min(1, figures.usedBytes / figures.quotaBytes);
  const text = `${formatSize(figures.usedBytes)} of ${formatSize(figures.quotaBytes)} used`;
  return (
    <div className="meter-block">
      <div role="meter" aria-label="Company storage" aria-valuemin={0} aria-valuemax={figures.quotaBytes} aria-valuenow={figures.usedBytes}
        aria-valuetext={text} className="meter">
        <span className={figures.usedBytes > 0 ? "meter-fill is-used" : "meter-fill"} style={{ width: `${share * 100}%` }} />
      </div>
      <p className="meter-text"><Icon name="hardDrive" size={14} /><span><span className="num">{formatSize(figures.usedBytes)}</span> of <span className="num">{formatSize(figures.quotaBytes)}</span> used</span></p>
      <p className="meter-sub">In the bin <span className="num">{formatSize(figures.binBytes)}</span></p>
    </div>
  );
}

function SearchBox() {
  const url = useLocation();
  const q = url.pathname === "/drive" ? readAddress(url).q ?? "" : "";
  const [text, setText] = useState(q);
  useEffect(() => setText(q), [q]);
  return (
    <form role="search" className="search" onSubmit={(e) => {
      e.preventDefault();
      const next = text.trim();
      if (next === q) return;
      navigate(url.pathname === "/drive" ? withAddress(url, { q: next || null }) : driveHref({ folder: null, view: "list", sort: "name-asc", q: next || null }));
    }}>
      <Icon name="search" />
      <input type="search" aria-label="Search files" placeholder="Search files" value={text} maxLength={100}
        onChange={(e) => setText(e.target.value)} />
    </form>
  );
}

interface Destination {
  label: string;
  href: string;
  icon: IconName;
  show: boolean;
}

export function Frame({ children }: { children: ReactNode }) {
  const me = useStore(session);
  const staff = isStaff(me);
  const url = useLocation();
  const phone = useMedia(PHONE);
  const all = useStore(folderStore);
  const held = useStore(heldCounts);
  const badge = useStore(plusBadge);
  const open = useStore(currentFolder);
  const expanded = useStore(expandedStore);
  const [drawer, setDrawer] = useState(false);
  const [creating, setCreating] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const openId = url.pathname === "/drive" ? readAddress(url).folder : null;

  // The open folder's ancestors are expanded so it is always visible in the tree.
  useEffect(() => {
    if (!openId) return;
    const byId = new Map(all.map((f) => [f.id, f]));
    const up: string[] = [];
    for (let f = byId.get(openId); f?.parentId; f = byId.get(f.parentId)) up.push(f.parentId);
    if (up.some((id) => !expandedStore.get().has(id))) expandedStore.set((s) => new Set([...s, ...up]));
  }, [openId, all]);

  useEffect(() => {
    if (!phone) setDrawer(false);
  }, [phone]);

  useEffect(() => {
    if (drawer) rail.current?.querySelector<HTMLElement>(".drawer-close")?.focus();
  }, [drawer]);

  const closeDrawer = (refocus = true) => {
    setDrawer(false);
    if (refocus) opener.current?.focus();
  };

  const counts = useMemo(() => ({ ...Object.fromEntries(all.map((f) => [f.id, f.fileCount])), ...held }), [all, held]);
  const destinations: Destination[] = [
    { label: "Projects", href: "/drive", icon: "folder", show: staff },
    { label: "Recent", href: "/recent", icon: "clock", show: true },
    { label: "Shared with me", href: "/shared", icon: "users", show: !staff },
    { label: "Bin", href: "/bin", icon: "trash", show: staff },
    { label: "Handovers", href: "/handovers", icon: "inbox", show: staff },
    { label: "Settings", href: "/settings", icon: "settings", show: staff && me?.staffRole === "admin" },
  ];
  const active = (href: string) => url.pathname === href && !(href === "/drive" && (openId || url.searchParams.get("q")));
  const canUpload = open !== null && (staff || open.access === "editor");
  const canCreate = open ? staff || open.access === "editor" : staff && url.pathname === "/drive" && !openId;

  const signOut = async () => {
    await call("DELETE", "/api/session").catch(() => undefined);
    stopLive();
    session.set(null);
    navigate("/sign-in", { replace: true });
  };

  return (
    <>
      <a className="skip-link" href="#files" onClick={(e) => {
        e.preventDefault();
        (document.querySelector<HTMLElement>("[role=listbox][aria-label=Files] [role=option][tabindex='0']")
          ?? document.querySelector<HTMLElement>("main"))?.focus();
      }}>Skip to files</a>
      <div id="frame" className={`frame${drawer ? " drawer-open" : ""}`}>
        <header className="topbar">
          {phone && (
            <button ref={opener} type="button" className="icon-button" aria-label="Open navigation" aria-expanded={drawer}
              onClick={() => setDrawer(true)}><Icon name="menu" size={20} /></button>
          )}
          <a className="wordmark" href={staff ? "/drive" : "/shared"} onClick={(e) => {
            e.preventDefault();
            navigate(staff ? "/drive" : "/shared");
          }}><span className="wordmark-mark" aria-hidden="true" /><span className="wordmark-text">Lintel Drive</span></a>
          <SearchBox />
          <div className="account">
            <span className="account-text"><span className="account-name">{me?.name}</span><span className="account-firm">{me?.firm}</span></span>
            <MenuButton label="Account" menuLabel="Account" align="end"
              items={[{ label: "Sign out", icon: <Icon name="logOut" />, onSelect: () => void signOut() }]}>
              <span className="avatar" data-initials={me?.name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2)} />
            </MenuButton>
          </div>
        </header>
        {phone && drawer && <div className="scrim" onClick={() => closeDrawer()} />}
        <div ref={rail} className="rail" {...(phone ? { role: drawer ? "dialog" : undefined, "aria-modal": drawer || undefined, "aria-label": drawer ? "Navigation" : undefined, inert: !drawer || undefined } : {})}
          onKeyDown={(e) => {
            if (phone && drawer && e.key === "Escape") {
              e.preventDefault();
              closeDrawer();
            }
          }}>
          {phone && (
            <div className="drawer-head">
              <span className="wordmark small">Lintel Drive</span>
              <button type="button" className="icon-button drawer-close" aria-label="Close navigation" onClick={() => closeDrawer()}><Icon name="x" size={20} /></button>
            </div>
          )}
          <MenuButton label="New" menuLabel="New" className="new-button"
            items={[
              { label: "Upload files", icon: <Icon name="upload" />, disabled: !canUpload, onSelect: () => fileInput.current?.click() },
              { label: "New folder", icon: <Icon name="folderPlus" />, disabled: !canCreate, onSelect: () => setCreating(true) },
            ]}>
            <Icon name="plus" /><span>New</span>
          </MenuButton>
          <input ref={fileInput} type="file" multiple aria-label="Upload files" className="visually-hidden" tabIndex={-1}
            onChange={(e) => {
              const chosen = [...(e.target.files ?? [])];
              e.target.value = "";
              if (open && chosen.length) addFiles(chosen, open.id);
            }} />
          <nav aria-label="Drive" className="destinations">
            <ul>
              {destinations.filter((d) => d.show).map((d) => (
                <li key={d.href}>
                  <a href={d.href} aria-current={active(d.href) ? "page" : undefined} onClick={(e) => {
                    e.preventDefault();
                    navigate(d.href);
                    if (phone) closeDrawer(false);
                  }}><Icon name={d.icon} />{d.label}</a>
                </li>
              ))}
            </ul>
          </nav>
          <h2 className="rail-title">Folders</h2>
          <div className="rail-tree">
            <Tree label="Folders" folders={all} expanded={expanded} current={openId} counts={counts} badge={phone ? null : badge}
              onToggle={(id, isOpen) => expandedStore.set((s) => {
                const next = new Set(s);
                if (isOpen) next.add(id);
                else next.delete(id);
                return next;
              })}
              onOpen={(id) => {
                navigate(withAddress(url, { folder: id, q: null }));
                if (phone) closeDrawer(false);
              }} />
          </div>
          {staff && <Meter />}
        </div>
        {children}
        <UploadsPanel />
        <div ref={bindAnnouncer} role="status" aria-label="Announcements" aria-live="polite" className="announcer" />
      </div>
      {creating && <NewFolderDialog parentId={open?.id ?? null} onClose={() => setCreating(false)} onDone={() => void refreshFolders()} />}
    </>
  );
}
