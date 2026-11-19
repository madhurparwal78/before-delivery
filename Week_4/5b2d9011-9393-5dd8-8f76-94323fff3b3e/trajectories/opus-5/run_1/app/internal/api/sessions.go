package api

import (
	"net/http"
	"strings"
	"unicode"

	"github.com/cinderlatch/holdfast/internal/apierr"
	"github.com/cinderlatch/holdfast/internal/store"
)

// Field messages, exactly as the brief publishes them.
const (
	msgCallsign   = "Use 3 to 16 letters, digits, spaces, hyphens or underscores."
	msgName       = "Use 1 to 40 characters."
	msgEmail      = "Enter a valid email address."
	msgViewerZone = "Pick a time zone from the list."
	msgTitle      = "Use 1 to 60 characters."
	msgLocalTime  = "Use HH:MM, 24-hour."
	msgWeeks      = "Use 1 to 26."
	msgCapacity   = "Use 1 to 64."
	msgPrice      = "Use a whole number from 1 to 5000."
	msgEffective  = "Pick a time after now, in studio time."
)

// token reads the session token from the cookie or the bearer header.
func token(r *http.Request) string {
	if header := r.Header.Get("Authorization"); strings.HasPrefix(header, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
	}
	if cookie, err := r.Cookie(sessionCookie); err == nil {
		return cookie.Value
	}
	return ""
}

// player resolves the session, from the cache first so a live room keeps
// answering while Postgres is away.
func (s *Server) player(r *http.Request) (store.Player, *apierr.Error) {
	raw := token(r)
	if raw == "" {
		return store.Player{}, apierr.Unauthenticated()
	}

	s.sessionsMu.RLock()
	cached, ok := s.sessions[raw]
	s.sessionsMu.RUnlock()
	if ok {
		return cached, nil
	}

	found, exists, err := s.store.PlayerByToken(r.Context(), raw)
	if err != nil {
		return store.Player{}, apierr.StorageUnavailable()
	}
	if !exists {
		return store.Player{}, apierr.Unauthenticated()
	}
	s.cacheSession(raw, found)
	return found, nil
}

func (s *Server) cacheSession(raw string, player store.Player) {
	s.sessionsMu.Lock()
	s.sessions[raw] = player
	s.sessionsMu.Unlock()
}

func (s *Server) forgetSession(raw string) {
	s.sessionsMu.Lock()
	delete(s.sessions, raw)
	s.sessionsMu.Unlock()
}

// founder resolves a session and insists on the founder role.
func (s *Server) founder(r *http.Request) (store.Player, *apierr.Error) {
	player, failure := s.player(r)
	if failure != nil {
		return store.Player{}, failure
	}
	if player.Role != "founder" {
		return store.Player{}, apierr.FounderOnly()
	}
	return player, nil
}

type createSessionRequest struct {
	Callsign  string `json:"callsign"`
	StudioKey string `json:"studio_key"`
}

// validCallsign reports whether a callsign is 3 to 16 letters, digits, spaces,
// hyphens or underscores.
func validCallsign(callsign string) bool {
	runes := []rune(callsign)
	if len(runes) < 3 || len(runes) > 16 {
		return false
	}
	for _, r := range runes {
		switch {
		case unicode.IsLetter(r), unicode.IsDigit(r), r == ' ', r == '-', r == '_':
		default:
			return false
		}
	}
	return true
}

func (s *Server) handleCreateSession(w http.ResponseWriter, r *http.Request) {
	var body createSessionRequest
	if failure := decode(r, &body); failure != nil {
		apierr.Write(w, failure)
		return
	}

	callsign := strings.TrimSpace(body.Callsign)
	if !validCallsign(callsign) {
		apierr.Write(w, apierr.Field("callsign", msgCallsign))
		return
	}

	role := "player"
	if key := strings.TrimSpace(body.StudioKey); key != "" {
		matches, err := s.store.StudioKeyMatches(r.Context(), key)
		if err != nil {
			apierr.Write(w, apierr.StorageUnavailable())
			return
		}
		if !matches {
			apierr.Write(w, apierr.New(http.StatusForbidden, "studio_key_invalid", "That studio key isn't right."))
			return
		}
		role = "founder"
	}

	player, raw, err := s.store.CreatePlayer(r.Context(), callsign, role)
	if err != nil {
		apierr.Write(w, apierr.StorageUnavailable())
		return
	}
	s.cacheSession(raw, player)

	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    raw,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
	writeJSON(w, http.StatusCreated, map[string]any{"token": raw, "player": player})
}

func (s *Server) handleDeleteSession(w http.ResponseWriter, r *http.Request) {
	if _, failure := s.player(r); failure != nil {
		apierr.Write(w, failure)
		return
	}
	raw := token(r)
	s.forgetSession(raw)
	if err := s.store.DeleteSession(r.Context(), raw); err != nil {
		apierr.Write(w, apierr.StorageUnavailable())
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: "", Path: "/", HttpOnly: true,
		SameSite: http.SameSiteLaxMode, MaxAge: -1,
	})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	player, failure := s.player(r)
	if failure != nil {
		apierr.Write(w, failure)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"player": player})
}

func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	player, failure := s.player(r)
	if failure != nil {
		apierr.Write(w, failure)
		return
	}
	settings, err := s.store.Settings(r.Context(), player.ID)
	if err != nil {
		apierr.Write(w, apierr.StorageUnavailable())
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

func (s *Server) handlePutSettings(w http.ResponseWriter, r *http.Request) {
	player, failure := s.player(r)
	if failure != nil {
		apierr.Write(w, failure)
		return
	}

	var body store.Settings
	if failure := decode(r, &body); failure != nil {
		apierr.Write(w, failure)
		return
	}

	fields := map[string]string{}
	if message := checkBindings(body.Bindings); message != "" {
		fields["bindings"] = message
	}
	if body.MasterVolume < 0 || body.MasterVolume > 100 {
		fields["master_volume"] = "Use a whole number from 0 to 100."
	}
	if body.EffectsVolume < 0 || body.EffectsVolume > 100 {
		fields["effects_volume"] = "Use a whole number from 0 to 100."
	}
	if len(fields) > 0 {
		apierr.Write(w, apierr.Validation(fields))
		return
	}

	saved, err := s.store.SaveSettings(r.Context(), player.ID, body)
	if err != nil {
		apierr.Write(w, apierr.StorageUnavailable())
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

// checkBindings insists on exactly one key per action, no key twice and never
// Escape.
func checkBindings(bindings map[string]string) string {
	if len(bindings) != len(store.BindingActions) {
		return "Bind every action to exactly one key."
	}
	used := map[string]string{}
	for _, action := range store.BindingActions {
		key, ok := bindings[action]
		if !ok || key == "" {
			return "Bind every action to exactly one key."
		}
		if key == "Escape" {
			return "Escape can't be bound."
		}
		if other, taken := used[key]; taken {
			return key + " is already bound to " + other + "."
		}
		used[key] = action
	}
	return ""
}
