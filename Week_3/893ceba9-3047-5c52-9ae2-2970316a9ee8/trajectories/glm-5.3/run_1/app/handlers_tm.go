package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"strings"
	"time"
)

// tmRow is one row of an import file.
type tmRow struct {
	Line   int
	Source string
	Target string
	Lang   string
}

// tmImportReport is stored with the import so the report endpoint can replay it.
type tmImportReport struct {
	ProjectID  string         `json:"-"`
	ImportID   string         `json:"import_id"`
	Filename   string         `json:"filename"`
	Format     string         `json:"format"`
	Size       int64          `json:"size"`
	Sha256     string         `json:"sha256"`
	ObjectKey  string         `json:"object_key"`
	Added      int            `json:"added"`
	Duplicates int            `json:"duplicates"`
	Applied    int            `json:"applied"`
	Rows       []reportRowOut `json:"rows"`
}

type reportRowOut struct {
	Line   int    `json:"line"`
	Reason string `json:"reason"`
}

func (s *Server) handleTmImport(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	slug := r.PathValue("slug")
	p, err := s.projectInScope(w, r, slug)
	if err != nil {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, MaxMultipart+1)
	if err := r.ParseMultipartForm(MaxMultipart); err != nil {
		payloadTooLarge(w)
		return
	}
	format := strings.ToLower(strings.TrimSpace(r.FormValue("format")))
	if format != "tmx" && format != "csv" {
		validationFailed(w, map[string]string{"format": "Choose TMX or CSV."})
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		validationFailed(w, map[string]string{"file": "Choose a file to import."})
		return
	}
	defer func() { _ = file.Close() }()
	data, err := io.ReadAll(io.LimitReader(file, MaxFileBody+1))
	if err != nil {
		payloadTooLarge(w)
		return
	}
	if int64(len(data)) > MaxFileBody {
		payloadTooLarge(w)
		return
	}

	var rows []tmRow
	if format == "csv" {
		rows, err = parseTmCsv(data, p)
		if err != nil {
			if errors.Is(err, errBadCsvHeader) {
				writeErrorFields(w, http.StatusUnprocessableEntity, "validation_failed",
					"The spreadsheet needs source, target and target_language columns.",
					map[string]string{"file": "The spreadsheet needs source, target and target_language columns."})
			} else {
				writeErrorFields(w, http.StatusUnprocessableEntity, "validation_failed",
					"That file couldn't be read.", map[string]string{"file": "That file couldn't be read."})
			}
			return
		}
	} else {
		rows, err = parseTmTmx(data, p)
		if err != nil {
			writeErrorFields(w, http.StatusUnprocessableEntity, "validation_failed",
				"That TMX file can't be read.", map[string]string{"file": "That TMX file can't be read."})
			return
		}
	}

	sum := sha256.Sum256(data)
	shaHex := hex.EncodeToString(sum[:])
	importID := newUUID()
	objectKey := "projects/" + p.ID + "/imports/" + importID

	// storage first: when MinIO is down nothing changes
	if err := s.storage.Put(r.Context(), objectKey, data, contentTypeOf(header)); err != nil {
		serviceUnavailable(w, "storage_unavailable", "File storage isn't answering. Nothing was saved; try again in a few minutes.", nil)
		return
	}

	report, apiErr := s.runTmImport(r.Context(), p, importID, header.Filename, format, int64(len(data)), shaHex, objectKey, rows, u.Email)
	if apiErr != nil {
		writeError(w, apiErr.status, apiErr.code, apiErr.message)
		return
	}
	writeJSON(w, http.StatusCreated, report)
}

func contentTypeOf(fh *multipart.FileHeader) string {
	ct := fh.Header.Get("Content-Type")
	if ct == "" || ct == "application/octet-stream" {
		if idx := strings.LastIndex(fh.Filename, "."); idx >= 0 {
			switch strings.ToLower(fh.Filename[idx+1:]) {
			case "csv":
				return "text/csv"
			case "tmx", "xml":
				return "application/xml"
			}
		}
	}
	return ct
}

type handledAPIError struct {
	status  int
	code    string
	message string
}

func (e *handledAPIError) Error() string { return e.code }

var errBadCsvHeader = errors.New("bad csv header")

