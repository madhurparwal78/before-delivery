package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strings"
	"time"
)

// mergeField is one comparable field of a key.
const (
	fieldName      = "name"
	fieldSource    = "source"
	fieldPresence  = "presence"
	fieldTransPref = "translation:"
)

// conflictOut is the API shape of one conflict.
type conflictOut struct {
	ID         string  `json:"id"`
	KeyID      string  `json:"key_id"`
	Key        string  `json:"key"`
	Field      string  `json:"field"`
	Base       *string `json:"base"`
	Main       *string `json:"main"`
	Branch     *string `json:"branch"`
	Resolution any     `json:"resolution"`
	HeldUntil  any     `json:"held_until"`
}

// classify classifies every key against the branch's base and current main into
// new, edited, deleted and field-level conflicts. This is the one merge
// classification; every caller uses it.
func classify(p *Project, base, main, branch map[string]*keyState, mainSegs, branchSegs map[string]*segState, langs []string) (newKeys, editedKeys, deletedKeys int, conflicts []conflictOut) {
	seen := map[string]bool{}
	for keyID, b := range base {
		seen[keyID] = true
		m := main[keyID]
		br := branch[keyID]
		switch {
		case br == nil && m == nil:
			continue
		case br == nil:
			// deleted on the branch
			if m != nil && (m.Source != b.Source || m.Name != b.Name) {
				conflicts = append(conflicts, presenceConflict(b, m))
			} else {
				deletedKeys++
			}
		case m == nil:
			// deleted on main; when the branch also changed it, that's a conflict
			if br.Source != b.Source || br.Name != b.Name {
				conflicts = append(conflicts, presenceConflict(b, br))
			} else {
				// unchanged on the branch: main deleted it, so it stays deleted
				deletedKeys++
			}
		default:
			editedOnBranch := br.Source != b.Source || br.Name != b.Name
			editedOnMain := m.Source != b.Source || m.Name != b.Name
			keyConflicts := false
			if editedOnBranch && editedOnMain {
				if br.Source != m.Source {
					conflicts = append(conflicts, sourceConflict(b, m, br))
					keyConflicts = true
				}
				if br.Name != m.Name {
					conflicts = append(conflicts, nameConflict(b, m, br))
					keyConflicts = true
				}
			}
			// translations field by field
			for _, lang := range langs {
				field := fieldTransPref + lang
				bs := segOf(mainSegs, b.MainSegID, lang)
				brSeg := segOf(branchSegs, br.BranchSegID, lang)
				mSeg := segOf(mainSegs, m.MainSegID, lang)
				_ = bs
				bChanged, mChanged := segChanged(brSeg, mSeg)
				_ = bChanged
				if bChanged && mChanged && segValue(brSeg) != segValue(mSeg) {
					conflicts = append(conflicts, conflictOut{
						ID: keyID + ":" + field, KeyID: keyID, Key: br.Name, Field: field,
						Base: segBaseValue(mainSegs, b, lang), Main: segValue(mSeg), Branch: segValue(brSeg),
					})
					keyConflicts = true
				}
			}
			if editedOnBranch && !keyConflicts {
				editedKeys++
			}
		}
	}
	// keys created on the branch
	for keyID, br := range branch {
		if seen[keyID] {
			continue
		}
		if main[keyID] == nil {
			// new on the branch, unless a live main key already holds that name
			if taken, holder := nameTakenBy(main, br.Name); taken {
				conflicts = append(conflicts, conflictOut{
					ID: keyID + ":" + fieldName, KeyID: keyID, Key: br.Name, Field: fieldName,
					Base: nil, Main: strPtrOf(holder), Branch: strPtrOf(br.Source),
				})
			} else {
				newKeys++
			}
		}
	}
	sort.Slice(conflicts, func(i, j int) bool { return conflicts[i].ID < conflicts[j].ID })
	return newKeys, editedKeys, deletedKeys, conflicts
}

