package main

import (
	"context"
	"crypto/pbkdf2"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
)

const (
	sessionCookie  = "switchlamp_session"
	passwordRounds = 100_000
)

// Actor is who makes a request: a signed-in person, or an API key (KeyScope set, ID empty).
type Actor struct {
	ID       string
	Name     string // a person's name, or the API key's name
	Email    string
	Role     string
	Zone     string
	KeyScope string
}

// IsKey reports an API-key request.
func (a *Actor) IsKey() bool { return a.KeyScope != "" }

var roleRank = map[string]int{"stakeholder": 1, "responder": 2, "lead": 3, "admin": 4}

func (acc access) rank() int {
	switch acc {
	case accAny:
		return 1
	case accStaff:
		return 2
	case accLead:
		return 3
	case accAdmin:
		return 4
	}
	return 0
}

// permits applies the role-rights table and the key scopes: read keys make GETs a responder may make, write keys also
// the routes flagged KeyWrite.
func (a *Actor) permits(acc access, method string, keyWrite bool) bool {
	if roleRank[a.Role] < acc.rank() {
		return false
	}
	if !a.IsKey() {
		return true
	}
	if method == http.MethodGet {
		return true
	}
	return a.KeyScope == "write" && keyWrite
}

func hashSecret(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}

func hashPassword(password string) (string, error) {
	salt := newToken(12)
	key, err := pbkdf2.Key(sha256.New, password, []byte(salt), passwordRounds, 32)
	if err != nil {
		return "", fmt.Errorf("derive password key: %w", err)
	}
	return salt + "$" + hex.EncodeToString(key), nil
}

func checkPassword(stored, password string) bool {
	salt, want, found := strings.Cut(stored, "$")
	if !found {
		return false
	}
	key, err := pbkdf2.Key(sha256.New, password, []byte(salt), passwordRounds, 32)
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(hex.EncodeToString(key)), []byte(want)) == 1
}

// authenticate resolves the request's actor: a bearer API key, else the session cookie.
func (a *App) authenticate(r *http.Request) (*Actor, error) {
	ctx := r.Context()
	if header := r.Header.Get("Authorization"); strings.HasPrefix(header, "Bearer ") {
		secret := strings.TrimPrefix(header, "Bearer ")
		var name, scope string
		// grace_ends_at > now is the SQL form of the edge rule (edge.go): a retired secret stops working at its end second.
		err := a.db.QueryRow(ctx, `select k.name, k.scope from api_key_secrets s join api_keys k on k.id = s.key_id
			where s.hash = $1 and k.revoked_at is null and (s.grace_ends_at is null or s.grace_ends_at > $2)`,
			hashSecret(secret), a.clock.Now()).Scan(&name, &scope)
		if isNoRows(err) {
			return nil, errInvalidKey()
		}
		if err != nil {
			return nil, fmt.Errorf("look up api key: %w", err)
		}
		return &Actor{Name: name, Role: "responder", KeyScope: scope}, nil
	}
	cookie, err := r.Cookie(sessionCookie)
	if err != nil || cookie.Value == "" {
		return nil, errUnauthenticated()
	}
	actor := &Actor{}
	err = a.db.QueryRow(ctx, `select u.id, u.name, u.email, u.role, u.timezone from sessions s join users u on u.id = s.user_id
		where s.token_hash = $1 and u.removed_at is null`, hashSecret(cookie.Value)).
		Scan(&actor.ID, &actor.Name, &actor.Email, &actor.Role, &actor.Zone)
	if isNoRows(err) {
		return nil, errUnauthenticated()
	}
	if err != nil {
		return nil, fmt.Errorf("look up session: %w", err)
	}
	return actor, nil
}

// userView is the published person.
type userView struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Email    string `json:"email"`
	Role     string `json:"role"`
	Timezone string `json:"timezone"`
}

