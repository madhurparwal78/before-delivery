package api

import (
	"net/http"
	"strings"

	"holdfast/internal/apperr"
	"holdfast/internal/httpx"
	"holdfast/internal/store"
)

// SessionTokenFrom extracts the session token from the cookie or the bearer
// header.
func SessionTokenFrom(r *http.Request) string {
	if c, err := r.Cookie("hf_session"); err == nil && c.Value != "" {
		return c.Value
	}
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
	}
	return ""
}

// authenticate resolves the session's player.
func (a *App) authenticate(r *http.Request) (store.Player, *apperr.Error) {
	token := SessionTokenFrom(r)
	if token == "" {
		return store.Player{}, apperr.Unauthenticated
	}
	ctx, cancel := ctxWithTimeout()
	defer cancel()
	p, err := a.Store.PlayerByToken(ctx, token)
	if err != nil {
		if store.IsNotFound(err) {
			return store.Player{}, apperr.Unauthenticated
		}
		return store.Player{}, apperr.StorageUnavailable
	}
	return p, nil
}

// requireStorage guards an endpoint that needs Postgres.
func (a *App) requireStorage() *apperr.Error {
	if !a.ServiceUp("postgres") {
		return apperr.StorageUnavailable
	}
	return nil
}

var callsignAllowed = func(c rune) bool {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
		c == ' ' || c == '-' || c == '_'
}

// validCallsign checks the published callsign rule.
func validCallsign(s string) bool {
	if len(s) < 3 || len(s) > 16 {
		return false
	}
	for _, c := range s {
		if !callsignAllowed(c) {
			return false
		}
	}
	return true
}

func (a *App) handleSessionPost(w http.ResponseWriter, r *http.Request) {
	if err := a.requireStorage(); err != nil {
		httpx.WriteError(w, err)
		return
	}
	var body struct {
		Callsign  string `json:"callsign"`
		StudioKey string `json:"studio_key"`
	}
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		httpx.WriteError(w, err)
		return
	}
	fields := map[string]string{}
	cs := strings.TrimSpace(body.Callsign)
	if !validCallsign(cs) {
		fields["callsign"] = "Use 3 to 16 letters, digits, spaces, hyphens or underscores."
	}
	if len(fields) > 0 {
		httpx.WriteError(w, apperr.Validation(fields))
		return
	}
	ctx, cancel := ctxWithTimeout()
	defer cancel()
	role := "player"
	if body.StudioKey != "" {
		st, err := a.Store.Studio(ctx)
		if err != nil {
			httpx.WriteError(w, apperr.StorageUnavailable)
			return
		}
		if store.HashKey(body.StudioKey) != st.StudioKeyHash {
			e := apperr.SingleValidation("studio_key", "")
			e.Status = http.StatusForbidden
			e.Code = "studio_key_invalid"
			e.Message = "That studio key isn't right."
			e.Fields = nil
			httpx.WriteError(w, e)
			return
		}
		role = "founder"
	}
	// Reuse an existing player with the same callsign.
	p, err := a.Store.PlayerByCallsign(ctx, cs)
	if err != nil {
		if !store.IsNotFound(err) {
			httpx.WriteError(w, apperr.StorageUnavailable)
			return
		}
		p = store.Player{ID: store.NewID(), Callsign: cs, Role: role}
		if err := a.Store.CreatePlayer(ctx, p.ID, p.Callsign, p.Role); err != nil {
			httpx.WriteError(w, apperr.StorageUnavailable)
			return
		}
	}
	token := store.NewToken()
	if err := a.Store.CreateSession(ctx, token, p.ID); err != nil {
		httpx.WriteError(w, apperr.StorageUnavailable)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: "hf_session", Value: token, Path: "/", HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{
		"token": token,
		"player": map[string]string{"id": p.ID, "callsign": p.Callsign, "role": p.Role},
	})
}

func (a *App) handleMeGet(w http.ResponseWriter, r *http.Request) {
	p, err := a.authenticate(r)
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"player": map[string]string{
		"id": p.ID, "callsign": p.Callsign, "role": p.Role,
	}})
}

func (a *App) handleMeDelete(w http.ResponseWriter, r *http.Request) {
	token := SessionTokenFrom(r)
	if token == "" {
		httpx.WriteError(w, apperr.Unauthenticated)
		return
	}
	if err := a.requireStorage(); err != nil {
		httpx.WriteError(w, err)
		return
	}
	ctx, cancel := ctxWithTimeout()
	defer cancel()
	if _, err := a.Store.PlayerByToken(ctx, token); err != nil {
		httpx.WriteError(w, apperr.Unauthenticated)
		return
	}
	if err := a.Store.DeleteSession(ctx, token); err != nil {
		httpx.WriteError(w, apperr.StorageUnavailable)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "hf_session", Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode})
	w.WriteHeader(http.StatusNoContent)
}

func (a *App) handleSettingsGet(w http.ResponseWriter, r *http.Request) {
	p, aerr := a.authenticate(r)
	if aerr != nil {
		httpx.WriteError(w, aerr)
		return
	}
	if err := a.requireStorage(); err != nil {
		httpx.WriteError(w, err)
		return
	}
	ctx, cancel := ctxWithTimeout()
	defer cancel()
	st, err := a.Store.Settings(ctx, p.ID)
	if err != nil {
		httpx.WriteError(w, apperr.StorageUnavailable)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, st)
}

func (a *App) handleSettingsPut(w http.ResponseWriter, r *http.Request) {
	p, aerr := a.authenticate(r)
	if aerr != nil {
		httpx.WriteError(w, aerr)
		return
	}
	if err := a.requireStorage(); err != nil {
		httpx.WriteError(w, err)
		return
	}
	var body store.Settings
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		httpx.WriteError(w, err)
		return
	}
	fields := map[string]string{}
	if !validBindings(body.Bindings) {
		fields["bindings"] = "Every action needs exactly one key, and no key may serve two actions."
	}
	if body.MasterVolume < 0 || body.MasterVolume > 100 {
		fields["master_volume"] = "Use 0 to 100."
	}
	if body.EffectsVolume < 0 || body.EffectsVolume > 100 {
		fields["effects_volume"] = "Use 0 to 100."
	}
	if len(fields) > 0 {
		httpx.WriteError(w, apperr.Validation(fields))
		return
	}
	ctx, cancel := ctxWithTimeout()
	defer cancel()
	if err := a.Store.SaveSettings(ctx, p.ID, body); err != nil {
		httpx.WriteError(w, apperr.StorageUnavailable)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, body)
}

// validBindings checks that every action has exactly one key and no key
// serves two actions.
func validBindings(b map[string]string) bool {
	if len(b) != len(store.BindingActions) {
		return false
	}
	seen := map[string]bool{}
	for _, action := range store.BindingActions {
		code, ok := b[action]
		if !ok || code == "" || code == "Escape" {
			return false
		}
		if seen[code] {
			return false
		}
		seen[code] = true
	}
	return true
}

