package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/marlowquill/interline-desk/internal/domain"
	"github.com/marlowquill/interline-desk/internal/s3lite"
	"github.com/marlowquill/interline-desk/internal/store"
)

func (s *Server) handleListTM(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	language := r.URL.Query().Get("lang")
	if language != "" && !containsString(c.project.TargetLanguages, language) {
		return errField("lang", "That language is not a target of this project.")
	}
	entries, total, err := s.store.MemoryEntries(r.Context(), c.project.ID, language, r.URL.Query().Get("q"))
	if err != nil {
		return errInternal(err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": entries, "total": total})
	return nil
}

func (s *Server) handleListTMImports(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	imports, err := s.store.TMImports(r.Context(), c.project.ID)
	if err != nil {
		return errInternal(err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"imports": imports})
	return nil
}

func (s *Server) handleTMImportOriginal(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	objectKey, filename, err := s.store.TMImportObject(r.Context(), c.project.ID, r.PathValue("import_id"))
	if errors.Is(err, store.ErrNotFound) {
		return errNotFound()
	}
	if err != nil {
		return errInternal(err)
	}
	return s.streamObject(w, r, objectKey, filename, "")
}

func (s *Server) streamObject(w http.ResponseWriter, r *http.Request, objectKey, filename, contentType string) *apiError {
	ctx, cancel := withTimeout(r.Context(), 10*time.Second)
	defer cancel()
	object, err := s.objects.Get(ctx, objectKey)
	if err != nil {
		if errors.Is(err, s3lite.ErrUnavailable) {
			return errStorageUnavailable()
		}
		return errNotFound()
	}
	if contentType == "" {
		contentType = object.ContentType
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", `attachment; filename="`+strings.ReplaceAll(filename, `"`, "")+`"`)
	w.Header().Set("Content-Length", fmtInt(len(object.Body)))
	_, _ = w.Write(object.Body)
	return nil
}

// handleTMImport imports a TMX or CSV file into the project's memory.
func (s *Server) handleTMImport(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	file, values, fail := readUpload(r, "file")
	if fail != nil {
		return fail
	}
	format := strings.ToLower(strings.TrimSpace(values["format"]))
	if format != "tmx" && format != "csv" {
		return errField("format", "Choose TMX or CSV.")
	}
	var rows []importRow
	if format == "csv" {
		rows, fail = parseCSV(file.Bytes)
	} else {
		rows, fail = parseTMX(file.Bytes, c.project.SourceLanguage, c.project.TargetLanguages)
	}
	if fail != nil {
		return fail
	}

	ctx := r.Context()
	main, err := s.store.BranchByName(ctx, s.store.Pool, c.project.ID, "main")
	if err != nil {
		return errInternal(err)
	}
	importID := store.NewID()
	snapshot, err := s.store.TakeSnapshot(ctx, s.store.Pool, c.project.ID, main.ID)
	if err != nil {
		return errInternal(err)
	}
	encoded, err := snapshot.Encode()
	if err != nil {
		return errInternal(err)
	}
	snapshotKey := fmt.Sprintf("projects/%s/snapshots/%s.json", c.project.ID, importID)
	objectKey := fmt.Sprintf("projects/%s/imports/%s", c.project.ID, importID)
	storeCtx, cancel := withTimeout(ctx, 15*time.Second)
	defer cancel()
	if err := s.objects.Put(storeCtx, snapshotKey, "application/json", encoded); err != nil {
		return errStorageUnavailable()
	}
	contentType := file.ContentType
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	if err := s.objects.Put(storeCtx, objectKey, contentType, file.Bytes); err != nil {
		return errStorageUnavailable()
	}

	report := &store.ImportReport{
		ImportID: importID, Filename: file.Name, Format: format, Size: int64(len(file.Bytes)),
		SHA256: file.SHA256, ObjectKey: objectKey, Rows: []store.ImportRowIssue{},
	}
	err = s.store.InTx(ctx, func(tx pgx.Tx) error {
		return s.applyImport(ctx, tx, c, main, rows, report, snapshotKey)
	})
	if err != nil {
		return errInternal(err)
	}
	sort.Slice(report.Rows, func(i, j int) bool {
		if report.Rows[i].Line != report.Rows[j].Line {
			return report.Rows[i].Line < report.Rows[j].Line
		}
		return report.Rows[i].Reason < report.Rows[j].Reason
	})
	writeJSON(w, http.StatusCreated, report)
	return nil
}

// applyImport decides every row's one outcome, then runs the apply step over
// the whole memory.
func (s *Server) applyImport(ctx context.Context, tx pgx.Tx, c *call, main *store.Branch, rows []importRow, report *store.ImportReport, snapshotKey string) error {
	now := store.Now()
	mainSources := map[string]bool{}
	set, err := s.store.LoadKeySet(ctx, tx, main.ID)
	if err != nil {
		return err
	}
	for _, key := range set {
		mainSources[domain.Normalise(key.Source)] = true
	}
	for _, row := range rows {
		source := strings.TrimSpace(row.Source)
		target := strings.TrimSpace(row.Target)
		switch {
		case source == "":
			report.Rows = append(report.Rows, store.ImportRowIssue{Line: row.Line, Reason: "missing_source"})
			continue
		case target == "":
			report.Rows = append(report.Rows, store.ImportRowIssue{Line: row.Line, Reason: "missing_target"})
			continue
		case !containsString(c.project.TargetLanguages, row.Language):
			report.Rows = append(report.Rows, store.ImportRowIssue{Line: row.Line, Reason: "unknown_language"})
			continue
		}
		normSource := domain.Normalise(source)
		normTarget := domain.Normalise(target)
		known, err := s.store.MemoryHolds(ctx, tx, c.project.ID, row.Language, normSource, normTarget)
		if err != nil {
			return err
		}
		if known {
			report.Duplicates++
			continue
		}
		conflicting, err := s.store.ConflictingTarget(ctx, tx, c.project.ID, row.Language, normSource, normTarget)
		if err != nil {
			return err
		}
		if conflicting {
			report.Rows = append(report.Rows, store.ImportRowIssue{Line: row.Line, Reason: "conflicting_target"})
			continue
		}
		if _, err := s.store.InsertTMEntry(ctx, tx, c.project.ID, row.Language, source, target, row.Note,
			report.ImportID, now); err != nil {
			return err
		}
		report.Added++
		if !mainSources[normSource] {
			report.Rows = append(report.Rows, store.ImportRowIssue{Line: row.Line, Reason: "no_matching_key"})
		}
	}

	applied, err := s.store.ApplyMemoryToMain(ctx, tx, c.project, main.ID, c.user.Email)
	if err != nil {
		return err
	}
	report.Applied = applied

	if err := s.store.InsertOperation(ctx, tx, c.project.ID, report.ImportID, "import",
		"Import "+report.Filename, "main", snapshotKey, now); err != nil {
		return err
	}
	if err := s.store.InsertTMImport(ctx, tx, c.project.ID, report, now); err != nil {
		return err
	}
	seq, err := s.store.BumpChangeSeq(ctx, tx, c.project.ID)
	if err != nil {
		return err
	}
	if err := s.store.SealOperation(ctx, tx, report.ImportID, seq); err != nil {
		return err
	}
	return s.store.AddAudit(ctx, tx, c.user.Email, "tm.imported", c.project.Slug,
		fmt.Sprintf("%s: %d added, %d duplicates, %d reused", report.Filename, report.Added,
			report.Duplicates, report.Applied), &c.project.ID)
}

func (s *Server) handleListSourceFiles(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	files, err := s.store.SourceFiles(r.Context(), c.project.ID)
	if err != nil {
		return errInternal(err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"files": files})
	return nil
}

func (s *Server) handleSourceFileOriginal(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	objectKey, filename, contentType, err := s.store.SourceFileObject(r.Context(), c.project.ID,
		r.PathValue("file_id"))
	if errors.Is(err, store.ErrNotFound) {
		return errNotFound()
	}
	if err != nil {
		return errInternal(err)
	}
	return s.streamObject(w, r, objectKey, filename, contentType)
}

// handleSourceFileUpload adds or updates a branch's working copy from a JSON
// source locale file, keeping the submitted bytes untouched.
func (s *Server) handleSourceFileUpload(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	branch, fail := s.branchFor(r, c.project, r.PathValue("branch"))
	if fail != nil {
		return fail
	}
	if fail := requireOpen(branch); fail != nil {
		return fail
	}
	file, _, fail := readUpload(r, "file")
	if fail != nil {
		return fail
	}
	parsed, fail := parseSourceLocale(file.Bytes)
	if fail != nil {
		return fail
	}

	ctx := r.Context()
	fileID := store.NewID()
	objectKey := fmt.Sprintf("projects/%s/source-files/%s", c.project.ID, fileID)
	contentType := file.ContentType
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	storeCtx, cancel := withTimeout(ctx, 15*time.Second)
	defer cancel()
	if err := s.objects.Put(storeCtx, objectKey, contentType, file.Bytes); err != nil {
		return errStorageUnavailable()
	}

	set, err := s.store.LoadKeySet(ctx, s.store.Pool, branch.ID)
	if err != nil {
		return errInternal(err)
	}
	byName := map[string]*domain.Key{}
	for _, key := range set {
		byName[key.Name] = key
	}
	names := make([]string, 0, len(parsed))
	for name := range parsed {
		names = append(names, name)
	}
	sort.Strings(names)

	added, changed, unchanged := 0, 0, 0
	record := &store.SourceFile{FileID: fileID, Branch: branch.Name, Filename: file.Name,
		ContentType: contentType, Size: int64(len(file.Bytes)), SHA256: file.SHA256, At: store.Now()}
	err = s.store.InTx(ctx, func(tx pgx.Tx) error {
		for _, name := range names {
			value := strings.TrimSpace(parsed[name])
			existing, ok := byName[name]
			if !ok {
				keyID := store.NewID()
				if err := s.store.InsertKey(ctx, tx, c.project, branch.ID, keyID, name, value); err != nil {
					return err
				}
				if err := s.store.AddKeyRevision(ctx, tx, c.project.ID, keyID, branch.Name, "created",
					nil, &value, c.user.Email, record.At); err != nil {
					return err
				}
				if _, err := s.store.FillFromMemory(ctx, tx, c.project, branch.ID, keyID, value,
					c.user.Email); err != nil {
					return err
				}
				added++
				continue
			}
			if existing.Source == value {
				unchanged++
				continue
			}
			if _, err := tx.Exec(ctx, `update keys set source = $3 where branch_id = $1 and key_id = $2`,
				branch.ID, existing.KeyID, value); err != nil {
				return fmt.Errorf("update key source: %w", err)
			}
			if err := s.store.AddKeyRevision(ctx, tx, c.project.ID, existing.KeyID, branch.Name, "source",
				&existing.Source, &value, c.user.Email, record.At); err != nil {
				return err
			}
			if err := s.store.SourceChanged(ctx, tx, c.project, branch.ID, existing.KeyID, value,
				c.user.Email); err != nil {
				return err
			}
			changed++
		}
		if err := s.store.InsertSourceFile(ctx, tx, c.project.ID, record, objectKey); err != nil {
			return err
		}
		if branch.IsMain && (added+changed) > 0 {
			if _, err := s.store.BumpChangeSeq(ctx, tx, c.project.ID); err != nil {
				return err
			}
		}
		return s.store.AddAudit(ctx, tx, c.user.Email, "source_file.uploaded", c.project.Slug,
			record.Filename+" on "+branch.Name, &c.project.ID)
	})
	if err != nil {
		return errInternal(err)
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"file_id": fileID, "filename": record.Filename, "content_type": contentType,
		"size": record.Size, "sha256": record.SHA256, "object_key": objectKey,
		"keys_added": added, "keys_changed": changed, "keys_unchanged": unchanged,
	})
	return nil
}
