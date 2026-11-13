package main

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type tmHit struct {
	EntryID string
	Source  string
	Target  string
}

// tmLookup finds the oldest TM entry whose normalised source equals the key source's.
func tmLookup(ctx context.Context, q db, projectID, lang, keySource string) (*tmHit, error) {
	var hit tmHit
	err := q.QueryRow(ctx, `SELECT id, source, target FROM tm_entries
		WHERE project_id = $1 AND target_language = $2 AND norm_source = $3 ORDER BY seq LIMIT 1`,
		projectID, lang, normalise(keySource)).Scan(&hit.EntryID, &hit.Source, &hit.Target)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("look up TM match: %w", err)
	}
	return &hit, nil
}

func (h *tmHit) reusedValue(keySource string) string {
	return mapPlaceholders(h.Source, h.Target, keySource)
}

// fillFromTM fills the untranslated segments of one key on one branch from exact matches.
func fillFromTM(ctx context.Context, q db, p *Project, branchID, keyID, keySource, actor string, at time.Time) error {
	rows, err := q.Query(ctx, segmentSelect+"WHERE s.branch_id = $1 AND s.key_id = $2 AND s.status = 'untranslated'", branchID, keyID)
	if err != nil {
		return fmt.Errorf("list untranslated segments: %w", err)
	}
	var segs []*Segment
	for rows.Next() {
		s, err := scanSegment(rows)
		if err != nil {
			rows.Close()
			return fmt.Errorf("scan segment: %w", err)
		}
		segs = append(segs, s)
	}
	rows.Close()
	for _, s := range segs {
		hit, err := tmLookup(ctx, q, p.ID, s.Language, keySource)
		if err != nil {
			return err
		}
		if hit == nil {
			continue
		}
		s.setValue(hit.reusedValue(keySource), "tm", actor, at)
		if err := s.save(ctx, q); err != nil {
			return err
		}
	}
	return nil
}

// applyTMToMain runs every TM entry of the project over main's untranslated segments.
func applyTMToMain(ctx context.Context, q db, p *Project, main *Branch, actor string, at time.Time) (int, error) {
	rows, err := q.Query(ctx, segmentSelect+"WHERE s.branch_id = $1 AND NOT k.deleted AND s.status = 'untranslated'", main.ID)
	if err != nil {
		return 0, fmt.Errorf("list untranslated main segments: %w", err)
	}
	var segs []*Segment
	for rows.Next() {
		s, err := scanSegment(rows)
		if err != nil {
			rows.Close()
			return 0, fmt.Errorf("scan segment: %w", err)
		}
		segs = append(segs, s)
	}
	rows.Close()
	sort.Slice(segs, func(i, j int) bool { return segs[i].KeyName < segs[j].KeyName })
	entries, err := q.Query(ctx, "SELECT target_language, norm_source, source, target FROM tm_entries WHERE project_id = $1 ORDER BY seq", p.ID)
	if err != nil {
		return 0, fmt.Errorf("list TM entries: %w", err)
	}
	oldest := map[[2]string]tmHit{}
	for entries.Next() {
		var lang, norm string
		var hit tmHit
		if err := entries.Scan(&lang, &norm, &hit.Source, &hit.Target); err != nil {
			entries.Close()
			return 0, fmt.Errorf("scan TM entry: %w", err)
		}
		if _, seen := oldest[[2]string{lang, norm}]; !seen {
			oldest[[2]string{lang, norm}] = hit
		}
	}
	entries.Close()
	applied := 0
	for _, s := range segs {
		hit, ok := oldest[[2]string{s.Language, normalise(s.Source)}]
		if !ok {
			continue
		}
		s.setValue(hit.reusedValue(s.Source), "tm", actor, at)
		if err := s.save(ctx, q); err != nil {
			return 0, err
		}
		applied++
	}
	return applied, nil
}

// importRow is one row of an uploaded TM file.
type importRow struct {
	Line     int
	Source   string
	Target   string
	Language string
}

type rowReport struct {
	Line   int    `json:"line"`
	Reason string `json:"reason"`
}

var errCSVHeader = errField("file", "The spreadsheet needs source, target and target_language columns.")
var errTMXRead = errField("file", "That TMX file can't be read.")