// parseTmCsv reads a UTF-8 CSV with an optional BOM. Line numbers count from 1
// at the header, so the first data row is line 2; a quoted field with line
// breaks takes the line where its record starts.
func parseTmCsv(data []byte, p *Project) ([]tmRow, error) {
	text := string(bytes.TrimPrefix(data, []byte{0xEF, 0xBB, 0xBF}))
	reader := csv.NewReader(strings.NewReader(text))
	reader.FieldsPerRecord = -1
	records, err := reader.ReadAll()
	if err != nil {
		return nil, err
	}
	if len(records) == 0 {
		return nil, errBadCsvHeader
	}
	header := records[0]
	col := map[string]int{}
	for i, h := range header {
		col[strings.TrimSpace(strings.ToLower(h))] = i
	}
	if _, ok := col["source"]; !ok {
		return nil, errBadCsvHeader
	}
	if _, ok := col["target"]; !ok {
		return nil, errBadCsvHeader
	}
	if _, ok := col["target_language"]; !ok {
		return nil, errBadCsvHeader
	}
	startLines := csvRecordStartLines(text)
	var rows []tmRow
	for i := 1; i < len(records); i++ {
		rec := records[i]
		get := func(name string) string {
			idx, ok := col[name]
			if !ok || idx >= len(rec) {
				return ""
			}
			return rec[idx]
		}
		line := i + 1
		if i < len(startLines) {
			line = startLines[i]
		}
		rows = append(rows, tmRow{
			Line:   line,
			Source: strings.TrimSpace(get("source")),
			Target: strings.TrimSpace(get("target")),
			Lang:   strings.TrimSpace(get("target_language")),
		})
	}
	return rows, nil
}

// csvRecordStartLines records the 1-based line at which each record starts.
func csvRecordStartLines(text string) []int {
	var lines []int
	line := 1
	inQuotes := false
	atRecordStart := true
	for i := 0; i < len(text); i++ {
		c := text[i]
		if atRecordStart {
			lines = append(lines, line)
			atRecordStart = false
		}
		switch {
		case c == '"':
			if inQuotes && i+1 < len(text) && text[i+1] == '"' {
				i++
			} else {
				inQuotes = !inQuotes
			}
		case c == '\n':
			line++
			if !inQuotes {
				atRecordStart = true
			}
		}
	}
	return lines
}

type tmxTuv struct {
	Lang string
	Text string
}

// parseTmTmx reads every tu, finding the source tuv by primary language subtag
// and one row per other tuv, at the line of the tu opening tag.
func parseTmTmx(data []byte, p *Project) ([]tmRow, error) {
	var rows []tmRow
	decoder := xml.NewDecoder(bytes.NewReader(data))
	type openTu struct {
		line int
		tuvs []tmxTuv
	}
	var cur *openTu
	var pendingLang string
	for {
		tok, err := decoder.Token()
		if err != nil {
			break
		}
		switch el := tok.(type) {
		case xml.StartElement:
			switch el.Name.Local {
			case "tu":
				cur = &openTu{line: 1 + strings.Count(string(data[:decoder.InputOffset()]), "\n")}
			case "tuv":
				if cur != nil {
					pendingLang = ""
					for _, a := range el.Attr {
						// xml:lang carries the full XML namespace URI in Go's decoder
						if a.Name.Local == "lang" {
							pendingLang = strings.TrimSpace(a.Value)
						}
					}
					cur.tuvs = append(cur.tuvs, tmxTuv{Lang: pendingLang})
				}
			}
		case xml.CharData:
			if cur != nil && len(cur.tuvs) > 0 {
				cur.tuvs[len(cur.tuvs)-1].Text += string(el)
			}
		case xml.EndElement:
			switch el.Name.Local {
			case "tu":
				if cur != nil {
					var sourceText string
					var others []tmxTuv
					for _, v := range cur.tuvs {
						primary := strings.SplitN(v.Lang, "-", 2)[0]
						if primary == p.SourceLanguage {
							sourceText = strings.TrimSpace(v.Text)
						} else {
							others = append(others, v)
						}
					}
					for _, o := range others {
						rows = append(rows, tmRow{
							Line:   cur.line,
							Source: sourceText,
							Target: strings.TrimSpace(o.Text),
							Lang:   strings.TrimSpace(o.Lang),
						})
					}
				}
				cur = nil
			case "tuv":
				pendingLang = ""
			}
		}
	}
	return rows, nil
}

