package main

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"time"
)

type Resolution struct {
	Choice   string
	Value    *string
	By       string
	At       time.Time
	MainSeen *string
}

type Conflict struct {
	ID         string
	KeyID      string
	Key        string
	Field      string
	Base       *string
	Main       *string
	Branch     *string
	Resolution *Resolution
	HeldUntil  *time.Time

	branchKeyName string
}

func (c *Conflict) json() map[string]any {
	var resolution any
	if c.Resolution != nil {
		resolution = map[string]any{"choice": c.Resolution.Choice, "value": c.Resolution.Value, "by": c.Resolution.By, "at": fmtTime(c.Resolution.At)}
	}
	return map[string]any{"id": c.ID, "key_id": c.KeyID, "key": c.Key, "field": c.Field, "base": c.Base, "main": c.Main,
		"branch": c.Branch, "resolution": resolution, "held_until": fmtTimePtr(c.HeldUntil)}
}

// fieldDiff compares one field of a key across the base, the branch and current main.
type fieldDiff struct {
	Field         string
	Base          *string
	Main          *string
	Branch        *string
	BranchChanged bool
	Conflict      *Conflict
}

// translationField prefixes the conflict field of a translation: `translation:<lang>`.
const translationField = "translation:"

// Key classifications in a merge preview.
const (
	kindNew      = "new"
	kindEdited   = "edited"
	kindDeleted  = "deleted"
	kindPresence = "presence"
	kindNone     = "none"
)

// keyAnalysis is the one classification of a key against the base, the branch and main.
type keyAnalysis struct {
	KeyID     string
	Name      string
	Kind      string
	BranchKey *Key
	Fields    []fieldDiff
	Presence  *Conflict
}

type Preview struct {
	Branch         *Branch
	Keys           int
	NeedsReview    int
	BelowThreshold int
	NewKeys        int
	EditedKeys     int
	DeletedKeys    int
	Conflicts      []*Conflict
	Analyses       []*keyAnalysis
}

func (pv *Preview) openConflicts() int {
	n := 0
	for _, c := range pv.Conflicts {
		if c.Resolution == nil {
			n++
		}
	}
	return n
}

func (pv *Preview) json() map[string]any {
	conflicts := []map[string]any{}
	for _, c := range pv.Conflicts {
		conflicts = append(conflicts, c.json())
	}
	return map[string]any{"branch": pv.Branch.Name, "state": pv.Branch.State, "keys": pv.Keys, "needs_review": pv.NeedsReview,
		"new_keys": pv.NewKeys, "edited_keys": pv.EditedKeys, "deleted_keys": pv.DeletedKeys, "conflicts": conflicts,
		"below_threshold": pv.BelowThreshold}
}

type branchState struct {
	keys map[string]Key
	segs map[string]map[string]*Segment
}

func loadBranchState(ctx context.Context, q db, branchID string) (*branchState, error) {
	rows, err := q.Query(ctx, "SELECT key_id, name, source, deleted FROM branch_keys WHERE branch_id = $1", branchID)
	if err != nil {
		return nil, fmt.Errorf("load branch keys: %w", err)
	}
	st := &branchState{keys: map[string]Key{}}
	for rows.Next() {
		var k Key
		if err := rows.Scan(&k.ID, &k.Name, &k.Source, &k.Deleted); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan branch key: %w", err)
		}
		st.keys[k.ID] = k
	}
	rows.Close()
	if st.segs, err = branchSegments(ctx, q, branchID, ""); err != nil {
		return nil, err
	}
	return st, nil
}

func (st *branchState) value(keyID, lang string) *string {
	if s := st.segs[keyID][lang]; s != nil {
		return s.Value
	}
	return nil
}