func parseCSVRows(data []byte) ([]importRow, error) {
	data = bytes.TrimPrefix(data, []byte{0xEF, 0xBB, 0xBF})
	r := csv.NewReader(bytes.NewReader(data))
	r.FieldsPerRecord = -1
	r.LazyQuotes = true
	header, err := r.Read()
	if err != nil {
		return nil, errCSVHeader
	}
	col := map[string]int{}
	for i, name := range header {
		col[strings.TrimSpace(name)] = i
	}
	for _, need := range []string{"source", "target", "target_language"} {
		if _, ok := col[need]; !ok {
			return nil, errCSVHeader
		}
	}
	cell := func(rec []string, name string) string {
		if i := col[name]; i < len(rec) {
			return rec[i]
		}
		return ""
	}
	var rows []importRow
	for {
		rec, err := r.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, errField("file", "The spreadsheet couldn't be read as CSV.")
		}
		line, _ := r.FieldPos(0)
		rows = append(rows, importRow{Line: line, Source: cell(rec, "source"), Target: cell(rec, "target"), Language: strings.TrimSpace(cell(rec, "target_language"))})
	}
	return rows, nil
}

func primarySubtag(code string) string {
	code = strings.ToLower(code)
	if i := strings.IndexAny(code, "-_"); i >= 0 {
		return code[:i]
	}
	return code
}

func parseTMXRows(data []byte, sourceLang string) ([]importRow, error) {
	dec := xml.NewDecoder(bytes.NewReader(data))
	var rows []importRow
	line := 1
	consumed := int64(0)
	advanceTo := func(offset int64) {
		line += bytes.Count(data[consumed:offset], []byte{'\n'})
		consumed = offset
	}
	type variant struct{ lang, text string }
	var (
		inTU     bool
		tuLine   int
		variants []variant
		inSeg    bool
		curLang  string
		segText  strings.Builder
		sawTMX   bool
		depthSeg int
		finishTU = func() {
			var source string
			for _, v := range variants {
				if primarySubtag(v.lang) == strings.ToLower(sourceLang) {
					source = v.text
					break
				}
			}
			for _, v := range variants {
				if primarySubtag(v.lang) == strings.ToLower(sourceLang) {
					continue
				}
				rows = append(rows, importRow{Line: tuLine, Source: source, Target: v.text, Language: v.lang})
			}
		}
	)
	for {
		start := dec.InputOffset()
		tok, err := dec.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, errTMXRead
		}
		advanceTo(start)
		switch t := tok.(type) {
		case xml.StartElement:
			switch {
			case t.Name.Local == "tmx":
				sawTMX = true
			case t.Name.Local == "tu" && !inTU:
				inTU, tuLine, variants = true, line, nil
			case t.Name.Local == "tuv" && inTU:
				curLang = ""
				for _, a := range t.Attr {
					if a.Name.Local == "lang" {
						curLang = a.Value
					}
				}
			case t.Name.Local == "seg" && inTU && !inSeg:
				inSeg, depthSeg = true, 0
				segText.Reset()
			case inSeg:
				depthSeg++
			}
		case xml.CharData:
			if inSeg {
				segText.Write(t)
			}
		case xml.EndElement:
			switch {
			case t.Name.Local == "seg" && inSeg && depthSeg == 0:
				inSeg = false
				variants = append(variants, variant{lang: curLang, text: strings.TrimSpace(segText.String())})
			case inSeg:
				depthSeg--
			case t.Name.Local == "tu" && inTU:
				inTU = false
				finishTU()
			}
		}
	}
	if !sawTMX {
		return nil, errTMXRead
	}
	return rows, nil
}

type tmImportResult struct {
	Added      int
	Duplicates int
	Applied    int
	Rows       []rowReport
}

