package main

import (
	"context"
	"database/sql"
	"encoding/json"
)

// Tx variants of the comparison loaders, used inside the merge transaction.

func (s *Server) loadComparisonTx(ctx context.Context, tx *sql.Tx, p *Project, branchID string) (map[string]*keyState, map[string]*keyState, map[string]*keyState, map[string]*segState, map[string]*segState, error) {
	baseKeys, err := s.baseKeysTx(ctx, tx, branchID)
	if err != nil {
		return nil, nil, nil, nil, nil, err
	}
	mainID, err := mainBranchIDTx(ctx, tx, p.ID)
	if err != nil {
		return nil, nil, nil, nil, nil, err
	}
	mainKeys, err := keysByBranchTx(ctx, tx, mainID)
	if err != nil {
		return nil, nil, nil, nil, nil, err
	}
	branchKeys, err := keysByBranchTx(ctx, tx, branchID)
	if err != nil {
		return nil, nil, nil, nil, nil, err
	}
	mainSegs, err := s.segStatesTx(ctx, tx, mainID)
	if err != nil {
		return nil, nil, nil, nil, nil, err
	}
	branchSegs, err := s.segStatesTx(ctx, tx, branchID)
	if err != nil {
		return nil, nil, nil, nil, nil, err
	}
	base := map[string]*keyState{}
	for _, b := range baseKeys {
		base[b.KeyID] = &keyState{KeyID: b.KeyID, Name: b.Name, Source: b.Source, Present: b.Present, MainSegID: b.KeyID}
	}
	main := map[string]*keyState{}
	for _, k := range mainKeys {
		main[k.ID] = &keyState{KeyID: k.ID, Name: k.Name, Source: k.Source, Present: true, MainSegID: k.ID}
	}
	branch := map[string]*keyState{}
	for _, k := range branchKeys {
		branch[k.ID] = &keyState{KeyID: k.ID, Name: k.Name, Source: k.Source, Present: true, MainSegID: k.ID}
	}
	return base, main, branch, mainSegs, branchSegs, nil
}

func (s *Server) baseKeysTx(ctx context.Context, tx *sql.Tx, branchID string) ([]baseKey, error) {
	rows, err := tx.QueryContext(ctx, `SELECT key_id, name, source, present FROM branch_bases WHERE branch_id = $1`, branchID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []baseKey
	for rows.Next() {
		var b baseKey
		if err := rows.Scan(&b.KeyID, &b.Name, &b.Source, &b.Present); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

func keysByBranchTx(ctx context.Context, tx *sql.Tx, branchID string) ([]*KeyRow, error) {
	rows, err := tx.QueryContext(ctx, `SELECT id, name, source FROM keys WHERE branch_id = $1 AND NOT deleted ORDER BY name`, branchID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []*KeyRow
	for rows.Next() {
		var k KeyRow
		if err := rows.Scan(&k.ID, &k.Name, &k.Source); err != nil {
			return nil, err
		}
		out = append(out, &k)
	}
	return out, rows.Err()
}

func (s *Server) segStatesTx(ctx context.Context, tx *sql.Tx, branchID string) (map[string]*segState, error) {
	rows, err := tx.QueryContext(ctx, `SELECT key_id, language, value FROM segments WHERE branch_id = $1`, branchID)
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

func (s *Server) loadConflictsTx(ctx context.Context, tx *sql.Tx, branchID string) (map[string]persistedConflict, error) {
	rows, err := tx.QueryContext(ctx, `SELECT id, resolution, held_until, seen_main FROM conflicts WHERE branch_id = $1`, branchID)
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

func resolutionVoidTx(pc persistedConflict, c conflictOut) bool {
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
