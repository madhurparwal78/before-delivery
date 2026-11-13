package main

import (
	"fmt"
	"net/http"
	"strings"
	"unicode/utf8"
)

const maxFilterNameLength = 80

// savedFilter is one named incident filter of a person.
type savedFilter struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Status    string  `json:"status"`
	ServiceID *string `json:"service_id"`
}

func (a *App) hListSavedFilters(rq *Req) error {
	if rq.Actor.IsKey() {
		return errForbidden()
	}
	rows, err := a.db.Query(rq.Ctx(), `select id, name, status, service_id from saved_filters
		where user_id = $1 order by created_at, id`, rq.Actor.ID)
	if err != nil {
		return fmt.Errorf("list saved filters: %w", err)
	}
	defer rows.Close()
	items := []savedFilter{}
	for rows.Next() {
		var f savedFilter
		if err := rows.Scan(&f.ID, &f.Name, &f.Status, &f.ServiceID); err != nil {
			return fmt.Errorf("scan saved filter: %w", err)
		}
		items = append(items, f)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("list saved filters: %w", err)
	}
	return rq.JSON(http.StatusOK, map[string]any{"items": items})
}

func (a *App) hCreateSavedFilter(rq *Req) error {
	if rq.Actor.IsKey() {
		return errForbidden()
	}
	var body struct {
		Name      string  `json:"name"`
		Status    string  `json:"status"`
		ServiceID *string `json:"service_id"`
	}
	if err := rq.Decode(&body); err != nil {
		return fmt.Errorf("read saved filter: %w", err)
	}
	name := strings.TrimSpace(body.Name)
	problems := map[string]string{}
	if length := utf8.RuneCountInString(name); length < 1 || length > maxFilterNameLength {
		problems["name"] = "Name must be 1 to 80 characters."
	}
	if statusFilters[body.Status] == nil {
		problems["status"] = statusFilterSentence
	}
	if body.ServiceID != nil {
		var found bool
		err := a.db.QueryRow(rq.Ctx(), `select exists (select 1 from services where id = $1)`, *body.ServiceID).Scan(&found)
		if err != nil {
			return fmt.Errorf("check service: %w", err)
		}
		if !found {
			problems["service_id"] = "Choose a service from the list."
		}
	}
	if len(problems) > 0 {
		return errFields(problems)
	}
	filter := savedFilter{ID: newID(), Name: name, Status: body.Status, ServiceID: body.ServiceID}
	err := a.Do(rq.Ctx(), func(w *Work) error {
		_, err := w.Tx.Exec(w.Ctx, `insert into saved_filters (id, user_id, name, status, service_id, created_at)
			values ($1, $2, $3, $4, $5, $6)`, filter.ID, rq.Actor.ID, filter.Name, filter.Status, filter.ServiceID, w.Now)
		if err != nil {
			return fmt.Errorf("save filter: %w", err)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("save filter: %w", err)
	}
	return rq.JSON(http.StatusCreated, filter)
}

func (a *App) hDeleteSavedFilter(rq *Req) error {
	if rq.Actor.IsKey() {
		return errForbidden()
	}
	id := rq.Param("id")
	err := a.Do(rq.Ctx(), func(w *Work) error {
		tag, err := w.Tx.Exec(w.Ctx, `delete from saved_filters where id = $1 and user_id = $2`, id, rq.Actor.ID)
		if err != nil {
			return fmt.Errorf("remove saved filter: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return errNotFound()
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("delete saved filter: %w", err)
	}
	return rq.NoContent()
}

func init() {
	routeSetups = append(routeSetups, func(a *App) {
		a.route(route{Pattern: "GET /api/me/saved-filters", Access: accAny, Handler: a.hListSavedFilters})
		a.route(route{Pattern: "POST /api/me/saved-filters", Access: accAny, Handler: a.hCreateSavedFilter})
		a.route(route{Pattern: "DELETE /api/me/saved-filters/{id}", Access: accAny, Handler: a.hDeleteSavedFilter})
	})
}
