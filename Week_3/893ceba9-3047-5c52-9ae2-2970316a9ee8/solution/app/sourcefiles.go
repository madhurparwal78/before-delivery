package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

var errSourceShape = errField("file", "The file must be a JSON object whose values are all strings.")

// flattenLocale reads a JSON object whose leaves are strings into dotted key names.
// Arrays, numbers, booleans, nulls and duplicate member names are rejected.
func flattenLocale(data []byte) (map[string]string, error) {
	data = bytes.TrimPrefix(data, []byte{0xEF, 0xBB, 0xBF})
	dec := json.NewDecoder(bytes.NewReader(data))
	out := map[string]string{}
	if tok, err := dec.Token(); err != nil || tok != json.Delim('{') {
		return nil, errSourceShape
	}
	if err := readObject(dec, "", out); err != nil {
		return nil, err
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return nil, errSourceShape
	}
	return out, nil
}

func readObject(dec *json.Decoder, prefix string, out map[string]string) error {
	seen := map[string]bool{}
	for dec.More() {
		tok, err := dec.Token()
		if err != nil {
			return errSourceShape
		}
		name, ok := tok.(string)
		if !ok || seen[name] {
			return errSourceShape
		}
		seen[name] = true
		full := prefix + name
		val, err := dec.Token()
		if err != nil {
			return errSourceShape
		}
		switch v := val.(type) {
		case string:
			if _, dup := out[full]; dup {
				return errSourceShape
			}
			out[full] = v
		case json.Delim:
			if v != '{' {
				return errSourceShape
			}
			if err := readObject(dec, full+".", out); err != nil {
				return err
			}
		default:
			return errSourceShape
		}
	}
	if _, err := dec.Token(); err != nil {
		return errSourceShape
	}
	return nil
}