func eq(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

// computePreview classifies every key of a branch against its base and current main.
func (a *App) computePreview(ctx context.Context, q db, p *Project, b *Branch) (*Preview, error) {
	branch, err := loadBranchState(ctx, q, b.ID)
	if err != nil {
		return nil, err
	}
	pv := &Preview{Branch: b}
	for keyID, k := range branch.keys {
		if k.Deleted {
			continue
		}
		pv.Keys++
		for _, s := range branch.segs[keyID] {
			if s.Status == statusNeedsReview {
				pv.NeedsReview++
			}
			if s.Score != nil && *s.Score < p.MQMThreshold {
				pv.BelowThreshold++
			}
		}
	}
	if b.IsMain {
		return pv, nil
	}
	main, err := mainBranch(ctx, q, p.ID)
	if err != nil {
		return nil, err
	}
	mainState, err := loadBranchState(ctx, q, main.ID)
	if err != nil {
		return nil, err
	}
	baseKeys, baseValues, err := loadBase(ctx, q, b.ID)
	if err != nil {
		return nil, err
	}
	resolutions, err := loadResolutions(ctx, q, b.ID)
	if err != nil {
		return nil, err
	}
	holds, err := loadHolds(ctx, q, b.ID)
	if err != nil {
		return nil, err
	}
	mainLiveNames := map[string]string{}
	for id, k := range mainState.keys {
		if !k.Deleted {
			mainLiveNames[k.Name] = id
		}
	}
	ids := map[string]bool{}
	for id := range baseKeys {
		ids[id] = true
	}
	for id := range branch.keys {
		ids[id] = true
	}
	for id := range ids {
		an := analyseKey(id, p, baseKeys, baseValues, branch, mainState, mainLiveNames)
		if an.Kind == kindNone && len(an.conflicts()) == 0 {
			continue
		}
		pv.Analyses = append(pv.Analyses, an)
	}
	sort.Slice(pv.Analyses, func(i, j int) bool { return pv.Analyses[i].Name < pv.Analyses[j].Name })
	for _, an := range pv.Analyses {
		switch an.Kind {
		case kindNew:
			pv.NewKeys++
		case kindEdited:
			pv.EditedKeys++
		case kindDeleted:
			pv.DeletedKeys++
		}
		for _, c := range an.conflicts() {
			if r, ok := resolutions[c.ID]; ok && eq(r.MainSeen, c.Main) {
				c.Resolution = r
			}
			if until, ok := holds[c.ID]; ok {
				c.HeldUntil = until
			}
			pv.Conflicts = append(pv.Conflicts, c)
		}
	}
	return pv, nil
}

func (an *keyAnalysis) conflicts() []*Conflict {
	var out []*Conflict
	if an.Presence != nil {
		out = append(out, an.Presence)
	}
	for i := range an.Fields {
		if an.Fields[i].Conflict != nil {
			out = append(out, an.Fields[i].Conflict)
		}
	}
	return out
}

func analyseKey(id string, p *Project, baseKeys map[string]Key, baseValues map[string]map[string]*string,
	branch, main *branchState, mainLiveNames map[string]string) *keyAnalysis {
	base, inBase := baseKeys[id]
	bk, hasBranch := branch.keys[id]
	mk, hasMain := main.keys[id]
	an := &keyAnalysis{KeyID: id, Kind: kindNone, Name: base.Name}
	if hasBranch {
		an.BranchKey = &bk
		an.Name = bk.Name
	}
	branchLive := hasBranch && !bk.Deleted
	mainLive := hasMain && !mk.Deleted
	conflict := func(field string, base, mainV, branchV *string) *Conflict {
		c := &Conflict{ID: id + ":" + field, KeyID: id, Key: an.Name, Field: field, Base: base, Main: mainV, Branch: branchV}
		if hasBranch {
			c.branchKeyName = bk.Name
		}
		return c
	}
	if !inBase {
		if !branchLive {
			return an
		}
		an.Kind = kindNew
		if other, taken := mainLiveNames[bk.Name]; taken && other != id {
			an.Fields = append(an.Fields, fieldDiff{Field: "name", Branch: &bk.Name, BranchChanged: true,
				Conflict: conflict("name", nil, nil, &bk.Name)})
		}
		return an
	}
	present, changed, deleted := "present", "changed", "deleted"
	mainChanged := mainLive && differsFromBase(id, base, baseValues, mk, main, p)
	branchChanged := branchLive && differsFromBase(id, base, baseValues, bk, branch, p)
	switch {
	case !branchLive && !mainLive:
		return an
	case !branchLive:
		if mainChanged {
			an.Presence = conflict("presence", &present, &changed, &deleted)
			an.Kind = kindPresence
		} else {
			an.Kind = kindDeleted
		}
		return an
	case !mainLive:
		if branchChanged {
			an.Presence = conflict("presence", &present, &deleted, &changed)
			an.Kind = kindPresence
		}
		return an
	}
	add := func(field string, baseV, mainV, branchV *string) {
		d := fieldDiff{Field: field, Base: baseV, Main: mainV, Branch: branchV, BranchChanged: !eq(branchV, baseV)}
		if d.BranchChanged && !eq(mainV, baseV) && !eq(branchV, mainV) {
			d.Conflict = conflict(field, baseV, mainV, branchV)
		}
		an.Fields = append(an.Fields, d)
	}
	add("name", &base.Name, &mk.Name, &bk.Name)
	add("source", &base.Source, &mk.Source, &bk.Source)
	for _, lang := range p.TargetLanguages {
		add(translationField+lang, baseValues[id][lang], main.value(id, lang), branch.value(id, lang))
	}
	for i := range an.Fields {
		f := &an.Fields[i]
		if f.Field == "name" && f.Conflict == nil && f.BranchChanged && !eq(f.Branch, f.Main) {
			if other, taken := mainLiveNames[bk.Name]; taken && other != id {
				f.Conflict = conflict("name", f.Base, f.Main, f.Branch)
			}
		}
	}
	hasConflict, edited := false, false
	for _, f := range an.Fields {
		hasConflict = hasConflict || f.Conflict != nil
		edited = edited || f.BranchChanged
	}
	if edited && !hasConflict {
		an.Kind = kindEdited
	}
	return an
}

func differsFromBase(id string, base Key, baseValues map[string]map[string]*string, mk Key, main *branchState, p *Project) bool {
	if mk.Name != base.Name || mk.Source != base.Source {
		return true
	}
	for _, lang := range p.TargetLanguages {
		if !eq(main.value(id, lang), baseValues[id][lang]) {
			return true
		}
	}
	return false
}

func loadBase(ctx context.Context, q db, branchID string) (map[string]Key, map[string]map[string]*string, error) {
	keys := map[string]Key{}
	rows, err := q.Query(ctx, "SELECT key_id, name, source FROM base_keys WHERE branch_id = $1", branchID)
	if err != nil {
		return nil, nil, fmt.Errorf("load base keys: %w", err)
	}
	for rows.Next() {
		var k Key
		if err := rows.Scan(&k.ID, &k.Name, &k.Source); err != nil {
			rows.Close()
			return nil, nil, fmt.Errorf("scan base key: %w", err)
		}
		keys[k.ID] = k
	}
	rows.Close()
	values := map[string]map[string]*string{}
	rows, err = q.Query(ctx, "SELECT key_id, language, value FROM base_values WHERE branch_id = $1", branchID)
	if err != nil {
		return nil, nil, fmt.Errorf("load base values: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id, lang string
		var v *string
		if err := rows.Scan(&id, &lang, &v); err != nil {
			return nil, nil, fmt.Errorf("scan base value: %w", err)
		}
		if values[id] == nil {
			values[id] = map[string]*string{}
		}
		values[id][lang] = v
	}
	return keys, values, rows.Err()
}

func loadResolutions(ctx context.Context, q db, branchID string) (map[string]*Resolution, error) {
	rows, err := q.Query(ctx, "SELECT conflict_id, choice, value, by, at, main_seen FROM resolutions WHERE branch_id = $1", branchID)
	if err != nil {
		return nil, fmt.Errorf("load resolutions: %w", err)
	}
	defer rows.Close()
	out := map[string]*Resolution{}
	for rows.Next() {
		var id string
		var r Resolution
		if err := rows.Scan(&id, &r.Choice, &r.Value, &r.By, &r.At, &r.MainSeen); err != nil {
			return nil, fmt.Errorf("scan resolution: %w", err)
		}
		out[id] = &r
	}
	return out, rows.Err()
}

func loadHolds(ctx context.Context, q db, branchID string) (map[string]*time.Time, error) {
	rows, err := q.Query(ctx, "SELECT conflict_id, held_until FROM holds WHERE branch_id = $1 AND held_until > $2", branchID, time.Now().UTC())
	if err != nil {
		return nil, fmt.Errorf("load holds: %w", err)
	}
	defer rows.Close()
	out := map[string]*time.Time{}
	for rows.Next() {
		var id string
		var until time.Time
		if err := rows.Scan(&id, &until); err != nil {
			return nil, fmt.Errorf("scan hold: %w", err)
		}
		out[id] = &until
	}
	return out, rows.Err()
}

func (a *App) handlePreview(w http.ResponseWriter, r *http.Request) error {
	_, p, b, err := a.ownerBranch(r)
	if err != nil {
		return err
	}
	pv, err := a.computePreview(r.Context(), a.pool, p, b)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, pv.json())
	return nil
}

func (pv *Preview) conflict(id string) *Conflict {
	for _, c := range pv.Conflicts {
		if c.ID == id {
			return c
		}
	}
	return nil
}

func (pv *Preview) unresolvedIDs() []string {
	ids := []string{}
	for _, c := range pv.Conflicts {
		if c.Resolution == nil {
			ids = append(ids, c.ID)
		}
	}
	return ids
}