func (a *App) hSignIn(rq *Req) error {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := rq.Decode(&body); err != nil {
		return fmt.Errorf("read sign-in request: %w", err)
	}
	var user userView
	var hash string
	err := a.db.QueryRow(rq.Ctx(), `select id, name, email, role, timezone, password_hash from users
		where lower(email) = lower($1) and removed_at is null`, body.Email).
		Scan(&user.ID, &user.Name, &user.Email, &user.Role, &user.Timezone, &hash)
	if isNoRows(err) || (err == nil && !checkPassword(hash, body.Password)) {
		return errInvalidCredentials()
	}
	if err != nil {
		return fmt.Errorf("look up person: %w", err)
	}
	token := newToken(32)
	if _, err := a.db.Exec(rq.Ctx(), `insert into sessions (token_hash, user_id, created_at) values ($1, $2, $3)`,
		hashSecret(token), user.ID, a.clock.Now()); err != nil {
		return fmt.Errorf("create session: %w", err)
	}
	http.SetCookie(rq.W, &http.Cookie{Name: sessionCookie, Value: token, Path: "/", HttpOnly: true,
		SameSite: http.SameSiteLaxMode, MaxAge: 30 * 24 * 3600})
	return rq.JSON(http.StatusOK, map[string]any{"user": user})
}

func (a *App) hSignOut(rq *Req) error {
	if cookie, err := rq.R.Cookie(sessionCookie); err == nil {
		if _, err := a.db.Exec(rq.Ctx(), `delete from sessions where token_hash = $1`, hashSecret(cookie.Value)); err != nil {
			return fmt.Errorf("end session: %w", err)
		}
	}
	http.SetCookie(rq.W, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", HttpOnly: true, MaxAge: -1})
	return rq.NoContent()
}

// meView is the signed-in person with their settings.
type meView struct {
	userView
	QuietStart          *string `json:"quiet_start"`
	QuietEnd            *string `json:"quiet_end"`
	NotificationDelays  []int   `json:"notification_delays"`
	LowUrgencyDelay     int     `json:"low_urgency_delay"`
	IncidentsNeedingYou int     `json:"incidents_needing_you"`
}

func (a *App) loadMe(rq *Req) (*meView, error) {
	me := &meView{}
	err := a.db.QueryRow(rq.Ctx(), `select id, name, email, role, timezone, quiet_start, quiet_end, notification_delays,
		low_urgency_delay, (select count(*) from incidents i where i.status = 'triggered' and u.id = any(i.holders))
		from users u where id = $1`, rq.Actor.ID).
		Scan(&me.ID, &me.Name, &me.Email, &me.Role, &me.Timezone, &me.QuietStart, &me.QuietEnd, &me.NotificationDelays,
			&me.LowUrgencyDelay, &me.IncidentsNeedingYou)
	if err != nil {
		return nil, fmt.Errorf("read settings: %w", err)
	}
	return me, nil
}

func (a *App) hMe(rq *Req) error {
	if rq.Actor.IsKey() {
		return errForbidden()
	}
	me, err := a.loadMe(rq)
	if err != nil {
		return fmt.Errorf("load current user: %w", err)
	}
	return rq.JSON(http.StatusOK, me)
}

var clockFormat = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)

const (
	delaysSentence    = "Use 1 to 5 whole minutes from 0 to 60, separated by commas."
	urgencySentence   = "Use a whole number of minutes from 0 to 60."
	quietSentence     = "Use the format HH:MM."
	quietPairSentence = "Set both quiet hours times or neither."
)

func (a *App) hPatchMe(rq *Req) error {
	if rq.Actor.IsKey() {
		return errForbidden()
	}
	var change map[string]json.RawMessage
	if err := rq.Decode(&change); err != nil {
		return fmt.Errorf("read profile update: %w", err)
	}
	problems := map[string]string{}
	sets := map[string]any{}
	if raw, ok := change["timezone"]; ok {
		var zone string
		if json.Unmarshal(raw, &zone) != nil || !isListedZone(zone) {
			problems["timezone"] = "Choose a listed time zone."
		}
		sets["timezone"] = zone
	}
	_, hasStart := change["quiet_start"]
	_, hasEnd := change["quiet_end"]
	if hasStart || hasEnd {
		start, startOK := quietTime(change["quiet_start"])
		end, endOK := quietTime(change["quiet_end"])
		switch {
		case !startOK && hasStart:
			problems["quiet_start"] = quietSentence
		case !endOK && hasEnd:
			problems["quiet_end"] = quietSentence
		case (start == nil) != (end == nil):
			problems["quiet_start"] = quietPairSentence
		}
		sets["quiet_start"], sets["quiet_end"] = start, end
	}
	if raw, ok := change["notification_delays"]; ok {
		var delays []int
		if json.Unmarshal(raw, &delays) != nil || len(delays) < 1 || len(delays) > 5 || anyOutside(delays, 0, 60) {
			problems["notification_delays"] = delaysSentence
		}
		sets["notification_delays"] = delays
	}
	if raw, ok := change["low_urgency_delay"]; ok {
		var minutes int
		if json.Unmarshal(raw, &minutes) != nil || minutes < 0 || minutes > 60 {
			problems["low_urgency_delay"] = urgencySentence
		}
		sets["low_urgency_delay"] = minutes
	}
	if len(problems) > 0 {
		return errFields(problems)
	}
	for column, value := range sets {
		if _, err := a.db.Exec(rq.Ctx(), `update users set `+column+` = $1 where id = $2`, value, rq.Actor.ID); err != nil {
			return fmt.Errorf("save %s: %w", column, err)
		}
	}
	if err := a.hMe(rq); err != nil {
		return fmt.Errorf("reload profile: %w", err)
	}
	return nil
}