func nameTakenBy(main map[string]*keyState, name string) (bool, string) {
	for _, m := range main {
		if m.Name == name {
			return true, m.Source
		}
	}
	return false, ""
}

func presenceConflict(b *keyState, other *keyState) conflictOut {
	return conflictOut{
		ID: b.KeyID + ":" + fieldPresence, KeyID: b.KeyID, Key: b.Name, Field: fieldPresence,
		Base: strPtrOf(b.Source), Main: mainPresence(b, other), Branch: branchPresence(b, other),
	}
}

func mainPresence(b, other *keyState) *string {
	if other.Present {
		v := "present"
		return &v
	}
	v := "absent"
	return &v
}

func branchPresence(b, other *keyState) *string {
	return mainPresence(b, other)
}

func sourceConflict(b, m, br *keyState) conflictOut {
	return conflictOut{
		ID: br.KeyID + ":" + fieldSource, KeyID: br.KeyID, Key: br.Name, Field: fieldSource,
		Base: strPtrOf(b.Source), Main: strPtrOf(m.Source), Branch: strPtrOf(br.Source),
	}
}

func nameConflict(b, m, br *keyState) conflictOut {
	return conflictOut{
		ID: br.KeyID + ":" + fieldName, KeyID: br.KeyID, Key: br.Name, Field: fieldName,
		Base: strPtrOf(b.Name), Main: strPtrOf(m.Name), Branch: strPtrOf(br.Name),
	}
}

// keyState is a key on one side of the comparison, with its segment ids.
type keyState struct {
	KeyID        string
	Name         string
	Source       string
	Present      bool
	MainSegID    string
	BranchSegID  string
	MainBranchID string
}

// segState is a segment's comparable value on one side.
type segState struct {
	SegID string
	Value *string
}

func segOf(m map[string]*segState, segID, lang string) *segState {
	if segID == "" {
		return nil
	}
	return m[segID+"\x00"+lang]
}

func segChanged(brSeg, mSeg *segState) (bool, bool) {
	return brSeg != nil && brSeg.Value != nil, mSeg != nil && mSeg.Value != nil
}

func segValue(s *segState) *string {
	if s == nil {
		return nil
	}
	return s.Value
}

func segBaseValue(m map[string]*segState, b *keyState, lang string) *string {
	return segValue(segOf(m, b.MainSegID, lang))
}

func strPtrOf(s string) *string { return &s }

// loadComparison loads base, main and branch key states and both sides' segments.
func (s *Server) loadComparison(ctx context.Context, p *Project, branchID string) (map[string]*keyState, map[string]*keyState, map[string]*keyState, map[string]*segState, map[string]*segState, error) {
	baseKeys, err := s.baseKeys(ctx, branchID)
	if err != nil {
		return nil, nil, nil, nil, nil, err
	}
	mainID := mainBranchID(ctx, s.db, p.ID)
	mainKeys, err := s.store.KeysByBranch(ctx, mainID)
	if err != nil {
		return nil, nil, nil, nil, nil, err
	}
	branchKeys, err := s.store.KeysByBranch(ctx, branchID)
	if err != nil {
		return nil, nil, nil, nil, nil, err
	}
	mainSegs, err := s.segStates(ctx, mainID)
	if err != nil {
		return nil, nil, nil, nil, nil, err
	}
	branchSegs, err := s.segStates(ctx, branchID)
	if err != nil {
		return nil, nil, nil, nil, nil, err
	}
	toState := func(k *KeyRow, present bool, segKey string) *keyState {
		return &keyState{KeyID: k.ID, Name: k.Name, Source: k.Source, Present: present, MainSegID: k.ID, MainBranchID: segKey}
	}
	base := map[string]*keyState{}
	for _, b := range baseKeys {
		base[b.KeyID] = &keyState{KeyID: b.KeyID, Name: b.Name, Source: b.Source, Present: b.Present, MainSegID: b.KeyID}
	}
	main := map[string]*keyState{}
	for _, k := range mainKeys {
		main[k.ID] = toState(k, true, "main")
	}
	branch := map[string]*keyState{}
	for _, k := range branchKeys {
		branch[k.ID] = toState(k, true, "branch")
	}
	return base, main, branch, mainSegs, branchSegs, nil
}

