package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

func (s *Server) handleBranchesList(w http.ResponseWriter, r *http.Request) {
	p, err := s.projectInScope(w, r, r.PathValue("slug"))
	if err != nil {
		return
	}
	branches, err := s.store.Branches(r.Context(), p.ID)
	if err != nil {
		http.Error(w, "internal", 500)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"branches": branches})
}

func (s *Server) handleBranchCreate(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	slug := r.PathValue("slug")
	p, err := s.projectInScope(w, r, slug)
	if err != nil {
		return
	}
	var body struct {
		Name string `json:"name"`
	}
	if err := decodeJSONBody(r, &body); err != nil {
		validationFailed(w, map[string]string{"name": "Read the request body again."})
		return
	}
	name := strings.TrimSpace(body.Name)
	if !branchNameRe.MatchString(name) || name == "main" {
		validationFailed(w, map[string]string{"name": "Use lowercase letters, digits, slashes, hyphens or underscores."})
		return
	}

	// branch limits and name uniqueness, then the copy of main
	var openCount int
	if err := s.db.QueryRowContext(r.Context(), `SELECT count(*) FROM branches WHERE project_id = $1 AND state IN ('open','in_review') AND NOT is_main`, p.ID).Scan(&openCount); err != nil {
		http.Error(w, "internal", 500)
		return
	}
	if openCount >= 5 {
		writeError(w, http.StatusConflict, "branch_limit", "This project already has five open branches. Merge or abandon one first.")
		return
	}

	created, err := s.createBranch(r.Context(), p, name, u.Email)
	if err != nil {
		if errors.Is(err, errBranchExists) {
			writeError(w, http.StatusConflict, "branch_exists", "A branch with that name already exists.")
			return
		}
		http.Error(w, "internal", 500)
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

var errBranchExists = errors.New("branch exists")

// createBranch copies current main into a new branch inside one transaction.
func (s *Server) createBranch(ctx context.Context, p *Project, name, actor string) (*Branch, error) {
	var created *Branch
	err := s.store.withTx(ctx, func(tx *sql.Tx) error {
		branchID := newUUID()
		now := time.Now().UTC()
		// lock project rows for the name check
		var exists int
		if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM branches WHERE project_id = $1 AND name = $2`, p.ID, name).Scan(&exists); err != nil {
			return err
		}
		if exists > 0 {
			return errBranchExists
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO branches (id, project_id, name, state, is_main, created_at) VALUES ($1,$2,$3,'open',false,$4)`,
			branchID, p.ID, name, now); err != nil {
			return err
		}
		// copy main keys, keeping key ids
		if _, err := tx.ExecContext(ctx, `INSERT INTO keys (id, project_id, branch_id, name, source, deleted, created_at)
			SELECT id, project_id, $1, name, source, deleted, created_at FROM keys WHERE branch_id = (SELECT id FROM branches WHERE project_id = $2 AND is_main)`,
			branchID, p.ID); err != nil {
			return err
		}
		// copy segments with new segment ids
		if _, err := tx.ExecContext(ctx, `INSERT INTO segments (id, project_id, branch_id, key_id, language, value, status, score, origin, issues, created_at, updated_at)
			SELECT gen_random_uuid(), project_id, $1, key_id, language, value, status, score, origin, issues, now(), now()
			FROM segments WHERE branch_id = (SELECT id FROM branches WHERE project_id = $2 AND is_main)`,
			branchID, p.ID); err != nil {
			return err
		}
		// the base is main at creation
		if err := copyBase(ctx, tx, p.ID, branchID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO audit_log (id, at, actor, action, project, detail) VALUES ($1,$2,$3,'branch.created',$4,$5)`,
			newUUID(), now, actor, p.Slug, name); err != nil {
			return err
		}
		created = &Branch{Name: name, State: BranchOpen, IsMain: false, CreatedAt: now}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return created, nil
}

func (s *Server) handleBranchTransition(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	slug := r.PathValue("slug")
	branchName := r.PathValue("branch")
	p, err := s.projectInScope(w, r, slug)
	if err != nil {
		return
	}
	var body struct {
		To string `json:"to"`
	}
	if err := decodeJSONBody(r, &body); err != nil {
		validationFailed(w, map[string]string{"to": "Read the request body again."})
		return
	}
	b, branchID, err := s.store.BranchByName(r.Context(), p.ID, branchName)
	if err != nil || b == nil {
		notFoundError(w)
		return
	}
	if b.IsMain {
		writeErrorDetails(w, http.StatusConflict, "illegal_transition", "That change isn't allowed.",
			map[string]any{"from": "open", "to": body.To})
		return
	}
	if !branchTransition(b.State, body.To) {
		writeErrorDetails(w, http.StatusConflict, "illegal_transition", "That change isn't allowed.",
			map[string]any{"from": b.State, "to": body.To})
		return
	}
	if _, err := s.db.ExecContext(r.Context(), `UPDATE branches SET state = $1 WHERE id = $2`, body.To, branchID); err != nil {
		http.Error(w, "internal", 500)
		return
	}
	_ = s.store.AuditInsert(r.Context(), u.Email, "branch."+strings.ReplaceAll(body.To, "_", "_"), p.Slug, branchName)
	b.State = body.To
	writeJSON(w, http.StatusOK, b)
}

func (s *Server) handleKeysList(w http.ResponseWriter, r *http.Request) {
	p, err := s.projectInScope(w, r, r.PathValue("slug"))
	if err != nil {
		return
	}
	branchName := r.PathValue("branch")
	b, branchID, err := s.store.BranchByName(r.Context(), p.ID, branchName)
	if err != nil || b == nil {
		notFoundError(w)
		return
	}
	lang := r.URL.Query().Get("lang")
	if lang != "" && !langRe.MatchString(lang) {
		validationFailed(w, map[string]string{"lang": "Use a language code like de or pt-BR."})
		return
	}
	keys, err := s.store.KeysByBranch(r.Context(), branchID)
	if err != nil {
		http.Error(w, "internal", 500)
		return
	}
	segs, err := s.store.SegmentsByBranch(r.Context(), branchID)
	if err != nil {
		http.Error(w, "internal", 500)
		return
	}
	byKey := map[string]map[string]map[string]any{}
	for _, sg := range segs {
		if lang != "" && sg.Language != lang {
			continue
		}
		if byKey[sg.KeyID] == nil {
			byKey[sg.KeyID] = map[string]map[string]any{}
		}
		byKey[sg.KeyID][sg.Language] = map[string]any{
			"segment_id": sg.ID, "value": sg.Value, "status": sg.Status, "score": sg.Score,
		}
	}
	out := make([]map[string]any, 0, len(keys))
	for _, k := range keys {
		out = append(out, map[string]any{"id": k.ID, "name": k.Name, "source": k.Source, "translations": byKey[k.ID]})
	}
	writeJSON(w, http.StatusOK, map[string]any{"keys": out})
}

func (s *Server) handleKeyCreate(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	p, b, branchID, ok := s.loadOpenBranch(w, r)
	if !ok {
		return
	}
	var body struct {
		Name   string `json:"name"`
		Source string `json:"source"`
	}
	if err := decodeJSONBody(r, &body); err != nil {
		validationFailed(w, map[string]string{"name": "Read the request body again."})
		return
	}
	fields := map[string]string{}
	if !keyNameRe.MatchString(body.Name) {
		fields["name"] = "Use letters, digits, dots, hyphens and underscores, up to 120 characters."
	}
	src := strings.TrimSpace(body.Source)
	if len(src) < 1 || len(src) > 2000 {
		fields["source"] = "The source is 1 to 2,000 characters."
	}
	if len(fields) > 0 {
		validationFailed(w, fields)
		return
	}
	keyID := newUUID()
	err := s.store.withTx(r.Context(), func(tx *sql.Tx) error {
		var exists int
		if err := tx.QueryRowContext(r.Context(), `SELECT count(*) FROM keys WHERE branch_id = $1 AND name = $2 AND NOT deleted`, branchID, body.Name).Scan(&exists); err != nil {
			return err
		}
		if exists > 0 {
			return errKeyExists
		}
		now := time.Now().UTC()
		if _, err := tx.ExecContext(r.Context(), `INSERT INTO keys (id, project_id, branch_id, name, source, deleted, created_at) VALUES ($1,$2,$3,$4,$5,false,$6)`,
			keyID, p.ID, branchID, body.Name, src, now); err != nil {
			return err
		}
		if _, err := tx.ExecContext(r.Context(), `INSERT INTO key_revisions (key_id, at, branch, field, from_val, to_val, actor) VALUES ($1,$2,$3,'created',NULL,$4,$5)`,
			keyID, now, b.Name, src, u.Email); err != nil {
			return err
		}
		for _, lang := range p.TargetLanguages {
			sid := newUUID()
			if _, err := tx.ExecContext(r.Context(), `INSERT INTO segments (id, project_id, branch_id, key_id, language, value, status, score, origin, issues, created_at, updated_at)
				VALUES ($1,$2,$3,$4,$5,NULL,'untranslated',NULL,NULL,'[]',$6,$6)`, sid, p.ID, branchID, keyID, lang, now); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		if errors.Is(err, errKeyExists) {
			writeError(w, http.StatusConflict, "key_exists", "Another key on this branch already has that name.")
			return
		}
		http.Error(w, "internal", 500)
		return
	}
	// exact matches fill this key's untranslated segments
	if _, err := s.applyTmToKey(r.Context(), p, branchID, keyID, src); err != nil {
		http.Error(w, "internal", 500)
		return
	}
	_ = s.store.AuditInsert(r.Context(), u.Email, "key.created", p.Slug, body.Name)
	writeJSON(w, http.StatusCreated, map[string]any{"id": keyID, "name": body.Name, "source": src})
}

var errKeyExists = errors.New("key exists")

// loadOpenBranch resolves the project and branch and rejects closed branches.
func (s *Server) loadOpenBranch(w http.ResponseWriter, r *http.Request) (*Project, *Branch, string, bool) {
	p, err := s.projectInScope(w, r, r.PathValue("slug"))
	if err != nil {
		return nil, nil, "", false
	}
	branchName := r.PathValue("branch")
	b, branchID, err := s.store.BranchByName(r.Context(), p.ID, branchName)
	if err != nil || b == nil {
		notFoundError(w)
		return nil, nil, "", false
	}
	if branchFinal(b.State) {
		writeError(w, http.StatusConflict, "branch_closed", "This branch is merged or abandoned, so it can't change.")
		return nil, nil, "", false
	}
	if !branchEditable(b.State) {
		writeError(w, http.StatusConflict, "branch_not_open", "This branch is in review, so keys and translations are locked.")
		return nil, nil, "", false
	}
	return p, b, branchID, true
}

// loadAnyBranch resolves project and branch without the open check.
func (s *Server) loadAnyBranch(w http.ResponseWriter, r *http.Request) (*Project, *Branch, string, bool) {
	p, err := s.projectInScope(w, r, r.PathValue("slug"))
	if err != nil {
		return nil, nil, "", false
	}
	branchName := r.PathValue("branch")
	b, branchID, err := s.store.BranchByName(r.Context(), p.ID, branchName)
	if err != nil || b == nil {
		notFoundError(w)
		return nil, nil, "", false
	}
	return p, b, branchID, true
}

func (s *Server) handleKeyPatch(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	p, b, branchID, ok := s.loadOpenBranch(w, r)
	if !ok {
		return
	}
	keyID := r.PathValue("key_id")
	var keyName string
	var curSource string
	if err := s.db.QueryRowContext(r.Context(), `SELECT name, source FROM keys WHERE id = $1 AND branch_id = $2 AND NOT deleted`, keyID, branchID).Scan(&keyName, &curSource); err != nil {
		notFoundError(w)
		return
	}
	var body struct {
		Name   *string `json:"name"`
		Source *string `json:"source"`
	}
	if err := decodeJSONBody(r, &body); err != nil {
		validationFailed(w, map[string]string{"name": "Read the request body again."})
		return
	}
	fields := map[string]string{}
	newName := keyName
	newSource := curSource
	if body.Name != nil {
		newName = *body.Name
		if !keyNameRe.MatchString(newName) {
			fields["name"] = "Use letters, digits, dots, hyphens and underscores, up to 120 characters."
		}
	}
	if body.Source != nil {
		newSource = strings.TrimSpace(*body.Source)
		if len(newSource) < 1 || len(newSource) > 2000 {
			fields["source"] = "The source is 1 to 2,000 characters."
		}
	}
	if len(fields) > 0 {
		validationFailed(w, fields)
		return
	}
	if newName != keyName {
		var exists int
		if err := s.db.QueryRowContext(r.Context(), `SELECT count(*) FROM keys WHERE branch_id = $1 AND name = $2 AND id <> $3 AND NOT deleted`, branchID, newName, keyID).Scan(&exists); err == nil && exists > 0 {
			writeError(w, http.StatusConflict, "key_exists", "Another key on this branch already has that name.")
			return
		}
	}
	now := time.Now().UTC()
	sourceChanged := newSource != curSource
	err := s.store.withTx(r.Context(), func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(r.Context(), `UPDATE keys SET name = $1, source = $2 WHERE id = $3`, newName, newSource, keyID); err != nil {
			return err
		}
		if newName != keyName {
			if _, err := tx.ExecContext(r.Context(), `INSERT INTO key_revisions (key_id, at, branch, field, from_val, to_val, actor) VALUES ($1,$2,$3,'name',$4,$5,$6)`,
				keyID, now, b.Name, keyName, newName, u.Email); err != nil {
				return err
			}
		}
		if sourceChanged {
			if _, err := tx.ExecContext(r.Context(), `INSERT INTO key_revisions (key_id, at, branch, field, from_val, to_val, actor) VALUES ($1,$2,$3,'source',$4,$5,$6)`,
				keyID, now, b.Name, curSource, newSource, u.Email); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		http.Error(w, "internal", 500)
		return
	}
	if sourceChanged {
		// translated segments move to needs review; untranslated get exact matches
		if err := s.sourceChanged(r.Context(), p, b, branchID, keyID, newSource, u.Email); err != nil {
			http.Error(w, "internal", 500)
			return
		}
	}
	action := "key.edited"
	if newName != keyName {
		action = "key.renamed"
	}
	_ = s.store.AuditInsert(r.Context(), u.Email, action, p.Slug, newName)
	writeJSON(w, http.StatusOK, map[string]any{"id": keyID, "name": newName, "source": newSource})
}

func (s *Server) handleKeyDelete(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	p, b, branchID, ok := s.loadOpenBranch(w, r)
	if !ok {
		return
	}
	keyID := r.PathValue("key_id")
	res, err := s.db.ExecContext(r.Context(), `UPDATE keys SET deleted = true WHERE id = $1 AND branch_id = $2 AND NOT deleted`, keyID, branchID)
	if err != nil {
		http.Error(w, "internal", 500)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		notFoundError(w)
		return
	}
	now := time.Now().UTC()
	_, _ = s.db.ExecContext(r.Context(), `INSERT INTO key_revisions (key_id, at, branch, field, from_val, to_val, actor) VALUES ($1,$2,$3,'deleted',NULL,NULL,$4)`,
		keyID, now, b.Name, u.Email)
	_ = s.store.AuditInsert(r.Context(), u.Email, "key.deleted", p.Slug, keyID)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleKeyHistory(w http.ResponseWriter, r *http.Request) {
	p, err := s.projectInScope(w, r, r.PathValue("slug"))
	if err != nil {
		return
	}
	keyID := r.PathValue("key_id")
	var owner string
	if err := s.db.QueryRowContext(r.Context(), `SELECT project_id FROM keys WHERE id = $1`, keyID).Scan(&owner); err != nil {
		notFoundError(w)
		return
	}
	if owner != p.ID {
		notFoundError(w)
		return
	}
	rows, err := s.db.QueryContext(r.Context(), `SELECT at, branch, field, from_val, to_val, actor FROM key_revisions WHERE key_id = $1 ORDER BY at, id`, keyID)
	if err != nil {
		http.Error(w, "internal", 500)
		return
	}
	defer func() { _ = rows.Close() }()
	revs := []map[string]any{}
	for rows.Next() {
		var at time.Time
		var branch, field, actor string
		var from, to any
		if err := rows.Scan(&at, &branch, &field, &from, &to, &actor); err != nil {
			http.Error(w, "internal", 500)
			return
		}
		revs = append(revs, map[string]any{
			"at": at.UTC().Format(time.RFC3339), "branch": branch, "field": field,
			"from": from, "to": to, "actor": actor,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"key_id": keyID, "revisions": revs})
}

// sourceChanged applies the source-change rule: segments with a value move to
// needs_review keeping value, score and issues; untranslated get exact matches.
func (s *Server) sourceChanged(ctx context.Context, p *Project, b *Branch, branchID, keyID, newSource, actor string) error {
	rows, err := s.db.QueryContext(ctx, `SELECT id, value FROM segments WHERE key_id = $1 AND branch_id = $2`, keyID, branchID)
	if err != nil {
		return err
	}
	type seg struct {
		id    string
		value *string
	}
	var segs []seg
	for rows.Next() {
		var g seg
		if err := rows.Scan(&g.id, &g.value); err != nil {
			rows.Close()
			return err
		}
		segs = append(segs, g)
	}
	rows.Close()
	for _, g := range segs {
		if g.value != nil && *g.value != "" {
			_, err := s.db.ExecContext(ctx, `UPDATE segments SET status = 'needs_review', updated_at = now() WHERE id = $1`, g.id)
			if err != nil {
				return err
			}
			_, _ = s.db.ExecContext(ctx, `INSERT INTO segment_history (segment_id, at, actor, from_status, to_status, value) VALUES ($1, now(), $2, NULL, 'needs_review', $3)`,
				g.id, actor, *g.value)
		}
	}
	_, err = s.applyTmToKey(ctx, p, branchID, keyID, newSource)
	return err
}

// applyTmToKey fills this key's untranslated segments from exact matches.
func (s *Server) applyTmToKey(ctx context.Context, p *Project, branchID, keyID, source string) (int, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, language FROM segments WHERE key_id = $1 AND branch_id = $2 AND status = 'untranslated' ORDER BY id`, keyID, branchID)
	if err != nil {
		return 0, err
	}
	type target struct {
		id, lang string
	}
	var targets []target
	for rows.Next() {
		var t target
		if err := rows.Scan(&t.id, &t.lang); err != nil {
			rows.Close()
			return 0, err
		}
		targets = append(targets, t)
	}
	rows.Close()
	applied := 0
	for _, t := range targets {
		entry, err := s.tmExactMatch(ctx, p.ID, t.lang, source)
		if err != nil {
			return applied, err
		}
		if entry == nil {
			continue
		}
		value := MapPlaceholders(entry.Source, entry.Target, source)
		if _, err := s.db.ExecContext(ctx, `UPDATE segments SET value = $1, status = 'drafted', origin = 'tm', updated_at = now() WHERE id = $2 AND status = 'untranslated'`, value, t.id); err != nil {
			return applied, err
		}
		if _, err := s.db.ExecContext(ctx, `INSERT INTO segment_history (segment_id, at, actor, from_status, to_status, value) VALUES ($1, now(), 'system', 'untranslated', 'drafted', $2)`, t.id, value); err != nil {
			return applied, err
		}
		applied++
	}
	return applied, nil
}

type tmEntryRow struct {
	ID     string
	Source string
	Target string
	Lang   string
}

// tmExactMatch returns the oldest TM entry whose normalised source equals the
// normalised source in that language, or nil.
func (s *Server) tmExactMatch(ctx context.Context, projectID, lang, source string) (*tmEntryRow, error) {
	norm := Normalise(source)
	row := s.db.QueryRowContext(ctx,
		`SELECT id, source, target FROM tm_entries WHERE project_id = $1 AND target_language = $2 AND source_norm = $3 ORDER BY created_at, id LIMIT 1`,
		projectID, lang, norm)
	var e tmEntryRow
	if err := row.Scan(&e.ID, &e.Source, &e.Target); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	e.Lang = lang
	return &e, nil
}

func (s *Server) handleTmMatch(w http.ResponseWriter, r *http.Request) {
	p, err := s.projectInScope(w, r, r.PathValue("slug"))
	if err != nil {
		return
	}
	var body struct {
		Source   string `json:"source"`
		Language string `json:"language"`
	}
	if err := decodeJSONBody(r, &body); err != nil {
		validationFailed(w, map[string]string{"source": "Read the request body again."})
		return
	}
	if !langRe.MatchString(body.Language) {
		validationFailed(w, map[string]string{"language": "Use a language code like de or pt-BR."})
		return
	}
	entry, err := s.tmExactMatch(r.Context(), p.ID, body.Language, body.Source)
	if err != nil {
		http.Error(w, "internal", 500)
		return
	}
	if entry == nil {
		writeJSON(w, http.StatusOK, map[string]any{"match": nil})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"match": map[string]any{
		"entry_id": entry.ID, "source": entry.Source, "target": entry.Target,
		"reused_value": MapPlaceholders(entry.Source, entry.Target, body.Source),
	}})
}

var _ = fmt.Sprintf
