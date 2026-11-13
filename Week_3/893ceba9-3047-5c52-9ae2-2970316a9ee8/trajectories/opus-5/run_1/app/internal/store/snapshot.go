package store

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/marlowquill/interline-desk/internal/domain"
)

// Snapshot is the exact earlier state of main and the translation memory that
// an import or a merge can be restored to.
type Snapshot struct {
	MainKeys  []SnapshotKey   `json:"main_keys"`
	TMEntries []SnapshotEntry `json:"tm_entries"`
}

type SnapshotKey struct {
	KeyID    string            `json:"key_id"`
	Name     string            `json:"name"`
	Source   string            `json:"source"`
	Deleted  bool              `json:"deleted"`
	Segments []SnapshotSegment `json:"segments"`
}

type SnapshotSegment struct {
	ID       string           `json:"id"`
	Language string           `json:"language"`
	Value    *string          `json:"value"`
	Status   string           `json:"status"`
	Score    *int             `json:"score"`
	Origin   *string          `json:"origin"`
	Issues   []domain.Issue   `json:"issues"`
	Comments []domain.Comment `json:"comments"`
}

type SnapshotEntry struct {
	ID             string    `json:"id"`
	TargetLanguage string    `json:"target_language"`
	Source         string    `json:"source"`
	Target         string    `json:"target"`
	NormSource     string    `json:"norm_source"`
	NormTarget     string    `json:"norm_target"`
	Note           string    `json:"note"`
	ImportID       *string   `json:"import_id"`
	CreatedAt      time.Time `json:"created_at"`
}

// TakeSnapshot reads main and the memory exactly as they stand.
func (s *Store) TakeSnapshot(ctx context.Context, db DB, projectID, mainID string) (*Snapshot, error) {
	snapshot := &Snapshot{MainKeys: []SnapshotKey{}, TMEntries: []SnapshotEntry{}}
	rows, err := db.Query(ctx, `select key_id, name, source, deleted from keys where branch_id = $1
	        order by key_id`, mainID)
	if err != nil {
		return nil, fmt.Errorf("snapshot keys: %w", err)
	}
	for rows.Next() {
		var key SnapshotKey
		if err := rows.Scan(&key.KeyID, &key.Name, &key.Source, &key.Deleted); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan snapshot key: %w", err)
		}
		key.Segments = []SnapshotSegment{}
		snapshot.MainKeys = append(snapshot.MainKeys, key)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	index := map[string]int{}
	for i, key := range snapshot.MainKeys {
		index[key.KeyID] = i
	}
	segmentRows, err := db.Query(ctx, `select id, key_id, language, value, status, score, origin from segments
	        where branch_id = $1 order by id`, mainID)
	if err != nil {
		return nil, fmt.Errorf("snapshot segments: %w", err)
	}
	type held struct {
		keyID   string
		segment SnapshotSegment
	}
	var segments []held
	for segmentRows.Next() {
		var item held
		if err := segmentRows.Scan(&item.segment.ID, &item.keyID, &item.segment.Language, &item.segment.Value,
			&item.segment.Status, &item.segment.Score, &item.segment.Origin); err != nil {
			segmentRows.Close()
			return nil, fmt.Errorf("scan snapshot segment: %w", err)
		}
		segments = append(segments, item)
	}
	segmentRows.Close()
	if err := segmentRows.Err(); err != nil {
		return nil, err
	}
	for _, item := range segments {
		issues, err := s.SegmentIssues(ctx, db, item.segment.ID)
		if err != nil {
			return nil, err
		}
		comments, err := s.SegmentComments(ctx, db, item.segment.ID)
		if err != nil {
			return nil, err
		}
		item.segment.Issues = issues
		item.segment.Comments = comments
		if at, ok := index[item.keyID]; ok {
			snapshot.MainKeys[at].Segments = append(snapshot.MainKeys[at].Segments, item.segment)
		}
	}

	entryRows, err := db.Query(ctx, `select id, target_language, source, target, norm_source, norm_target,
	        note, import_id, created_at from tm_entries where project_id = $1 order by created_at, seq`, projectID)
	if err != nil {
		return nil, fmt.Errorf("snapshot memory: %w", err)
	}
	defer entryRows.Close()
	for entryRows.Next() {
		var entry SnapshotEntry
		if err := entryRows.Scan(&entry.ID, &entry.TargetLanguage, &entry.Source, &entry.Target,
			&entry.NormSource, &entry.NormTarget, &entry.Note, &entry.ImportID, &entry.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan snapshot entry: %w", err)
		}
		entry.CreatedAt = entry.CreatedAt.UTC()
		snapshot.TMEntries = append(snapshot.TMEntries, entry)
	}
	return snapshot, entryRows.Err()
}

func (s *Snapshot) Encode() ([]byte, error) {
	encoded, err := json.Marshal(s)
	if err != nil {
		return nil, fmt.Errorf("encode snapshot: %w", err)
	}
	return encoded, nil
}

func DecodeSnapshot(raw []byte) (*Snapshot, error) {
	snapshot := &Snapshot{}
	if err := json.Unmarshal(raw, snapshot); err != nil {
		return nil, fmt.Errorf("decode snapshot: %w", err)
	}
	return snapshot, nil
}