// segStates loads a branch's segments keyed by key id and language.
func (s *Server) segStates(ctx context.Context, branchID string) (map[string]*segState, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT key_id, language, value FROM segments WHERE branch_id = $1`, branchID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := map[string]*segState{}
	for rows.Next() {
		var keyID, lang string
		var value any
		if err := rows.Scan(&keyID, &lang, &value); err != nil {
			return nil, err
		}
		out[keyID+"\x00"+lang] = &segState{Value: nullableString(value)}
	}
	return out, rows.Err()
}

func nullableString(v any) *string {
	if v == nil {
		return nil
	}
	s, ok := v.(string)
	if !ok {
		b, ok := v.([]byte)
		if !ok {
			return nil
		}
		s = string(b)
	}
	return &s
}

func (s *Server) handleMergePreview(w http.ResponseWriter, r *http.Request) {
	p, b, branchID, ok := s.loadAnyBranch(w, r)
	if !ok {
		return
	}
	if b.IsMain {
		branchKeys, err := s.store.KeysByBranch(r.Context(), branchID)
		if err != nil {
			http.Error(w, "internal", 500)
			return
		}
		segs, err := s.store.SegmentsByBranch(r.Context(), branchID)
		if err != nil {
			http.Error(w, "internal", 500)
			return
		}
		var needsReview, belowThreshold int
		for _, sg := range segs {
			if sg.Status == StatusNeedsReview {
				needsReview++
			}
			if sg.Score != nil && *sg.Score < p.MqmThreshold {
				belowThreshold++
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"branch": "main", "state": BranchOpen, "keys": len(branchKeys),
			"needs_review": needsReview, "new_keys": 0, "edited_keys": 0,
			"deleted_keys": 0, "conflicts": []any{}, "below_threshold": belowThreshold,
		})
		return
	}
	preview, err := s.mergePreview(r.Context(), p, branchID, b)
	if err != nil {
		http.Error(w, "internal", 500)
		return
	}
	writeJSON(w, http.StatusOK, preview)
}

// mergePreview recomputes the classification and overlays resolutions and holds.
func (s *Server) mergePreview(ctx context.Context, p *Project, branchID string, b *Branch) (map[string]any, error) {
	base, main, branch, mainSegs, branchSegs, err := s.loadComparison(ctx, p, branchID)
	if err != nil {
		return nil, err
	}
	newKeys, editedKeys, deletedKeys, conflicts := classify(p, base, main, branch, mainSegs, branchSegs, p.TargetLanguages)

	persisted, err := s.loadConflicts(ctx, branchID)
	if err != nil {
		return nil, err
	}
	out := make([]conflictOut, 0, len(conflicts))
	unresolved := 0
	for _, c := range conflicts {
		if pc, ok := persisted[c.ID]; ok {
			c.Resolution = pc.resolution
			c.HeldUntil = pc.heldUntil
			if !resolutionVoid(pc, c) {
				c.Resolution = pc.resolution
			} else {
				c.Resolution = nil
			}
		}
		if c.Resolution == nil {
			unresolved++
		}
		out = append(out, c)
	}

	branchSegsList, err := s.store.SegmentsByBranch(ctx, branchID)
	if err != nil {
		return nil, err
	}
	var needsReview, belowThreshold int
	for _, sg := range branchSegsList {
		if sg.Status == StatusNeedsReview {
			needsReview++
		}
		if sg.Score != nil && *sg.Score < p.MqmThreshold {
			belowThreshold++
		}
	}
	return map[string]any{
		"branch": b.Name, "state": b.State,
		"keys": len(branch), "needs_review": needsReview,
		"new_keys": newKeys, "edited_keys": editedKeys, "deleted_keys": deletedKeys,
		"conflicts": out, "below_threshold": belowThreshold,
	}, nil
}

// resolutionVoid reports whether a stored resolution no longer applies because
// main's value for that field changed after the resolution was saved.
func resolutionVoid(pc persistedConflict, c conflictOut) bool {
	if pc.seenMain == nil {
		return false
	}
	seen, ok := pc.seenMain.(string)
	if !ok {
		return false
	}
	cur := ""
	if c.Main != nil {
		cur = *c.Main
	}
	return seen != cur
}

type persistedConflict struct {
	resolution any
	heldUntil  any
	seenMain   any
}

func (s *Server) loadConflicts(ctx context.Context, branchID string) (map[string]persistedConflict, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, resolution, held_until, seen_main FROM conflicts WHERE branch_id = $1`, branchID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := map[string]persistedConflict{}
	for rows.Next() {
		var id string
		var resolution []byte
		var heldUntil, seenMain any
		if err := rows.Scan(&id, &resolution, &heldUntil, &seenMain); err != nil {
			return nil, err
		}
		var res any
		if len(resolution) > 0 {
			_ = json.Unmarshal(resolution, &res)
		}
		out[id] = persistedConflict{resolution: res, heldUntil: heldUntil, seenMain: seenMain}
	}
	return out, rows.Err()
}

