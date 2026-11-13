package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/marlowquill/interline-desk/internal/domain"
)

// MemoryMatch is the oldest translation-memory entry that matches a source.
type MemoryMatch struct {
	EntryID string
	Source  string
	Target  string
}

// MatchEntry finds the oldest exact match for a normalised source.
func (s *Store) MatchEntry(ctx context.Context, db DB, projectID, language, normSource string) (*MemoryMatch, error) {
	match := &MemoryMatch{}
	err := db.QueryRow(ctx, `select id, source, target from tm_entries
	        where project_id = $1 and target_language = $2 and norm_source = $3
	        order by created_at, seq limit 1`, projectID, language, normSource).
		Scan(&match.EntryID, &match.Source, &match.Target)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read memory match: %w", err)
	}
	return match, nil
}

// FillFromMemory fills a key's untranslated segments on one branch from exact
// matches. It is the one place every reuse of a match runs through.
func (s *Store) FillFromMemory(ctx context.Context, db DB, project *Project, branchID, keyID, source, actor string) (int, error) {
	normSource := domain.Normalise(source)
	filled := 0
	for _, language := range project.TargetLanguages {
		var segmentID string
		var status string
		err := db.QueryRow(ctx, `select id, status from segments where branch_id = $1 and key_id = $2
		        and language = $3`, branchID, keyID, language).Scan(&segmentID, &status)
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return filled, fmt.Errorf("read segment for memory fill: %w", err)
		}
		if status != domain.StatusUntranslated {
			continue
		}
		match, err := s.MatchEntry(ctx, db, project.ID, language, normSource)
		if err != nil {
			return filled, err
		}
		if match == nil {
			continue
		}
		value := domain.ReuseValue(match.Source, match.Target, source)
		origin := "tm"
		if err := s.WriteSegment(ctx, db, segmentID, &value, domain.StatusDrafted, nil, &origin); err != nil {
			return filled, err
		}
		if err := s.AddSegmentRevision(ctx, db, segmentID, actor, domain.StatusUntranslated,
			domain.StatusDrafted, &value, Now()); err != nil {
			return filled, err
		}
		filled++
	}
	return filled, nil
}