func (a *App) handleSourceUpload(w http.ResponseWriter, r *http.Request) error {
	pr, p, b, err := a.ownerBranch(r)
	if err != nil {
		return err
	}
	up, err := readUpload(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	fileID := newID()
	objectKey := fmt.Sprintf("projects/%s/source-files/%s", p.ID, fileID)
	contentType := up.ContentType
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	filename := cleanFilename(up.Filename)
	var added, changed, unchanged int
	var stored uploads
	err = a.inProject(ctx, p.ID, func(tx pgx.Tx) error {
		if b, err = branchByID(ctx, tx, b.ID); err != nil {
			return err
		}
		if err := b.requireEditable(); err != nil {
			return err
		}
		flat, err := flattenLocale(up.Data)
		if err != nil {
			return err
		}
		names := make([]string, 0, len(flat))
		for name, value := range flat {
			if !keyNamePattern.MatchString(name) {
				return errField("file", "Key names may use letters, digits, dots, underscores and hyphens.")
			}
			flat[name] = strings.TrimSpace(value)
			if e := validSource(flat[name]); e != nil {
				return errField("file", "Every value needs 1 to 2,000 characters of text.")
			}
			names = append(names, name)
		}
		sort.Strings(names)
		if err := stored.put(ctx, a, objectKey, up.Data, contentType); err != nil {
			return err
		}
		keys, err := liveKeys(ctx, tx, b.ID)
		if err != nil {
			return err
		}
		byName := map[string]Key{}
		for _, k := range keys {
			byName[k.Name] = k
		}
		at := now()
		for _, name := range names {
			value := flat[name]
			existing, found := byName[name]
			switch {
			case !found:
				if _, err := a.createKey(ctx, tx, p, b, name, value, pr.Email, at); err != nil {
					return err
				}
				added++
			case existing.Source != value:
				if _, err := tx.Exec(ctx, "UPDATE branch_keys SET source = $3 WHERE branch_id = $1 AND key_id = $2", b.ID, existing.ID, value); err != nil {
					return fmt.Errorf("update key source: %w", err)
				}
				if err := addRevision(ctx, tx, p.ID, existing.ID, b.Name, "source", &existing.Source, &value, pr.Email); err != nil {
					return err
				}
				if err := a.changeSource(ctx, tx, p, b, existing.ID, value, pr.Email, at); err != nil {
					return err
				}
				changed++
			default:
				unchanged++
			}
		}
		_, err = tx.Exec(ctx, `INSERT INTO source_files (id, project_id, branch, filename, content_type, size, sha256, object_key, at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, fileID, p.ID, b.Name, filename, contentType, len(up.Data), sha256Hex(up.Data), objectKey, at)
		if err != nil {
			return fmt.Errorf("record source file: %w", err)
		}
		if added+changed > 0 {
			if err := touch(ctx, tx, p.ID, b); err != nil {
				return err
			}
		}
		return a.audit(ctx, tx, pr.Email, "source.uploaded", p, fmt.Sprintf("%s to %s: %d added, %d changed", filename, b.Name, added, changed))
	})
	if err != nil {
		stored.discard(ctx, a)
		return err
	}
	writeJSON(w, http.StatusCreated, map[string]any{"file_id": fileID, "filename": filename, "content_type": contentType,
		"size": len(up.Data), "sha256": sha256Hex(up.Data), "object_key": objectKey,
		"keys_added": added, "keys_changed": changed, "keys_unchanged": unchanged})
	return nil
}

// createKey adds a new key to a branch with untranslated segments, TM fills and its created revision.
func (a *App) createKey(ctx context.Context, tx pgx.Tx, p *Project, b *Branch, name, source, actor string, at time.Time) (string, error) {
	keyID := newID()
	if _, err := tx.Exec(ctx, "INSERT INTO keys (id, project_id) VALUES ($1, $2)", keyID, p.ID); err != nil {
		return "", fmt.Errorf("insert key: %w", err)
	}
	if _, err := tx.Exec(ctx, "INSERT INTO branch_keys (branch_id, key_id, name, source) VALUES ($1, $2, $3, $4)", b.ID, keyID, name, source); err != nil {
		return "", fmt.Errorf("insert branch key: %w", err)
	}
	if err := newSegments(ctx, tx, p, b.ID, keyID); err != nil {
		return "", err
	}
	if err := addRevision(ctx, tx, p.ID, keyID, b.Name, "created", nil, &name, actor); err != nil {
		return "", err
	}
	return keyID, fillFromTM(ctx, tx, p, b.ID, keyID, source, actor, at)
}

func (a *App) handleSourceFiles(w http.ResponseWriter, r *http.Request) error {
	_, p, err := a.ownerProject(r)
	if err != nil {
		return err
	}
	rows, err := a.pool.Query(r.Context(), "SELECT id, branch, filename, content_type, size, sha256, at FROM source_files WHERE project_id = $1 ORDER BY seq DESC", p.ID)
	if err != nil {
		return fmt.Errorf("list source files: %w", err)
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, branch, filename, ctype, sha string
		var size int64
		var at time.Time
		if err := rows.Scan(&id, &branch, &filename, &ctype, &size, &sha, &at); err != nil {
			return fmt.Errorf("scan source file: %w", err)
		}
		out = append(out, map[string]any{"file_id": id, "branch": branch, "filename": filename, "content_type": ctype, "size": size,
			"sha256": sha, "at": fmtTime(at)})
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read rows: %w", err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"files": out})
	return nil
}

func (a *App) handleSourceOriginal(w http.ResponseWriter, r *http.Request) error {
	_, p, err := a.ownerProject(r)
	if err != nil {
		return err
	}
	var objectKey, filename, ctype string
	err = a.pool.QueryRow(r.Context(), "SELECT object_key, filename, content_type FROM source_files WHERE id = $1 AND project_id = $2",
		r.PathValue("file_id"), p.ID).Scan(&objectKey, &filename, &ctype)
	if errors.Is(err, pgx.ErrNoRows) {
		return errNotFound()
	}
	if err != nil {
		return fmt.Errorf("load source file: %w", err)
	}
	return a.serveObject(w, r, objectKey, ctype, filename)
}

// serveObject sends a stored object back byte for byte as a download.
func (a *App) serveObject(w http.ResponseWriter, r *http.Request, key, contentType, filename string) error {
	data, stored, err := a.s3.Get(r.Context(), key)
	if err != nil {
		if errors.Is(err, errObjectMissing) {
			return errNotFound()
		}
		return err
	}
	if contentType == "" {
		contentType = firstNonEmpty(stored, "application/octet-stream")
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", `attachment; filename="`+strings.NewReplacer(`"`, "'", `\`, "_", "\r", "", "\n", "").Replace(filename)+`"`)
	writeBody(w, data)
	return nil
}