// RestoreSnapshot writes main and the memory back exactly as the snapshot
// holds them, down to key ids, segment ids, statuses, scores, issues and
// comments.
func (s *Store) RestoreSnapshot(ctx context.Context, tx pgx.Tx, project *Project, mainID string, snapshot *Snapshot, actor string) error {
	if _, err := tx.Exec(ctx, `delete from segment_issues where segment_id in
	        (select id from segments where branch_id = $1)`, mainID); err != nil {
		return fmt.Errorf("clear issues for restore: %w", err)
	}
	if _, err := tx.Exec(ctx, `delete from segment_comments where segment_id in
	        (select id from segments where branch_id = $1)`, mainID); err != nil {
		return fmt.Errorf("clear comments for restore: %w", err)
	}
	if _, err := tx.Exec(ctx, `delete from segments where branch_id = $1`, mainID); err != nil {
		return fmt.Errorf("clear segments for restore: %w", err)
	}
	if _, err := tx.Exec(ctx, `delete from keys where branch_id = $1`, mainID); err != nil {
		return fmt.Errorf("clear keys for restore: %w", err)
	}
	now := Now()
	for _, key := range snapshot.MainKeys {
		if _, err := tx.Exec(ctx, `insert into keys (id, project_id, branch_id, key_id, name, source, deleted)
		        values ($1,$2,$3,$4,$5,$6,$7)`, NewID(), project.ID, mainID, key.KeyID, key.Name,
			key.Source, key.Deleted); err != nil {
			return fmt.Errorf("restore key: %w", err)
		}
		for _, segment := range key.Segments {
			if _, err := tx.Exec(ctx, `insert into segments (id, project_id, branch_id, key_id, language,
			        value, status, score, origin) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
				segment.ID, project.ID, mainID, key.KeyID, segment.Language, segment.Value,
				segment.Status, segment.Score, segment.Origin); err != nil {
				return fmt.Errorf("restore segment: %w", err)
			}
			for i, issue := range segment.Issues {
				if _, err := tx.Exec(ctx, `insert into segment_issues (id, segment_id, ord, category,
				        severity, note) values ($1,$2,$3,$4,$5,$6)`, NewID(), segment.ID, i,
					issue.Category, issue.Severity, issue.Note); err != nil {
					return fmt.Errorf("restore issue: %w", err)
				}
			}
			for _, comment := range segment.Comments {
				if _, err := tx.Exec(ctx, `insert into segment_comments (id, segment_id, author, body, at)
				        values ($1,$2,$3,$4,$5)`, comment.ID, segment.ID, comment.Author, comment.Body,
					comment.At); err != nil {
					return fmt.Errorf("restore comment: %w", err)
				}
			}
		}
		if err := s.AddKeyRevision(ctx, tx, project.ID, key.KeyID, "main", "restored", nil, &key.Source,
			actor, now); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx, `delete from tm_entries where project_id = $1`, project.ID); err != nil {
		return fmt.Errorf("clear memory for restore: %w", err)
	}
	for _, entry := range snapshot.TMEntries {
		if _, err := tx.Exec(ctx, `insert into tm_entries (id, project_id, target_language, source, target,
		        norm_source, norm_target, note, import_id, created_at)
		        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, entry.ID, project.ID, entry.TargetLanguage,
			entry.Source, entry.Target, entry.NormSource, entry.NormTarget, entry.Note, entry.ImportID,
			entry.CreatedAt); err != nil {
			return fmt.Errorf("restore memory entry: %w", err)
		}
	}
	return nil
}

// EraseProject removes every row that holds the project's id or slug and
// leaves one anonymous erasure entry behind.
func (s *Store) EraseProject(ctx context.Context, project *Project, appUID string) error {
	return s.InTx(ctx, func(tx pgx.Tx) error {
		statements := []string{
			`delete from segment_issues where segment_id in (select id from segments where project_id = $1)`,
			`delete from segment_comments where segment_id in (select id from segments where project_id = $1)`,
			`delete from segment_history where segment_id in (select id from segments where project_id = $1)`,
			`delete from segments where project_id = $1`,
			`delete from keys where project_id = $1`,
			`delete from key_history where project_id = $1`,
			`delete from holds where branch_id in (select id from branches where project_id = $1)`,
			`delete from resolutions where branch_id in (select id from branches where project_id = $1)`,
			`delete from branches where project_id = $1`,
			`delete from tm_entries where project_id = $1`,
			`delete from tm_imports where project_id = $1`,
			`delete from source_files where project_id = $1`,
			`delete from operations where project_id = $1`,
			`delete from assignments where project_id = $1`,
			`delete from tokens where project_id = $1`,
			`delete from webhooks where project_id = $1`,
			`delete from events where project_id = $1`,
			`delete from idempotency where project_id = $1`,
			`delete from publishes where project_id = $1`,
			`delete from reviewer_scopes where project_id = $1`,
			`delete from audit where project_id = $1`,
			`delete from projects where id = $1`,
		}
		for _, statement := range statements {
			if _, err := tx.Exec(ctx, statement, project.ID); err != nil {
				return fmt.Errorf("erase project rows: %w", err)
			}
		}
		if _, err := tx.Exec(ctx, `delete from audit where project = $1`, project.Slug); err != nil {
			return fmt.Errorf("erase project audit entries: %w", err)
		}
		return s.AddAudit(ctx, tx, "system", "project.erased", "", "", nil)
	})
}