// ApplyMemoryToMain runs the apply step of an import over every entry in the
// project's memory, filling untranslated main segments.
func (s *Store) ApplyMemoryToMain(ctx context.Context, db DB, project *Project, mainID, actor string) (int, error) {
	rows, err := db.Query(ctx, `select key_id, source from keys where branch_id = $1 and not deleted`, mainID)
	if err != nil {
		return 0, fmt.Errorf("list main keys: %w", err)
	}
	type liveKey struct {
		id     string
		source string
	}
	var keys []liveKey
	for rows.Next() {
		var k liveKey
		if err := rows.Scan(&k.id, &k.source); err != nil {
			rows.Close()
			return 0, fmt.Errorf("scan main key: %w", err)
		}
		keys = append(keys, k)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	applied := 0
	for _, k := range keys {
		filled, err := s.FillFromMemory(ctx, db, project, mainID, k.id, k.source, actor)
		if err != nil {
			return applied, err
		}
		applied += filled
	}
	return applied, nil
}

// InsertTMEntry adds one entry, reporting whether it was new.
func (s *Store) InsertTMEntry(ctx context.Context, db DB, projectID, language, source, target, note, importID string, at time.Time) (bool, error) {
	tag, err := db.Exec(ctx, `insert into tm_entries (id, project_id, target_language, source, target,
	        norm_source, norm_target, note, import_id, created_at)
	        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
	        on conflict (project_id, target_language, norm_source, norm_target) do nothing`,
		NewID(), projectID, language, source, target, domain.Normalise(source), domain.Normalise(target),
		note, importID, at)
	if err != nil {
		return false, fmt.Errorf("insert memory entry: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}

// MemoryHolds reports whether the memory already holds this exact entry.
func (s *Store) MemoryHolds(ctx context.Context, db DB, projectID, language, normSource, normTarget string) (bool, error) {
	var n int
	err := db.QueryRow(ctx, `select count(*) from tm_entries where project_id = $1 and target_language = $2
	        and norm_source = $3 and norm_target = $4`, projectID, language, normSource, normTarget).Scan(&n)
	if err != nil {
		return false, fmt.Errorf("read memory entry: %w", err)
	}
	return n > 0, nil
}

// ConflictingTarget reports whether the memory already holds a different
// target for the same normalised source and language.
func (s *Store) ConflictingTarget(ctx context.Context, db DB, projectID, language, normSource, normTarget string) (bool, error) {
	var n int
	err := db.QueryRow(ctx, `select count(*) from tm_entries where project_id = $1 and target_language = $2
	        and norm_source = $3 and norm_target <> $4`, projectID, language, normSource, normTarget).Scan(&n)
	if err != nil {
		return false, fmt.Errorf("read conflicting target: %w", err)
	}
	return n > 0, nil
}

// MemoryEntries lists entries, matching q against normalised source text.
func (s *Store) MemoryEntries(ctx context.Context, projectID, language, query string) ([]TMEntry, int, error) {
	args := []any{projectID}
	where := `project_id = $1`
	if language != "" {
		args = append(args, language)
		where += fmt.Sprintf(" and target_language = $%d", len(args))
	}
	if query != "" {
		args = append(args, "%"+domain.Normalise(query)+"%")
		where += fmt.Sprintf(" and norm_source like $%d", len(args))
	}
	rows, err := s.Pool.Query(ctx, `select id, source, target, target_language, import_id from tm_entries
	        where `+where+` order by created_at, seq`, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("list memory entries: %w", err)
	}
	defer rows.Close()
	entries := []TMEntry{}
	for rows.Next() {
		var entry TMEntry
		if err := rows.Scan(&entry.ID, &entry.Source, &entry.Target, &entry.TargetLanguage, &entry.ImportID); err != nil {
			return nil, 0, fmt.Errorf("scan memory entry: %w", err)
		}
		entries = append(entries, entry)
	}
	return entries, len(entries), rows.Err()
}

type ImportReport struct {
	ImportID   string           `json:"import_id"`
	Filename   string           `json:"filename"`
	Format     string           `json:"format"`
	Size       int64            `json:"size"`
	SHA256     string           `json:"sha256"`
	ObjectKey  string           `json:"object_key"`
	Added      int              `json:"added"`
	Duplicates int              `json:"duplicates"`
	Applied    int              `json:"applied"`
	Rows       []ImportRowIssue `json:"rows"`
}

type ImportRowIssue struct {
	Line   int    `json:"line"`
	Reason string `json:"reason"`
}

func (s *Store) InsertTMImport(ctx context.Context, db DB, projectID string, report *ImportReport, at time.Time) error {
	rows, err := json.Marshal(report.Rows)
	if err != nil {
		return fmt.Errorf("encode import report: %w", err)
	}
	if _, err := db.Exec(ctx, `insert into tm_imports (id, project_id, filename, format, size, sha256,
	        object_key, added, duplicates, applied, report, at)
	        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
		report.ImportID, projectID, report.Filename, report.Format, report.Size, report.SHA256,
		report.ObjectKey, report.Added, report.Duplicates, report.Applied, rows, at); err != nil {
		return fmt.Errorf("insert import: %w", err)
	}
	return nil
}

func (s *Store) TMImports(ctx context.Context, projectID string) ([]TMImport, error) {
	rows, err := s.Pool.Query(ctx, `select id, filename, format, size, sha256, at, restored_at,
	        added, duplicates, applied, report from tm_imports
	        where project_id = $1 order by at desc`, projectID)
	if err != nil {
		return nil, fmt.Errorf("list imports: %w", err)
	}
	defer rows.Close()
	out := []TMImport{}
	for rows.Next() {
		var record TMImport
		var report []byte
		if err := rows.Scan(&record.ImportID, &record.Filename, &record.Format, &record.Size,
			&record.SHA256, &record.At, &record.RestoredAt, &record.Added, &record.Duplicates,
			&record.Applied, &report); err != nil {
			return nil, fmt.Errorf("scan import: %w", err)
		}
		record.At = record.At.UTC()
		record.Rows = []ImportRowIssue{}
		if len(report) > 0 {
			if err := json.Unmarshal(report, &record.Rows); err != nil {
				return nil, fmt.Errorf("decode import report: %w", err)
			}
		}
		out = append(out, record)
	}
	return out, rows.Err()
}

// TMImportObject reads the stored object key and filename of an import.
func (s *Store) TMImportObject(ctx context.Context, projectID, importID string) (objectKey, filename string, err error) {
	row := s.Pool.QueryRow(ctx, `select object_key, filename from tm_imports
	        where project_id = $1 and id = $2`, projectID, importID)
	if err := row.Scan(&objectKey, &filename); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", "", ErrNotFound
		}
		return "", "", fmt.Errorf("read import: %w", err)
	}
	return objectKey, filename, nil
}

func (s *Store) InsertSourceFile(ctx context.Context, db DB, projectID string, file *SourceFile, objectKey string) error {
	if _, err := db.Exec(ctx, `insert into source_files (id, project_id, branch, filename, content_type,
	        size, sha256, object_key, at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		file.FileID, projectID, file.Branch, file.Filename, file.ContentType, file.Size, file.SHA256,
		objectKey, file.At); err != nil {
		return fmt.Errorf("insert source file: %w", err)
	}
	return nil
}

func (s *Store) SourceFiles(ctx context.Context, projectID string) ([]SourceFile, error) {
	rows, err := s.Pool.Query(ctx, `select id, branch, filename, content_type, size, sha256, at
	        from source_files where project_id = $1 order by at desc`, projectID)
	if err != nil {
		return nil, fmt.Errorf("list source files: %w", err)
	}
	defer rows.Close()
	out := []SourceFile{}
	for rows.Next() {
		var file SourceFile
		if err := rows.Scan(&file.FileID, &file.Branch, &file.Filename, &file.ContentType, &file.Size,
			&file.SHA256, &file.At); err != nil {
			return nil, fmt.Errorf("scan source file: %w", err)
		}
		file.At = file.At.UTC()
		out = append(out, file)
	}
	return out, rows.Err()
}

func (s *Store) SourceFileObject(ctx context.Context, projectID, fileID string) (objectKey, filename, contentType string, err error) {
	row := s.Pool.QueryRow(ctx, `select object_key, filename, content_type from source_files
	        where project_id = $1 and id = $2`, projectID, fileID)
	if err := row.Scan(&objectKey, &filename, &contentType); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", "", "", ErrNotFound
		}
		return "", "", "", fmt.Errorf("read source file: %w", err)
	}
	return objectKey, filename, contentType, nil
}
