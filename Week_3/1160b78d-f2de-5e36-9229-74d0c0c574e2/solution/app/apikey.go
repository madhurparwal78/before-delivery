package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

const (
	keyPrefixLength    = 8
	defaultGraceMinute = 60
	maxGraceMinute     = 1440
	seedKeyName        = "Dock board reader"
	seedKeySecret      = "slk_seed_read_4c1d"
)

// keyView is a key as listed: never the secret, only its first characters.
type keyView struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Scope     string  `json:"scope"`
	Prefix    string  `json:"prefix"`
	GraceEnds *string `json:"grace_ends_at"`
	RevokedAt *string `json:"revoked_at"`
}

func (a *App) hListKeys(rq *Req) error {
	rows, err := a.db.Query(rq.Ctx(), `select k.id, k.name, k.scope, k.prefix, k.revoked_at,
		(select max(s.grace_ends_at) from api_key_secrets s where s.key_id = k.id)
		from api_keys k order by k.created_at, k.id`)
	if err != nil {
		return fmt.Errorf("list api keys: %w", err)
	}
	defer rows.Close()
	items := []keyView{}
	for rows.Next() {
		var key keyView
		var revokedAt, graceEnds *time.Time
		if err := rows.Scan(&key.ID, &key.Name, &key.Scope, &key.Prefix, &revokedAt, &graceEnds); err != nil {
			return fmt.Errorf("scan api key: %w", err)
		}
		key.GraceEnds, key.RevokedAt = optionalInstant(graceEnds), optionalInstant(revokedAt)
		items = append(items, key)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("list api keys: %w", err)
	}
	return rq.JSON(http.StatusOK, map[string]any{"items": items})
}

func (a *App) hCreateKey(rq *Req) error {
	var body struct {
		Name  string `json:"name"`
		Scope string `json:"scope"`
	}
	if err := rq.Decode(&body); err != nil {
		return fmt.Errorf("read new api key: %w", err)
	}
	problems := map[string]string{}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		problems["name"] = "Name is required."
	}
	if body.Scope != "read" && body.Scope != "write" {
		problems["scope"] = "Scope must be read or write."
	}
	if len(problems) > 0 {
		return errFields(problems)
	}
	id, secret := newID(), newKeySecret()
	err := a.Do(rq.Ctx(), func(w *Work) error {
		if err := insertKey(w, id, name, body.Scope, secret); err != nil {
			return fmt.Errorf("store new api key: %w", err)
		}
		w.Publish("access", map[string]any{"kind": "keys"})
		return nil
	})
	if err != nil {
		return fmt.Errorf("create api key: %w", err)
	}
	return rq.JSON(http.StatusCreated, map[string]any{"id": id, "name": name, "scope": body.Scope, "key": secret})
}

func newKeySecret() string { return "slk_" + newToken(24) }

// insertKey stores a key with its first secret.
func insertKey(w *Work, id, name, scope, secret string) error {
	_, err := w.Tx.Exec(w.Ctx, `insert into api_keys (id, name, scope, prefix, created_at) values ($1, $2, $3, $4, $5)`,
		id, name, scope, secret[:keyPrefixLength], w.Now)
	if err != nil {
		return fmt.Errorf("insert api key: %w", err)
	}
	if err := addKeySecret(w, id, secret); err != nil {
		return fmt.Errorf("store api key secret: %w", err)
	}
	return nil
}

func addKeySecret(w *Work, keyID, secret string) error {
	_, err := w.Tx.Exec(w.Ctx, `insert into api_key_secrets (hash, key_id, created_at) values ($1, $2, $3)`,
		hashSecret(secret), keyID, w.Now)
	if err != nil {
		return fmt.Errorf("insert api key secret: %w", err)
	}
	return nil
}

// hRotateKey issues a new secret and lets the current one run on until the grace ends: authentication accepts a
// secret while the server clock is before its grace_ends_at.
func (a *App) hRotateKey(rq *Req) error {
	var change map[string]json.RawMessage
	if err := rq.Decode(&change); err != nil {
		return fmt.Errorf("read rotation: %w", err)
	}
	keyID := rq.Param("id")
	var issued map[string]any
	err := a.Do(rq.Ctx(), func(w *Work) error {
		var revoked bool
		err := w.Tx.QueryRow(w.Ctx, `select revoked_at is not null from api_keys where id = $1 for update`, keyID).Scan(&revoked)
		if err != nil {
			return fmt.Errorf("read api key: %w", err)
		}
		if revoked {
			return errConflict("key_revoked")
		}
		grace := defaultGraceMinute
		if raw, ok := change["grace_minutes"]; ok {
			minutes, whole := wholeNumber(raw)
			if !whole || minutes < 0 || minutes > maxGraceMinute {
				return errField("grace_minutes", "Use a whole number of minutes from 0 to 1440.")
			}
			grace = minutes
		}
		graceEnds := w.Now.Add(time.Duration(grace) * time.Minute)
		_, err = w.Tx.Exec(w.Ctx, `update api_key_secrets set grace_ends_at = $2 where key_id = $1 and grace_ends_at is null`,
			keyID, graceEnds)
		if err != nil {
			return fmt.Errorf("end the old secret: %w", err)
		}
		secret := newKeySecret()
		if err := addKeySecret(w, keyID, secret); err != nil {
			return fmt.Errorf("store rotated secret: %w", err)
		}
		w.Publish("access", map[string]any{"kind": "keys"})
		issued = map[string]any{"key": secret, "grace_ends_at": formatInstant(graceEnds)}
		return nil
	})
	if err != nil {
		return fmt.Errorf("rotate api key: %w", err)
	}
	return rq.JSON(http.StatusOK, issued)
}

// hRevokeKey kills every secret of the key at once: authentication refuses a revoked key whatever its secrets say.
func (a *App) hRevokeKey(rq *Req) error {
	err := a.Do(rq.Ctx(), func(w *Work) error {
		_, err := w.Tx.Exec(w.Ctx, `update api_keys set revoked_at = $2 where id = $1 and revoked_at is null`, rq.Param("id"), w.Now)
		if err != nil {
			return fmt.Errorf("revoke api key: %w", err)
		}
		w.Publish("access", map[string]any{"kind": "keys"})
		return nil
	})
	if err != nil {
		return fmt.Errorf("revoke api key: %w", err)
	}
	return rq.NoContent()
}

func seedKeys(_ *App, w *Work) error {
	if err := insertKey(w, newID(), seedKeyName, "read", seedKeySecret); err != nil {
		return fmt.Errorf("seed api key: %w", err)
	}
	return nil
}

func init() {
	seeders = append(seeders, seeder{order: 60, name: "api keys", fn: seedKeys})
	routeSetups = append(routeSetups, func(a *App) {
		a.route(route{Pattern: "GET /api/api-keys", Access: accAdmin, Handler: a.hListKeys})
		a.route(route{Pattern: "POST /api/api-keys", Access: accAdmin, Handler: a.hCreateKey})
		a.route(route{Pattern: "POST /api/api-keys/{id}/rotate", Access: accAdmin, Resource: "apikey", Handler: a.hRotateKey})
		a.route(route{Pattern: "DELETE /api/api-keys/{id}", Access: accAdmin, Resource: "apikey", Handler: a.hRevokeKey})
	})
}
