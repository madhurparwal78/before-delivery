package main

import (
	"context"
	"fmt"
	"net/http"
	"time"
)

const removalLookahead = 60 * 24 * time.Hour

var roleNames = map[string]bool{"responder": true, "lead": true, "admin": true, "stakeholder": true}

// removalShift is a final-schedule shift that would lose its person.
type removalShift struct {
	Schedule string `json:"schedule"`
	Start    string `json:"start"`
	End      string `json:"end"`
}

// removalLevel is a policy level that names the person as a target.
type removalLevel struct {
	Policy string `json:"policy"`
	Level  int    `json:"level"`
}

// lockPerson reads a person who has not been removed, locking the row for this work. A removed person is as good as absent.
func lockPerson(w *Work, id string) (userView, error) {
	var user userView
	err := w.Tx.QueryRow(w.Ctx, `select id, name, email, role, timezone from users where id = $1 and removed_at is null for update`, id).
		Scan(&user.ID, &user.Name, &user.Email, &user.Role, &user.Timezone)
	if isNoRows(err) {
		return user, errNotFound()
	}
	if err != nil {
		return user, fmt.Errorf("read person %s: %w", id, err)
	}
	return user, nil
}

// leavesNoAdmin reports whether the administrator being demoted or removed is the last one.
func leavesNoAdmin(w *Work, user userView) (bool, error) {
	if user.Role != "admin" {
		return false, nil
	}
	var others int
	err := w.Tx.QueryRow(w.Ctx, `select count(*) from users where role = 'admin' and removed_at is null and id <> $1`, user.ID).Scan(&others)
	if err != nil {
		return false, fmt.Errorf("count administrators: %w", err)
	}
	return others == 0, nil
}

// endSessions deletes a person's sessions and closes their sockets with the signed-out code once the work commits.
func endSessions(w *Work, userID string) error {
	if _, err := w.Tx.Exec(w.Ctx, `delete from sessions where user_id = $1`, userID); err != nil {
		return fmt.Errorf("end sessions of %s: %w", userID, err)
	}
	w.After(func(context.Context) { w.A.hub.CloseUser(userID, closeSignedOut, "signed out") })
	return nil
}

func (a *App) hChangeRole(rq *Req) error {
	var body struct {
		Role string `json:"role"`
	}
	if err := rq.Decode(&body); err != nil {
		return fmt.Errorf("read role change: %w", err)
	}
	var changed userView
	err := a.Do(rq.Ctx(), func(w *Work) error {
		user, err := lockPerson(w, rq.Param("id"))
		if err != nil {
			return fmt.Errorf("find person: %w", err)
		}
		if body.Role != "admin" {
			last, err := leavesNoAdmin(w, user)
			if err != nil {
				return fmt.Errorf("check administrators: %w", err)
			}
			if last {
				return errConflict("last_admin")
			}
		}
		if !roleNames[body.Role] {
			return errField("role", "Choose responder, lead, admin or stakeholder.")
		}
		changed = user
		if user.Role == body.Role {
			return nil
		}
		if _, err := w.Tx.Exec(w.Ctx, `update users set role = $2 where id = $1`, user.ID, body.Role); err != nil {
			return fmt.Errorf("change role: %w", err)
		}
		changed.Role = body.Role
		w.After(func(context.Context) { a.hub.CloseUser(user.ID, closeRoleChanged, "role changed") })
		w.Publish("access", map[string]any{"user_id": user.ID, "kind": "role"})
		return nil
	})
	if err != nil {
		return fmt.Errorf("change role: %w", err)
	}
	return rq.JSON(http.StatusOK, changed)
}

func (a *App) hSignPersonOut(rq *Req) error {
	err := a.Do(rq.Ctx(), func(w *Work) error {
		user, err := lockPerson(w, rq.Param("id"))
		if err != nil {
			return fmt.Errorf("find person: %w", err)
		}
		if err := endSessions(w, user.ID); err != nil {
			return fmt.Errorf("sign person out: %w", err)
		}
		w.Publish("access", map[string]any{"user_id": user.ID, "kind": "signed_out"})
		return nil
	})
	if err != nil {
		return fmt.Errorf("sign person out: %w", err)
	}
	return rq.NoContent()
}

// removalBreaks lists what removing a person would break: their final-schedule shifts in the next 60 days in schedule
// then start order, then the policy levels that name them.
func (a *App) removalBreaks(w *Work, userID string) ([]any, error) {
	shifts, err := a.personShifts(w.Ctx, w.Tx, userID, w.Now, w.Now.Add(removalLookahead))
	if err != nil {
		return nil, fmt.Errorf("list shifts of %s: %w", userID, err)
	}
	breaks := []any{}
	for _, shift := range shifts {
		breaks = append(breaks, removalShift{Schedule: shift.Schedule, Start: formatInstant(shift.Start), End: formatInstant(shift.End)})
	}
	rows, err := w.Tx.Query(w.Ctx, `select p.name, l.position from policies p
		cross join lateral jsonb_array_elements(p.levels) with ordinality as l(level, position)
		where exists (select 1 from jsonb_array_elements(l.level -> 'targets') t where t ->> 'type' = 'person' and t ->> 'id' = $1)
		order by p.name, l.position`, userID)
	if err != nil {
		return nil, fmt.Errorf("list policy levels naming %s: %w", userID, err)
	}
	defer rows.Close()
	for rows.Next() {
		var level removalLevel
		if err := rows.Scan(&level.Policy, &level.Level); err != nil {
			return nil, fmt.Errorf("scan policy level: %w", err)
		}
		breaks = append(breaks, level)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list policy levels naming %s: %w", userID, err)
	}
	return breaks, nil
}

func (a *App) hRemovePerson(rq *Req) error {
	err := a.Do(rq.Ctx(), func(w *Work) error {
		user, err := lockPerson(w, rq.Param("id"))
		if err != nil {
			return fmt.Errorf("find person: %w", err)
		}
		last, err := leavesNoAdmin(w, user)
		if err != nil {
			return fmt.Errorf("check administrators: %w", err)
		}
		if last {
			return errConflict("last_admin")
		}
		breaks, err := a.removalBreaks(w, user.ID)
		if err != nil {
			return fmt.Errorf("check what removal breaks: %w", err)
		}
		if len(breaks) > 0 {
			return errConflict("still_needed", "breaks", breaks)
		}
		if _, err := w.Tx.Exec(w.Ctx, `update users set removed_at = $2 where id = $1`, user.ID, w.Now); err != nil {
			return fmt.Errorf("remove person: %w", err)
		}
		if err := endSessions(w, user.ID); err != nil {
			return fmt.Errorf("sign removed person out: %w", err)
		}
		w.Publish("access", map[string]any{"user_id": user.ID, "kind": "removed"})
		return nil
	})
	if err != nil {
		return fmt.Errorf("remove person: %w", err)
	}
	return rq.NoContent()
}

func init() {
	routeSetups = append(routeSetups, func(a *App) {
		a.route(route{Pattern: "PATCH /api/users/{id}", Access: accAdmin, Resource: "user", Handler: a.hChangeRole})
		a.route(route{Pattern: "POST /api/users/{id}/sign-out", Access: accAdmin, Resource: "user", Handler: a.hSignPersonOut})
		a.route(route{Pattern: "DELETE /api/users/{id}", Access: accAdmin, Resource: "user", Handler: a.hRemovePerson})
	})
}
