package api

import (
	"encoding/csv"
	"errors"
	"net/http"
	"strings"

	"github.com/marlowquill/interline-desk/internal/domain"
	"github.com/marlowquill/interline-desk/internal/store"
)

func userBody(u *store.User) map[string]any {
	return map[string]any{"id": u.ID, "name": u.Name, "email": u.Email, "role": u.Role}
}

func (s *Server) handleSignIn(w http.ResponseWriter, r *http.Request, _ *call) *apiError {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if fail := readJSON(r, &body); fail != nil {
		return fail
	}
	fields := map[string]string{}
	if strings.TrimSpace(body.Email) == "" {
		fields["email"] = "Enter the email you sign in with."
	}
	if body.Password == "" {
		fields["password"] = "Enter your password."
	}
	if len(fields) > 0 {
		return errValidation(fields)
	}
	user, err := s.store.UserByEmail(r.Context(), strings.TrimSpace(body.Email))
	if errors.Is(err, store.ErrNotFound) {
		return errInvalidCredentials()
	}
	if err != nil {
		return errInternal(err)
	}
	if !store.CheckPassword(user.PasswordHash, body.Password) {
		return errInvalidCredentials()
	}
	if user.Role == "reviewer" {
		projects, err := s.store.Projects(r.Context(), user)
		if err != nil {
			return errInternal(err)
		}
		if len(projects) == 0 {
			return errInvalidCredentials()
		}
	}
	id, err := s.store.CreateSession(r.Context(), user.ID, sessionTTL)
	if err != nil {
		return errInternal(err)
	}
	s.setSessionCookie(w, id)
	writeJSON(w, http.StatusOK, map[string]any{"user": userBody(user)})
	return nil
}

func (s *Server) handleSignOut(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	if err := s.store.DeleteSession(r.Context(), c.sessionID); err != nil {
		return errInternal(err)
	}
	s.clearSessionCookie(w)
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	writeJSON(w, http.StatusOK, userBody(c.user))
	return nil
}

func (s *Server) handleWorkspaceStats(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	ctx := r.Context()
	projects, err := s.store.Projects(ctx, c.user)
	if err != nil {
		return errInternal(err)
	}
	stats := map[string]int{"projects": len(projects), "exact_matches_reused": 0, "conflicts_open": 0,
		"below_threshold": 0, "publishes_confirmed": 0}
	for _, project := range projects {
		branches, err := s.store.Branches(ctx, s.store.Pool, project.ID)
		if err != nil {
			return errInternal(err)
		}
		for _, branch := range branches {
			if !branch.IsMain && domain.BranchFinal(branch.State) {
				continue
			}
			view, fail := s.previewBranch(r, project, branch.Name)
			if fail != nil {
				return fail
			}
			stats["below_threshold"] += view.BelowThreshold
			for _, conflict := range view.Conflicts {
				if conflict.Resolution == nil {
					stats["conflicts_open"]++
				}
			}
			for _, key := range view.BranchSet {
				for _, segment := range key.Segments {
					if segment.Origin != nil && *segment.Origin == "tm" {
						stats["exact_matches_reused"]++
					}
				}
			}
		}
		confirmed, err := s.store.CountPublished(ctx, project.ID)
		if err != nil {
			return errInternal(err)
		}
		stats["publishes_confirmed"] += confirmed
	}
	writeJSON(w, http.StatusOK, stats)
	return nil
}

func (s *Server) handleAudit(w http.ResponseWriter, r *http.Request, _ *call) *apiError {
	entries, err := s.store.AuditEntries(r.Context(), s.cfg.AuditRetention)
	if err != nil {
		return errInternal(err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": entries})
	return nil
}

func (s *Server) handleAuditCSV(w http.ResponseWriter, r *http.Request, _ *call) *apiError {
	entries, err := s.store.AuditEntries(r.Context(), s.cfg.AuditRetention)
	if err != nil {
		return errInternal(err)
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="audit-log.csv"`)
	writer := csv.NewWriter(w)
	writer.UseCRLF = true
	rows := [][]string{{"at", "actor", "action", "project", "detail"}}
	for _, entry := range entries {
		rows = append(rows, []string{
			neutralise(entry.At.Format("2006-01-02T15:04:05Z")),
			neutralise(entry.Actor), neutralise(entry.Action), neutralise(entry.Project), neutralise(entry.Detail),
		})
	}
	if err := writer.WriteAll(rows); err != nil {
		return errInternal(err)
	}
	writer.Flush()
	return nil
}

// neutralise keeps a spreadsheet from reading an exported cell as a formula.
func neutralise(cell string) string {
	if cell == "" {
		return cell
	}
	switch cell[0] {
	case '=', '+', '-', '@', '\t', '\r':
		return "'" + cell
	}
	return cell
}