// quietTime reads one quiet-hours value: null is no value, a bad format reports false.
func quietTime(raw json.RawMessage) (*string, bool) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, true
	}
	var text string
	if json.Unmarshal(raw, &text) != nil || !clockFormat.MatchString(text) {
		return nil, false
	}
	return &text, true
}

func anyOutside(values []int, low, high int) bool {
	for _, v := range values {
		if v < low || v > high {
			return true
		}
	}
	return false
}

func (a *App) hUsers(rq *Req) error {
	rows, err := a.db.Query(rq.Ctx(), `select id, name, email, role, timezone from users where removed_at is null order by name`)
	if err != nil {
		return fmt.Errorf("list people: %w", err)
	}
	defer rows.Close()
	items := []userView{}
	for rows.Next() {
		var u userView
		if err := rows.Scan(&u.ID, &u.Name, &u.Email, &u.Role, &u.Timezone); err != nil {
			return fmt.Errorf("scan person: %w", err)
		}
		items = append(items, u)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("list people: %w", err)
	}
	return rq.JSON(http.StatusOK, map[string]any{"items": items})
}

// systemProbes are the parts of GET /api/system, filled by the domain that knows each: queue, mail, schedule_upgrade.
var systemProbes = map[string]func(*App) any{}

func (a *App) hSystem(rq *Req) error {
	out := map[string]any{"cache": map[bool]string{true: "ok", false: "down"}[a.cache.Up()]}
	for name, probe := range systemProbes {
		out[name] = probe(a)
	}
	return rq.JSON(http.StatusOK, out)
}

func (a *App) hHealth(rq *Req) error {
	return rq.JSON(http.StatusOK, map[string]string{"status": "ok"})
}

func (a *App) hClock(rq *Req) error { return rq.JSON(http.StatusOK, a.clock.State()) }

// userName reads a person's display name.
func userName(ctx context.Context, q dbq, id string) (string, error) {
	var name string
	if err := q.QueryRow(ctx, `select name from users where id = $1`, id).Scan(&name); err != nil {
		return "", fmt.Errorf("read person %s: %w", id, err)
	}
	return name, nil
}

func init() {
	routeSetups = append(routeSetups, func(a *App) {
		a.route(route{Pattern: "GET /api/health", Access: accPublic, Handler: a.hHealth})
		a.route(route{Pattern: "POST /api/session", Access: accPublic, Handler: a.hSignIn})
		a.route(route{Pattern: "DELETE /api/session", Access: accAny, Handler: a.hSignOut})
		a.route(route{Pattern: "GET /api/me", Access: accAny, Handler: a.hMe})
		a.route(route{Pattern: "PATCH /api/me", Access: accAny, Handler: a.hPatchMe})
		a.route(route{Pattern: "GET /api/users", Access: accStaff, Handler: a.hUsers})
		a.route(route{Pattern: "GET /api/system", Access: accStaff, Handler: a.hSystem})
		a.route(route{Pattern: "GET /api/clock", Access: accAny, Handler: a.hClock})
		a.route(route{Pattern: "GET /api/live", Access: accStaff, Handler: a.hLive})
	})
}