// importRows adds the file's rows to the project's TM with the published row outcomes, in order.
func importRows(ctx context.Context, q db, p *Project, importID string, rows []importRow, main *Branch, at time.Time) (*tmImportResult, error) {
	type pair struct{ lang, source string }
	existing := map[pair]map[string]bool{}
	entries, err := q.Query(ctx, "SELECT target_language, norm_source, norm_target FROM tm_entries WHERE project_id = $1", p.ID)
	if err != nil {
		return nil, fmt.Errorf("list TM entries: %w", err)
	}
	for entries.Next() {
		var lang, ns, nt string
		if err := entries.Scan(&lang, &ns, &nt); err != nil {
			entries.Close()
			return nil, fmt.Errorf("scan TM entry: %w", err)
		}
		k := pair{lang, ns}
		if existing[k] == nil {
			existing[k] = map[string]bool{}
		}
		existing[k][nt] = true
	}
	entries.Close()
	keys, err := liveKeys(ctx, q, main.ID)
	if err != nil {
		return nil, err
	}
	keySources := map[string]bool{}
	for _, k := range keys {
		keySources[normalise(k.Source)] = true
	}
	targets := map[string]bool{}
	for _, t := range p.TargetLanguages {
		targets[t] = true
	}
	res := &tmImportResult{Rows: []rowReport{}}
	for _, row := range rows {
		lang := row.Language
		if !targets[lang] {
			lang = ""
			for _, t := range p.TargetLanguages {
				if primarySubtag(t) == primarySubtag(row.Language) && primarySubtag(row.Language) != "" {
					lang = t
					break
				}
			}
		}
		ns, nt := normalise(row.Source), normalise(row.Target)
		switch {
		case strings.TrimSpace(row.Source) == "":
			res.Rows = append(res.Rows, rowReport{row.Line, "missing_source"})
			continue
		case strings.TrimSpace(row.Target) == "":
			res.Rows = append(res.Rows, rowReport{row.Line, "missing_target"})
			continue
		case lang == "":
			res.Rows = append(res.Rows, rowReport{row.Line, "unknown_language"})
			continue
		}
		k := pair{lang, ns}
		if existing[k][nt] {
			res.Duplicates++
			continue
		}
		if len(existing[k]) > 0 {
			res.Rows = append(res.Rows, rowReport{row.Line, "conflicting_target"})
			continue
		}
		_, err := q.Exec(ctx, `INSERT INTO tm_entries (id, project_id, source, norm_source, target_language, target, norm_target, import_id, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, newID(), p.ID, row.Source, ns, lang, row.Target, nt, importID, at)
		if err != nil {
			return nil, fmt.Errorf("add TM entry: %w", err)
		}
		existing[k] = map[string]bool{nt: true}
		res.Added++
		if !keySources[ns] {
			res.Rows = append(res.Rows, rowReport{row.Line, "no_matching_key"})
		}
	}
	sort.SliceStable(res.Rows, func(i, j int) bool { return res.Rows[i].Line < res.Rows[j].Line })
	return res, nil
}

func (a *App) handleTMImport(w http.ResponseWriter, r *http.Request) error {
	pr, p, err := a.ownerProject(r)
	if err != nil {
		return err
	}
	up, err := readUpload(r)
	if err != nil {
		return err
	}
	format := up.Fields["format"]
	if format != "tmx" && format != "csv" {
		return errField("format", "Choose TMX or CSV.")
	}
	var rows []importRow
	if format == "csv" {
		rows, err = parseCSVRows(up.Data)
	} else {
		rows, err = parseTMXRows(up.Data, p.SourceLanguage)
	}
	if err != nil {
		return err
	}
	importID := newID()
	objectKey := fmt.Sprintf("projects/%s/imports/%s", p.ID, importID)
	filename := cleanFilename(up.Filename)
	ctx := r.Context()
	var res *tmImportResult
	var stored uploads
	err = a.inProject(ctx, p.ID, func(tx pgx.Tx) error {
		main, err := mainBranch(ctx, tx, p.ID)
		if err != nil {
			return err
		}
		at := now()
		opID := newID()
		snapKey := fmt.Sprintf("projects/%s/snapshots/%s.json", p.ID, opID)
		if err := a.snapshotMain(ctx, tx, &stored, p, main, snapKey); err != nil {
			return err
		}
		if err := stored.put(ctx, a, objectKey, up.Data, up.ContentType); err != nil {
			return err
		}
		if res, err = importRows(ctx, tx, p, importID, rows, main, at); err != nil {
			return err
		}
		if res.Applied, err = applyTMToMain(ctx, tx, p, main, pr.Email, at); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO imports (id, project_id, filename, format, size, sha256, object_key, at, added, duplicates, applied, rows)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`, importID, p.ID, filename, format, len(up.Data),
			sha256Hex(up.Data), objectKey, at, res.Added, res.Duplicates, res.Applied, res.Rows)
		if err != nil {
			return fmt.Errorf("record import: %w", err)
		}
		rev, err := bumpMainRev(ctx, tx, p.ID)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO operations (id, project_id, kind, label, at, rev_after, snapshot_key, import_id)
			VALUES ($1, $2, 'import', $3, $4, $5, $6, $7)`, opID, p.ID, "Import "+filename, at, rev, snapKey, importID)
		if err != nil {
			return fmt.Errorf("record operation: %w", err)
		}
		return a.audit(ctx, tx, pr.Email, "tm.imported", p, fmt.Sprintf("%s: %d added, %d duplicates, %d applied", filename, res.Added, res.Duplicates, res.Applied))
	})
	if err != nil {
		stored.discard(ctx, a)
		return err
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"import_id": importID, "filename": filename, "format": format, "size": len(up.Data), "sha256": sha256Hex(up.Data),
		"object_key": objectKey, "added": res.Added, "duplicates": res.Duplicates, "applied": res.Applied, "rows": res.Rows,
	})
	return nil
}

func (a *App) handleTMImports(w http.ResponseWriter, r *http.Request) error {
	_, p, err := a.ownerProject(r)
	if err != nil {
		return err
	}
	rows, err := a.pool.Query(r.Context(), `SELECT i.id, o.id, i.filename, i.format, i.size, i.sha256, i.at, o.restored_at, i.added, i.duplicates, i.applied, i.rows
		FROM imports i LEFT JOIN operations o ON o.import_id = i.id WHERE i.project_id = $1 ORDER BY i.seq DESC`, p.ID)
	if err != nil {
		return fmt.Errorf("list imports: %w", err)
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, filename, format, sha string
		var opID *string
		var size int64
		var at time.Time
		var restored *time.Time
		var added, dups, applied int
		var report []rowReport
		if err := rows.Scan(&id, &opID, &filename, &format, &size, &sha, &at, &restored, &added, &dups, &applied, &report); err != nil {
			return fmt.Errorf("scan import: %w", err)
		}
		out = append(out, map[string]any{"import_id": id, "operation_id": opID, "filename": filename, "format": format, "size": size, "sha256": sha,
			"at": fmtTime(at), "restored_at": fmtTimePtr(restored), "added": added, "duplicates": dups, "applied": applied, "rows": report})
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read rows: %w", err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"imports": out})
	return nil
}

func (a *App) handleTMOriginal(w http.ResponseWriter, r *http.Request) error {
	_, p, err := a.ownerProject(r)
	if err != nil {
		return err
	}
	var objectKey, filename string
	err = a.pool.QueryRow(r.Context(), "SELECT object_key, filename FROM imports WHERE id = $1 AND project_id = $2", r.PathValue("import_id"), p.ID).Scan(&objectKey, &filename)
	if errors.Is(err, pgx.ErrNoRows) {
		return errNotFound()
	}
	if err != nil {
		return fmt.Errorf("load import: %w", err)
	}
	return a.serveObject(w, r, objectKey, "", filename)
}

func (a *App) handleTMList(w http.ResponseWriter, r *http.Request) error {
	_, p, err := a.ownerProject(r)
	if err != nil {
		return err
	}
	sql := "SELECT id, source, target, target_language, import_id FROM tm_entries WHERE project_id = $1"
	args := []any{p.ID}
	if lang := r.URL.Query().Get("lang"); lang != "" {
		args = append(args, lang)
		sql += fmt.Sprintf(" AND target_language = $%d", len(args))
	}
	if q := r.URL.Query().Get("q"); strings.TrimSpace(q) != "" {
		args = append(args, "%"+escapeLike(normalise(q))+"%")
		sql += fmt.Sprintf(" AND norm_source LIKE $%d", len(args))
	}
	rows, err := a.pool.Query(r.Context(), sql+" ORDER BY seq", args...)
	if err != nil {
		return fmt.Errorf("list TM: %w", err)
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, source, target, lang string
		var importID *string
		if err := rows.Scan(&id, &source, &target, &lang, &importID); err != nil {
			return fmt.Errorf("scan TM entry: %w", err)
		}
		out = append(out, map[string]any{"id": id, "source": source, "target": target, "target_language": lang, "import_id": importID})
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read rows: %w", err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": out, "total": len(out)})
	return nil
}

func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}

func (a *App) handleTMMatch(w http.ResponseWriter, r *http.Request) error {
	_, p, err := a.ownerProject(r)
	if err != nil {
		return err
	}
	var in struct {
		Source   string `json:"source"`
		Language string `json:"language"`
	}
	if err := decodeJSON(r, &in); err != nil {
		return err
	}
	if strings.TrimSpace(in.Source) == "" {
		return errField("source", "Enter the source text to look up.")
	}
	hit, err := tmLookup(r.Context(), a.pool, p.ID, in.Language, in.Source)
	if err != nil {
		return err
	}
	if hit == nil {
		writeJSON(w, http.StatusOK, map[string]any{"match": nil})
		return nil
	}
	writeJSON(w, http.StatusOK, map[string]any{"match": map[string]any{
		"entry_id": hit.EntryID, "source": hit.Source, "target": hit.Target, "reused_value": hit.reusedValue(in.Source)}})
	return nil
}
