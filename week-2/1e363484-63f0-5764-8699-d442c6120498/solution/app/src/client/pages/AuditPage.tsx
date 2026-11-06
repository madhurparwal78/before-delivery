import { useEffect, useState } from "react";
import { request } from "../api";
import { COPY } from "../copy";
import { navigate } from "../router";
import type { AuditTrail } from "../types";
import { MovedReadingsTable } from "../ui/tables";
import { Link } from "../router";

export function AuditView({ trail, back }: { trail: AuditTrail; back: { href: string; label: string } | null }) {
  return (
    <>
      <header className="page-header">
        {back && <Link href={back.href} className="back-link">{back.label}</Link>}
        <h1>Readings audit trail for {trail.figure_id}</h1>
      </header>
      {trail.moved.length === 0 ? <p className="empty-line">{COPY.auditEmpty}</p> : <MovedReadingsTable moved={trail.moved} />}
    </>
  );
}

export function AuditPage({ slug, figureId }: { slug: string; figureId: string }) {
  const [trail, setTrail] = useState<AuditTrail | null>(null);
  useEffect(() => {
    void request<AuditTrail>("GET", `/api/figures/${figureId}/audit`).then((r) => {
      if (r.status === 200) setTrail(r.data);
      else if (r.status === 404) navigate("/projects", { replace: true, state: { lostAccess: true } });
    });
  }, [figureId]);
  return (
    <main className="page page-reading">
      {trail ? <AuditView trail={trail} back={{ href: `/projects/${slug}/figures/${figureId}`, label: `Figure ${figureId}` }} /> : <p className="loading num">Loading…</p>}
    </main>
  );
}