// ---- holds ----

func (s *Server) handleConflictHold(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	p, b, branchID, ok := s.loadAnyBranch(w, r)
	if !ok {
		return
	}
	if branchFinal(b.State) {
		writeError(w, http.StatusConflict, "branch_closed", "This branch is merged or abandoned, so it can't change.")
		return
	}
	conflictID := r.PathValue("conflict_id")
	heldUntil := time.Now().UTC().Add(s.cfg.ConflictHold)
	session := sessionTokenOf(r)
	err := s.store.withTx(r.Context(), func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(r.Context(), `SELECT pg_advisory_xact_lock(hashtext($1))`, conflictID); err != nil {
			return err
		}
		var currentSession string
		var currentUntil time.Time
		err := tx.QueryRowContext(r.Context(), `SELECT coalesce(hold_session,''), coalesce(held_until, to_timestamp(0)) FROM conflicts WHERE branch_id = $1 AND id = $2`,
			branchID, conflictID).Scan(&currentSession, &currentUntil)
		if errors.Is(err, sql.ErrNoRows) {
			return errConflictMissing
		}
		if err != nil {
			return err
		}
		now := time.Now().UTC()
		if currentSession != "" && currentSession != session && currentUntil.After(now) {
			return &holdRefused{until: currentUntil}
		}
		if _, err := tx.ExecContext(r.Context(), `INSERT INTO conflicts (id, project_id, branch_id, key_id, field, base, main, branch, resolution, held_until, hold_session, seen_main)
			VALUES ($1,$2,$3,$4,$5,NULL,NULL,NULL,NULL,$6,$7,NULL)
			ON CONFLICT (branch_id, id) DO UPDATE SET held_until = $6, hold_session = $7`,
			conflictID, p.ID, branchID, conflictKeyID(conflictID), conflictField(conflictID), heldUntil, session); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		var refused *holdRefused
		if errors.As(err, &refused) {
			writeErrorDetails(w, http.StatusConflict, "conflict_held", "This conflict is being resolved in another session.",
				map[string]any{"held_until": refused.until.UTC().Format(time.RFC3339)})
			return
		}
		if errors.Is(err, errConflictMissing) {
			notFoundError(w)
			return
		}
		http.Error(w, "internal", 500)
		return
	}
	_ = s.store.AuditInsert(r.Context(), u.Email, "conflict.held", p.Slug, conflictID)
	writeJSON(w, http.StatusOK, map[string]any{"conflict_id": conflictID, "held_until": heldUntil.UTC().Format(time.RFC3339)})
}

