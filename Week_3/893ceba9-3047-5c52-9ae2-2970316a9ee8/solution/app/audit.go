package main

import (
	"bytes"
	"context"
	"encoding/csv"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// audit writes the one entry a state change leaves behind.
func (a *App) audit(ctx context.Context, q db, actor, action string, p *Project, detail string) error {
	var slug string
	var id *string
	if p != nil {
		slug, id = p.Slug, &p.ID
	}
	_, err := q.Exec(ctx, "INSERT INTO audit (at, actor, action, project, project_id, detail) VALUES ($1, $2, $3, $4, $5, $6)",
		time.Now().UTC(), actor, action, slug, id, detail)
	if err != nil {
		return fmt.Errorf("write audit entry %s: %w", action, err)
	}
	return nil
}

type auditEntry struct {
	ID      int64  `json:"id"`
	At      string `json:"at"`
	Actor   string `json:"actor"`
	Action  string `json:"action"`
	Project string `json:"project"`
	Detail  string `json:"detail"`
}

// auditEntries lists entries inside the retention window, newest first.
func (a *App) auditEntries(ctx context.Context) ([]auditEntry, error) {
	cutoff := time.Now().UTC().Add(-a.cfg.AuditRetention)
	rows, err := a.pool.Query(ctx, "SELECT id, at, actor, action, project, detail FROM audit WHERE at > $1 ORDER BY at DESC, id DESC", cutoff)
	if err != nil {
		return nil, fmt.Errorf("list audit: %w", err)
	}
	defer rows.Close()
	out := []auditEntry{}
	for rows.Next() {
		var e auditEntry
		var at time.Time
		if err := rows.Scan(&e.ID, &at, &e.Actor, &e.Action, &e.Project, &e.Detail); err != nil {
			return nil, fmt.Errorf("scan audit: %w", err)
		}
		e.At = fmtTime(at)
		out = append(out, e)
	}
	return out, rows.Err()
}

func (a *App) handleAudit(w http.ResponseWriter, r *http.Request) error {
	pr, err := a.authn(r)
	if err != nil {
		return err
	}
	if err := pr.requireOwner(); err != nil {
		return err
	}
	entries, err := a.auditEntries(r.Context())
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": entries})
	return nil
}

// csvCell neutralises spreadsheet formulas: a cell starting with = + - @ tab or CR gets a leading apostrophe.
func csvCell(v string) string {
	if v != "" && strings.ContainsRune("=+-@\t\r", rune(v[0])) {
		return "'" + v
	}
	return v
}

func (a *App) handleAuditCSV(w http.ResponseWriter, r *http.Request) error {
	pr, err := a.authn(r)
	if err != nil {
		return err
	}
	if err := pr.requireOwner(); err != nil {
		return err
	}
	entries, err := a.auditEntries(r.Context())
	if err != nil {
		return err
	}
	var buf bytes.Buffer
	cw := csv.NewWriter(&buf)
	cw.UseCRLF = true
	rows := [][]string{{"at", "actor", "action", "project", "detail"}}
	for _, e := range entries {
		rows = append(rows, []string{csvCell(e.At), csvCell(e.Actor), csvCell(e.Action), csvCell(e.Project), csvCell(e.Detail)})
	}
	if err := cw.WriteAll(rows); err != nil {
		return fmt.Errorf("write audit CSV: %w", err)
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="audit-log.csv"`)
	writeBody(w, buf.Bytes())
	return nil
}
