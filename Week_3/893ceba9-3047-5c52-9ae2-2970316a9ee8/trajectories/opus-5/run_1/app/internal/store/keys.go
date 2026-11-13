package store

import (
	"context"
	"fmt"

	"github.com/marlowquill/interline-desk/internal/domain"
)

// SourceChanged carries the one rule for a changed key source: every segment of
// that key on that branch that has a value goes to review, and untranslated
// segments are filled from an exact match.
func (s *Store) SourceChanged(ctx context.Context, db DB, project *Project, branchID, keyID, source, actor string) error {
	rows, err := db.Query(ctx, `select id, status from segments where branch_id = $1 and key_id = $2
	        and value is not null`, branchID, keyID)
	if err != nil {
		return fmt.Errorf("list segments of changed key: %w", err)
	}
	type affected struct {
		id     string
		status string
	}
	var segments []affected
	for rows.Next() {
		var a affected
		if err := rows.Scan(&a.id, &a.status); err != nil {
			rows.Close()
			return fmt.Errorf("scan segment of changed key: %w", err)
		}
		segments = append(segments, a)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	now := Now()
	for _, segment := range segments {
		if segment.status == domain.StatusNeedsReview {
			continue
		}
		if err := s.SetSegmentStatus(ctx, db, segment.id, domain.StatusNeedsReview); err != nil {
			return err
		}
		if err := s.AddSegmentRevision(ctx, db, segment.id, actor, segment.status,
			domain.StatusNeedsReview, nil, now); err != nil {
			return err
		}
	}
	if _, err := s.FillFromMemory(ctx, db, project, branchID, keyID, source, actor); err != nil {
		return err
	}
	return nil
}
