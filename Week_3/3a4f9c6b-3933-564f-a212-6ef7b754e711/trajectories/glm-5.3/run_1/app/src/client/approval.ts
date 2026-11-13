// The approval link page. It works without signing in.

import { api, clusterTime } from './api.js';
import { esc } from './ui.js';

interface ApprovalLink {
  project: string;
  stage: string;
  bundle: { version: string; short_digest: string };
  requested_by: { email: string; name: string };
  request_expires_at: string;
  time_zone: string;
  diff: { resource: string; path: string; change: string; before: string | null; after: string | null }[];
  promotion_id: string;
}

export class ApprovalPage {
  constructor(private readonly root: HTMLElement, private readonly token: string) {}

  async mount(): Promise<void> {
    this.root.innerHTML = `
      <div class="approval-page">
        <div class="brand" style="font-family:var(--font-head);color:var(--amber);letter-spacing:0.1em;text-transform:uppercase;font-size:13px">Keelson</div>
        <div class="panel" id="approval-body">
          <p class="note">Loading…</p>
        </div>
      </div>`;
    const body = document.getElementById('approval-body')!;
    try {
      const link = await api.approvalLink(this.token) as ApprovalLink;
      document.title = `Approval requested · Keelson`;
      body.innerHTML = `
        <h1>Approval requested</h1>
        <dl class="kv" style="display:grid;grid-template-columns:140px 1fr;gap:4px 12px;font-size:13px;margin:0">
          <dt style="color:var(--ink-faint)">Project</dt><dd style="margin:0">${esc(link.project)}</dd>
          <dt style="color:var(--ink-faint)">Stage</dt><dd style="margin:0">${esc(link.stage)}</dd>
          <dt style="color:var(--ink-faint)">Version</dt><dd style="margin:0">${esc(link.bundle.version)} · ${esc(link.bundle.short_digest)}</dd>
          <dt style="color:var(--ink-faint)">Requested by</dt><dd style="margin:0">${esc(link.requested_by.name)} &lt;${esc(link.requested_by.email)}&gt;</dd>
          <dt style="color:var(--ink-faint)">Expires</dt><dd style="margin:0" class="mono">${esc(clusterTime(link.time_zone, link.request_expires_at))}</dd>
        </dl>
        <h4 style="margin-top:16px">Diff</h4>
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr><th style="text-align:left;color:var(--ink-faint);font-weight:400;padding:4px 8px 4px 0">Resource</th><th style="text-align:left;color:var(--ink-faint);font-weight:400;padding:4px 8px 4px 0">Path</th><th style="text-align:left;color:var(--ink-faint);font-weight:400;padding:4px 8px 4px 0">Change</th><th style="text-align:left;color:var(--ink-faint);font-weight:400;padding:4px 8px 4px 0">Before</th><th style="text-align:left;color:var(--ink-faint);font-weight:400;padding:4px 8px 4px 0">After</th></tr></thead>
          <tbody>
            ${link.diff.length
              ? link.diff.map((d) => `<tr><td style="padding:4px 8px 4px 0;border-top:1px solid var(--hairline)">${esc(d.resource)}</td><td style="padding:4px 8px 4px 0;border-top:1px solid var(--hairline)"><code>${esc(d.path || '—')}</code></td><td style="padding:4px 8px 4px 0;border-top:1px solid var(--hairline)">${esc(d.change)}</td><td style="padding:4px 8px 4px 0;border-top:1px solid var(--hairline)"><code>${esc(d.before ?? '')}</code></td><td style="padding:4px 8px 4px 0;border-top:1px solid var(--hairline)"><code>${esc(d.after ?? '')}</code></td></tr>`).join('')
              : '<tr><td colspan="5" style="padding:8px 0;border-top:1px solid var(--hairline);color:var(--ink-faint)">No changes.</td></tr>'}
          </tbody>
        </table>
        <p style="margin-top:16px"><a href="/projects/${esc(link.project)}">Open in Keelson</a></p>`;
      const openLink = body.querySelector('a')!;
      openLink.addEventListener('click', (e) => {
        e.preventDefault();
        const target = `/projects/${link.project}#promo=${encodeURIComponent(link.promotion_id)}`;
        window.history.pushState({}, '', target);
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
    } catch {
      document.title = `Approval expired · Keelson`;
      body.innerHTML = `<h1>This approval link has expired.</h1>`;
    }
  }
}