func conflictKeyID(id string) string { return strings.SplitN(id, ":", 2)[0] }
func conflictField(id string) string {
	parts := strings.SplitN(id, ":", 2)
	if len(parts) < 2 {
		return fieldSource
	}
	return parts[1]
}

type holdRefused struct{ until time.Time }

func (h *holdRefused) Error() string { return "conflict held" }

var errConflictMissing = errors.New("conflict missing")

func sessionTokenOf(r *http.Request) string {
	if c, err := r.Cookie(SessionCookie); err == nil {
		return c.Value
	}
	return ""
}

// ---- resolution ----

func (s *Server) handleConflictResolve(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	p, b, branchID, ok := s.loadAnyBranch(w, r)
	if !ok {
		return
	}
	if branchFinal(b.State) {
		writeError(w, http.StatusConflict, "branch_closed", "This branch is merged or abandoned, so it can't change.")
		return
	}
	conflictID := r.PathValue("conflict_id")
	var body struct {
		Choice string  `json:"choice"`
		Value  *string `json:"value"`
	}
	if err := decodeJSONBody(r, &body); err != nil {
		validationFailed(w, map[string]string{"choice": "Read the request body again."})
		return
	}
	if body.Choice != "main" && body.Choice != "branch" && body.Choice != "custom" {
		validationFailed(w, map[string]string{"choice": "Choose main, branch or custom."})
		return
	}
	if body.Choice == "custom" && (body.Value == nil || *body.Value == "") {
		validationFailed(w, map[string]string{"value": "Write the new value."})
		return
	}
	session := sessionTokenOf(r)
	var chosenValue any
	err := s.store.withTx(r.Context(), func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(r.Context(), `SELECT pg_advisory_xact_lock(hashtext($1))`, conflictID); err != nil {
			return err
		}
		var holdSession string
		var holdUntil time.Time
		var seenMain, baseVal, mainVal, branchVal any
		err := tx.QueryRowContext(r.Context(), `SELECT coalesce(hold_session,''), coalesce(held_until, to_timestamp(0)), seen_main, base, main, branch FROM conflicts WHERE branch_id = $1 AND id = $2`,
			branchID, conflictID).Scan(&holdSession, &holdUntil, &seenMain, &baseVal, &mainVal, &branchVal)
		if errors.Is(err, sql.ErrNoRows) {
			return errHoldRequired
		}
		if err != nil {
			return err
		}
		if holdSession != session || !holdUntil.After(time.Now().UTC()) {
			return errHoldRequired
		}
		switch body.Choice {
		case "main":
			chosenValue = mainVal
		case "branch":
			chosenValue = branchVal
		case "custom":
			chosenValue = *body.Value
		}
		res := map[string]any{
			"choice": body.Choice,
			"value":  chosenValue,
			"by":     u.Email,
			"at":     time.Now().UTC().Format(time.RFC3339),
		}
		resJSON, _ := json.Marshal(res)
		if _, err := tx.ExecContext(r.Context(), `UPDATE conflicts SET resolution = $1, held_until = NULL, hold_session = NULL, seen_main = $2 WHERE branch_id = $3 AND id = $4`,
			string(resJSON), nullableString(mainVal), branchID, conflictID); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		if errors.Is(err, errHoldRequired) {
			writeError(w, http.StatusConflict, "hold_required", "Your hold on this conflict ran out. Hold it again to resolve it.")
			return
		}
		http.Error(w, "internal", 500)
		return
	}
	_ = s.store.AuditInsert(r.Context(), u.Email, "conflict.resolved", p.Slug, conflictID)
	writeJSON(w, http.StatusOK, map[string]any{
		"id": conflictID, "key_id": conflictKeyID(conflictID), "key": conflictKeyID(conflictID),
		"field": conflictField(conflictID), "base": nil, "main": nil, "branch": nil,
		"resolution": map[string]any{"choice": body.Choice, "value": chosenValue, "by": u.Email, "at": time.Now().UTC().Format(time.RFC3339)},
		"held_until": nil,
	})
}

var errHoldRequired = errors.New("hold required")