// resolveTargetLanguage matches a target code exactly first, then by primary
// subtag (de-DE imports as de, and pt imports as pt-BR when the project targets it).
func resolveTargetLanguage(code string, p *Project) string {
	for _, l := range p.TargetLanguages {
		if l == code {
			return l
		}
	}
	codePrimary := primarySubtag(code)
	for _, l := range p.TargetLanguages {
		if primarySubtag(l) == codePrimary {
			return l
		}
	}
	return code
}

func primarySubtag(code string) string {
	return strings.SplitN(code, "-", 2)[0]
}

func containsLanguage(langs []string, l string) bool {
	for _, x := range langs {
		if x == l {
			return true
		}
	}
	return false
}

// runTmImport snapshots the TM and main, adds the rows, applies exact matches
// over the whole TM, stores the report and writes the audit entry.
func (s *Server) runTmImport(ctx context.Context, p *Project, importID, filename, format string, size int64, shaHex, objectKey string, rows []tmRow, actor string) (*tmImportReport, *handledAPIError) {
	var report tmImportReport
	var reportRows []reportRowOut
	added, duplicates := 0, 0

	err := s.store.withTx(ctx, func(tx *sql.Tx) error {
		now := time.Now().UTC()

		opID := newUUID()
		snap, err := s.snapshotState(ctx, tx, p)
		if err != nil {
			return fmt.Errorf("snapshot: %w", err)
		}
		snapJSON, _ := json.Marshal(snap)
		snapKey := "projects/" + p.ID + "/snapshots/" + opID + ".json"
		if err := s.storage.Put(ctx, snapKey, snapJSON, "application/json"); err != nil {
			return errStorageDown
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO operations (id, project_id, kind, label, at, snapshot_key, restored_at, main_version, tm_version)
			VALUES ($1,$2,'import',$3,$4,$5,NULL,$6,$7)`,
			opID, p.ID, "Import "+filename, now, snapKey, snap.MainVersion, snap.TmVersion); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO tm_imports (import_id, project_id, filename, format, size, sha256, object_key, at, restored_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL)`,
			importID, p.ID, filename, format, size, shaHex, objectKey, now); err != nil {
			return err
		}

		// existing entries keyed by language and normalised source
		existing := map[string]string{}
		exRows, err := tx.QueryContext(ctx, `SELECT target_language, source_norm, target_norm FROM tm_entries WHERE project_id = $1`, p.ID)
		if err != nil {
			return err
		}
		for exRows.Next() {
			var lang, sn, tn string
			if err := exRows.Scan(&lang, &sn, &tn); err != nil {
				exRows.Close()
				return err
			}
			existing[lang+"\x00"+sn] = tn
		}
		exRows.Close()

		var outs []reportRowOut
		for _, row := range rows {
			switch {
			case row.Source == "":
				outs = append(outs, reportRowOut{row.Line, "missing_source"})
			case row.Target == "":
				outs = append(outs, reportRowOut{row.Line, "missing_target"})
			default:
				lang := resolveTargetLanguage(row.Lang, p)
				if !containsLanguage(p.TargetLanguages, lang) {
					outs = append(outs, reportRowOut{row.Line, "unknown_language"})
					continue
				}
				key := lang + "\x00" + Normalise(row.Source)
				normTarget := Normalise(row.Target)
				if prev, seen := existing[key]; !seen {
					if _, err := tx.ExecContext(ctx, `INSERT INTO tm_entries (id, project_id, source, source_norm, target, target_norm, target_language, import_id, created_at)
						VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
						newUUID(), p.ID, row.Source, Normalise(row.Source), row.Target, normTarget, lang, importID, now); err != nil {
						return err
					}
					existing[key] = normTarget
					added++
				} else if prev == normTarget {
					duplicates++
					outs = append(outs, reportRowOut{row.Line, "duplicate"})
				} else {
					outs = append(outs, reportRowOut{row.Line, "conflicting_target"})
				}
			}
		}

		// live main sources for no_matching_key
		liveRows, err := tx.QueryContext(ctx, `SELECT k.source FROM keys k JOIN branches b ON b.id = k.branch_id WHERE b.project_id = $1 AND b.is_main AND NOT k.deleted`, p.ID)
		if err != nil {
			return err
		}
		mainSources := map[string]bool{}
		for liveRows.Next() {
			var src string
			if err := liveRows.Scan(&src); err != nil {
				liveRows.Close()
				return err
			}
			mainSources[Normalise(src)] = true
		}
		liveRows.Close()

		reported := map[int]bool{}
		for _, o := range outs {
			reported[o.Line] = true
		}
		for _, row := range rows {
			if reported[row.Line] {
				continue
			}
			if !mainSources[Normalise(row.Source)] {
				reportRows = append(reportRows, reportRowOut{row.Line, "no_matching_key"})
			}
		}
		reportRows = append(reportRows, outs...)
		sortRowsByLine(reportRows)
		report = tmImportReport{
			ProjectID: p.ID,
			ImportID:  importID, Filename: filename, Format: format, Size: size,
			Sha256: shaHex, ObjectKey: objectKey, Added: added, Duplicates: duplicates,
			Rows: reportRows,
		}
		return storeImportReport(ctx, tx, report)
	})
	if err != nil {
		if errors.Is(err, errStorageDown) {
			return nil, &handledAPIError{http.StatusServiceUnavailable, "storage_unavailable", "File storage isn't answering. Nothing was saved; try again in a few minutes."}
		}
		log.Printf("tm import failed: %v", err)
		return nil, &handledAPIError{500, "internal", "Something went wrong."}
	}

	applied, err := s.applyTmToMain(ctx, p)
	if err != nil {
		log.Printf("tm apply failed: %v", err)
		return nil, &handledAPIError{500, "internal", "Something went wrong."}
	}
	report.Applied = applied
	_ = storeImportReportUpdate(ctx, s.db, report)

	_ = s.store.AuditInsert(ctx, actor, "tm.imported", p.Slug, filename)
	return &report, nil
}

var errStorageDown = errors.New("storage down")

func storeImportReport(ctx context.Context, tx *sql.Tx, report tmImportReport) error {
	b, _ := json.Marshal(report)
	_, err := tx.ExecContext(ctx, `INSERT INTO import_reports (import_id, project_id, report) VALUES ($1,$2,$3) ON CONFLICT (import_id) DO NOTHING`,
		report.ImportID, report.ProjectID, string(b))
	return err
}

func storeImportReportUpdate(ctx context.Context, db *sql.DB, report tmImportReport) error {
	b, _ := json.Marshal(report)
	_, err := db.ExecContext(ctx, `UPDATE import_reports SET report = $1 WHERE import_id = $2`, string(b), report.ImportID)
	return err
}

func sortRowsByLine(rows []reportRowOut) {
	for i := 1; i < len(rows); i++ {
		for j := i; j > 0 && rows[j].Line < rows[j-1].Line; j-- {
			rows[j], rows[j-1] = rows[j-1], rows[j]
		}
	}
}

// applyTmToMain fills every untranslated main segment from exact matches over
// the project's whole TM, including earlier imports and the seeded entries.
func (s *Server) applyTmToMain(ctx context.Context, p *Project) (int, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT seg.id, seg.key_id, seg.language, k.source FROM segments seg
		JOIN keys k ON k.id = seg.key_id AND k.branch_id = seg.branch_id
		JOIN branches b ON b.id = k.branch_id
		WHERE b.project_id = $1 AND b.is_main AND NOT k.deleted AND seg.status = 'untranslated'`, p.ID)
	if err != nil {
		return 0, err
	}
	type cand struct{ segID, keyID, lang, source string }
	var cands []cand
	for rows.Next() {
		var c cand
		if err := rows.Scan(&c.segID, &c.keyID, &c.lang, &c.source); err != nil {
			rows.Close()
			return 0, err
		}
		cands = append(cands, c)
	}
	rows.Close()
	applied := 0
	for _, c := range cands {
		entry, err := s.tmExactMatch(ctx, p.ID, c.lang, c.source)
		if err != nil {
			return applied, err
		}
		if entry == nil {
			continue
		}
		value := MapPlaceholders(entry.Source, entry.Target, c.source)
		if _, err := s.db.ExecContext(ctx, `UPDATE segments SET value = $1, status = 'drafted', origin = 'tm', updated_at = now() WHERE id = $2 AND status = 'untranslated'`, value, c.segID); err != nil {
			return applied, err
		}
		if _, err := s.db.ExecContext(ctx, `INSERT INTO segment_history (segment_id, at, actor, from_status, to_status, value) VALUES ($1, now(), 'system', 'untranslated', 'drafted', $2)`, c.segID, value); err != nil {
			return applied, err
		}
		applied++
	}
	return applied, nil
}

func (s *Server) handleTmList(w http.ResponseWriter, r *http.Request) {
	p, err := s.projectInScope(w, r, r.PathValue("slug"))
	if err != nil {
		return
	}
	lang := r.URL.Query().Get("lang")
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	args := []any{p.ID}
	where := "project_id = $1"
	if lang != "" {
		args = append(args, lang)
		where += fmt.Sprintf(" AND target_language = $%d", len(args))
	}
	if q != "" {
		args = append(args, Normalise(q))
		where += fmt.Sprintf(" AND source_norm LIKE '%%' || $%d || '%%'", len(args))
	}
	rows, err := s.db.QueryContext(r.Context(), `SELECT id, source, target, target_language, import_id FROM tm_entries WHERE `+where+` ORDER BY created_at, id LIMIT 500`, args...)
	if err != nil {
		http.Error(w, "internal", 500)
		return
	}
	defer func() { _ = rows.Close() }()
	entries := []map[string]any{}
	for rows.Next() {
		var id, source, target, lang string
		var importID any
		if err := rows.Scan(&id, &source, &target, &lang, &importID); err != nil {
			http.Error(w, "internal", 500)
			return
		}
		entries = append(entries, map[string]any{"id": id, "source": source, "target": target, "target_language": lang, "import_id": importID})
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": entries, "total": len(entries)})
}

func (s *Server) handleTmImportsList(w http.ResponseWriter, r *http.Request) {
	p, err := s.projectInScope(w, r, r.PathValue("slug"))
	if err != nil {
		return
	}
	rows, err := s.db.QueryContext(r.Context(), `SELECT import_id, filename, format, size, sha256, at, restored_at FROM tm_imports WHERE project_id = $1 ORDER BY at DESC`, p.ID)
	if err != nil {
		http.Error(w, "internal", 500)
		return
	}
	defer func() { _ = rows.Close() }()
	imports := []map[string]any{}
	for rows.Next() {
		var id, filename, format, sha string
		var at time.Time
		var size int
		var restored any
		if err := rows.Scan(&id, &filename, &format, &size, &sha, &at, &restored); err != nil {
			http.Error(w, "internal", 500)
			return
		}
		imports = append(imports, map[string]any{
			"import_id": id, "filename": filename, "format": format, "size": size,
			"sha256": sha, "at": at.UTC().Format(time.RFC3339), "restored_at": restored,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"imports": imports})
}

func (s *Server) handleTmOriginal(w http.ResponseWriter, r *http.Request) {
	p, err := s.projectInScope(w, r, r.PathValue("slug"))
	if err != nil {
		return
	}
	importID := r.PathValue("import_id")
	var objectKey, filename string
	if err := s.db.QueryRowContext(r.Context(), `SELECT object_key, filename FROM tm_imports WHERE import_id = $1 AND project_id = $2`, importID, p.ID).Scan(&objectKey, &filename); err != nil {
		notFoundError(w)
		return
	}
	data, err := s.storage.Get(r.Context(), objectKey)
	if err != nil {
		notFoundError(w)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func (s *Server) handleTmImportReport(w http.ResponseWriter, r *http.Request) {
	p, err := s.projectInScope(w, r, r.PathValue("slug"))
	if err != nil {
		return
	}
	importID := r.PathValue("import_id")
	var raw string
	if err := s.db.QueryRowContext(r.Context(), `SELECT report FROM import_reports WHERE import_id = $1 AND project_id = $2`, importID, p.ID).Scan(&raw); err != nil {
		notFoundError(w)
		return
	}
	var report map[string]any
	if err := json.Unmarshal([]byte(raw), &report); err != nil {
		http.Error(w, "internal", 500)
		return
	}
	writeJSON(w, http.StatusOK, report)
}
