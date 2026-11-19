/** Carries the "created" announcement from the tray dialog to the cluster settings screen. */
let pending: { clusterId: string; message: string } | null = null;

export function handOffAnnouncement(clusterId: string, message: string): void {
  pending = { clusterId, message };
}

export function takeAnnouncement(clusterId: string): string | null {
  if (pending !== null && pending.clusterId === clusterId) {
    const { message } = pending;
    pending = null;
    return message;
  }
  return null;
}

const trayKey = (slug: string): string => `rushes.tray.${slug}`;

export function rememberTrayCluster(slug: string, clusterId: string): void {
  window.sessionStorage.setItem(trayKey(slug), clusterId);
}

export function recallTrayCluster(slug: string): string | null {
  return window.sessionStorage.getItem(trayKey(slug));
}
