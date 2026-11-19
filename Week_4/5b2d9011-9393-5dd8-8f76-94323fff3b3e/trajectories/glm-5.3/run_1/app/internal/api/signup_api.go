package api

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"holdfast/internal/apperr"
	"holdfast/internal/httpx"
	"holdfast/internal/store"
	"holdfast/internal/zoneinfo"
)

// mailFormatter renders times in the published email shape:
// Ddd D Mon YYYY, HH:MM <abbr> (<IANA zone>).
func mailTime(t time.Time, zone string) string {
	loc, err := zoneinfo.Load(zone)
	if err != nil {
		loc = time.UTC
	}
	local := t.In(loc)
	return fmt.Sprintf("%s (%s)", local.Format("Mon 2 Jan 2006, 15:04")+" "+zoneinfo.Abbr(local, loc), zone)
}

// studioMailTime renders the same shape in the studio zone.
func (a *App) studioMailTime(t time.Time) string {
	local := t.In(a.Studio.Loc)
	return fmt.Sprintf("%s (%s)", local.Format("Mon 2 Jan 2006, 15:04")+" "+zoneinfo.Abbr(local, a.Studio.Loc), a.Studio.Name)
}

// handleSignup stores one sign-up and queues its confirmation email.
func (a *App) handleSignup(w http.ResponseWriter, r *http.Request, nightID string) {
	if err := a.requireStorage(); err != nil {
		httpx.WriteError(w, err)
		return
	}
	var body struct {
		Name       string `json:"name"`
		Email      string `json:"email"`
		ViewerZone string `json:"viewer_zone"`
	}
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		httpx.WriteError(w, err)
		return
	}
	fields := map[string]string{}
	name := strings.TrimSpace(body.Name)
	if len(name) < 1 || len(name) > 40 {
		fields["name"] = "Use 1 to 40 characters."
	}
	if !validEmail(body.Email) {
		fields["email"] = "Enter a valid email address."
	}
	if !zoneinfo.Valid(body.ViewerZone) {
		fields["viewer_zone"] = "Pick a time zone from the list."
	}
	if len(fields) > 0 {
		httpx.WriteError(w, apperr.Validation(fields))
		return
	}

	ctx, cancel := ctxWithTimeout()
	defer cancel()
	n, err := a.Store.NightByID(ctx, nightID)
	if err != nil {
		if store.IsNotFound(err) {
			httpx.WriteError(w, apperr.NotFound)
			return
		}
		httpx.WriteError(w, apperr.StorageUnavailable)
		return
	}
	now := a.Clock.Now().UTC()
	status, _ := nightStatus(n, now)

	// A repeat returns the stored sign-up (a replay, answered even after
	// closing) and sends nothing new.
	if su, found, err := a.Store.SignupByEmail(ctx, n.ID, body.Email); err == nil && found {
		httpx.WriteJSON(w, http.StatusOK, map[string]any{
			"signup": signupView(su), "email_status": "already_signed_up",
		})
		return
	}

	if status != "signups_open" {
		switch status {
		case "scheduled":
			httpx.WriteError(w, signupsNotOpenView(n, a))
		case "closed":
			httpx.WriteError(w, signupsClosedView(n, a))
		default:
			// live or done
			httpx.WriteError(w, signupsClosedView(n, a))
		}
		return
	}

	// Capacity check, atomic under contention.
	signedUp, err := a.Store.CountSignups(ctx, n.ID)
	if err != nil {
		httpx.WriteError(w, apperr.StorageUnavailable)
		return
	}
	if signedUp >= n.Capacity {
		httpx.WriteError(w, apperr.NightFull)
		return
	}

	confirmSubject := fmt.Sprintf("Signed up: %s · %s", n.Title, studioDateLong(n.StartsAt, a.Studio.Loc))
	confirmBody := fmt.Sprintf(
		"Hi %s,\n\nYou're on the list for %s.\n\nStudio time: %s\nYour time: %s\nSign-ups close: %s\n",
		name, n.Title,
		a.studioMailTime(n.StartsAt), mailTime(n.StartsAt, body.ViewerZone),
		a.studioMailTime(n.SignupsCloseAt),
	)
	su, err := a.Store.CreateSignup(ctx, store.NewID(), n.ID, name, body.Email, body.ViewerZone,
		confirmSubject, confirmBody, n.StartsAt)
	if err != nil {
		if errors.Is(err, store.ErrEmailTaken) {
			// Another request won the race; return the stored sign-up.
			if su2, found, gerr := a.Store.SignupByEmail(ctx, n.ID, body.Email); gerr == nil && found {
				httpx.WriteJSON(w, http.StatusOK, map[string]any{
					"signup": signupView(su2), "email_status": "already_signed_up",
				})
				return
			}
			httpx.WriteError(w, apperr.NightFull)
			return
		}
		httpx.WriteError(w, apperr.StorageUnavailable)
		return
	}

	emailStatus := "sent"
	if !a.ServiceUp("mail") {
		emailStatus = "queued"
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{
		"signup": signupView(su), "email_status": emailStatus,
	})
}

// signupsClosedView renders the closing-time error with the studio shape.
func signupsClosedView(n store.Night, a *App) *apperr.Error {
	closeLocal := n.SignupsCloseAt.In(a.Studio.Loc)
	return apperr.SignupsClosed(fmt.Sprintf("%s %s", closeLocal.Format("15:04"), zoneinfo.Abbr(closeLocal, a.Studio.Loc)))
}

// signupsNotOpenView renders the opening-time error.
func signupsNotOpenView(n store.Night, a *App) *apperr.Error {
	openLocal := n.SignupsOpenAt.In(a.Studio.Loc)
	e := apperr.SignupsNotOpen()
	e.Message = fmt.Sprintf("Sign-ups open %s %s %s studio time.",
		openLocal.Format("Mon 2 Jan"), openLocal.Format("15:04"), zoneinfo.Abbr(openLocal, a.Studio.Loc))
	return e
}

func signupView(su store.Signup) map[string]any {
	return map[string]any{
		"id": su.ID, "night_id": su.NightID, "name": su.Name, "email": su.Email,
		"viewer_zone": su.ViewerZone, "created_at": clockInstant(su.CreatedAt),
	}
}

func validEmail(s string) bool {
	s = strings.TrimSpace(s)
	at := strings.Index(s, "@")
	if at < 1 || at == len(s)-1 {
		return false
	}
	domain := s[at+1:]
	dot := strings.LastIndex(domain, ".")
	return dot > 0 && dot < len(domain)-1
}

func studioDateLong(t time.Time, loc *time.Location) string {
	return t.In(loc).Format("Mon 2 Jan 2006")
}

func (a *App) handleSignupList(w http.ResponseWriter, r *http.Request, nightID string) {
	player, aerr := a.authenticate(r)
	if aerr != nil {
		httpx.WriteError(w, aerr)
		return
	}
	if err := a.requireStorage(); err != nil {
		httpx.WriteError(w, err)
		return
	}
	if player.Role != "founder" {
		httpx.WriteError(w, apperr.ForbiddenRole())
		return
	}
	ctx, cancel := ctxWithTimeout()
	defer cancel()
	if _, err := a.Store.NightByID(ctx, nightID); err != nil {
		httpx.WriteError(w, apperr.NotFound)
		return
	}
	rows, err := a.Store.Signups(ctx, nightID)
	if err != nil {
		httpx.WriteError(w, apperr.StorageUnavailable)
		return
	}
	out := make([]map[string]any, 0, len(rows))
	for _, su := range rows {
		out = append(out, signupView(su))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"signups": out})
}
