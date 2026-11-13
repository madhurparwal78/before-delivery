package main

import (
	"context"
	"fmt"
	"math/rand/v2"
	"net/http"
	"strings"
)

// integrationRef is an integration as the event path needs it.
type integrationRef struct {
	ID         string
	ServiceID  string
	Name       string
	RoutingKey string
}

// integrationByKey finds the integration a routing key names.
func (a *App) integrationByKey(ctx context.Context, q dbq, routingKey string) (in integrationRef, known bool, err error) {
	err = q.QueryRow(ctx, `select id, service_id, name, routing_key from integrations where routing_key = $1`, routingKey).
		Scan(&in.ID, &in.ServiceID, &in.Name, &in.RoutingKey)
	if isNoRows(err) {
		return in, false, nil
	}
	if err != nil {
		return in, false, fmt.Errorf("read integration: %w", err)
	}
	return in, true, nil
}

// register adds the routes, the queue probe and the counter countdown of the event path.
func (d *eventDesk) register() {
	a := d.a
	a.route(route{Pattern: "POST /api/events", Access: accPublic, Handler: d.hEvent})
	a.route(route{Pattern: "GET /api/integrations", Access: accStaff, Handler: d.hListIntegrations})
	a.route(route{Pattern: "POST /api/integrations", Access: accAdmin, Handler: d.hCreateIntegration})
	a.route(route{Pattern: "GET /api/integrations/{id}", Access: accStaff, Resource: "integration", Handler: d.hGetIntegration})
	a.route(route{Pattern: "GET /api/integrations/{id}/events", Access: accStaff, Resource: "integration", Handler: d.hEventLog})
	a.route(route{Pattern: "GET /api/dead-letters", Access: accStaff, Handler: d.hListDeadLetters})
	a.route(route{Pattern: "POST /api/dead-letters/{id}/replay", Access: accLead, Resource: "deadletter", Handler: d.hReplay})
	systemProbes["queue"] = func(*App) any {
		if d.q.Up() {
			return "ok"
		}
		return "down"
	}
	a.hub.RegisterCountdown("integration", d.countdown)
}

// countdown is what an open integration page receives every second.
func (d *eventDesk) countdown(ctx context.Context, id string) (any, error) {
	var routingKey string
	if err := d.a.db.QueryRow(ctx, `select routing_key from integrations where id = $1`, id).Scan(&routingKey); err != nil {
		return nil, fmt.Errorf("read integration %s: %w", id, err)
	}
	return d.counter(ctx, routingKey), nil
}

// integrationView is an integration in the list and on its page.
type integrationView struct {
	ID          string       `json:"id"`
	ServiceID   string       `json:"service_id"`
	ServiceName string       `json:"service_name"`
	Name        string       `json:"name"`
	RoutingKey  string       `json:"routing_key"`
	Counter     *rateCounter `json:"counter"`
}

const integrationSelect = `select i.id, i.service_id, s.name, i.name, i.routing_key
	from integrations i join services s on s.id = i.service_id`

func (d *eventDesk) hListIntegrations(rq *Req) error {
	ctx := rq.Ctx()
	rows, err := d.a.db.Query(ctx, integrationSelect+` order by i.created_at, i.name, i.id`)
	if err != nil {
		return fmt.Errorf("list integrations: %w", err)
	}
	defer rows.Close()
	items := []integrationView{}
	for rows.Next() {
		var v integrationView
		if err := rows.Scan(&v.ID, &v.ServiceID, &v.ServiceName, &v.Name, &v.RoutingKey); err != nil {
			return fmt.Errorf("scan integration: %w", err)
		}
		items = append(items, v)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("list integrations: %w", err)
	}
	rows.Close()
	for i := range items {
		counter := d.counter(ctx, items[i].RoutingKey)
		items[i].Counter = &counter
	}
	return rq.JSON(http.StatusOK, map[string]any{"items": items})
}

func (d *eventDesk) hGetIntegration(rq *Req) error {
	ctx := rq.Ctx()
	var v integrationView
	err := d.a.db.QueryRow(ctx, integrationSelect+` where i.id = $1`, rq.Param("id")).
		Scan(&v.ID, &v.ServiceID, &v.ServiceName, &v.Name, &v.RoutingKey)
	if err != nil {
		return fmt.Errorf("read integration %s: %w", rq.Param("id"), err)
	}
	counter := d.counter(ctx, v.RoutingKey)
	v.Counter = &counter
	return rq.JSON(http.StatusOK, v)
}

const (
	nameRequiredSentence = "Name is required."
	routingKeySlugLength = 24
	routingKeyNumbers    = 10000
)

// createdIntegration is the answer to POST /api/integrations.
type createdIntegration struct {
	ID         string `json:"id"`
	ServiceID  string `json:"service_id"`
	Name       string `json:"name"`
	RoutingKey string `json:"routing_key"`
}

func (d *eventDesk) hCreateIntegration(rq *Req) error {
	top := object(rq.Body)
	serviceID, name := text(top["service_id"]), strings.TrimSpace(text(top["name"]))
	created := createdIntegration{ID: newID(), ServiceID: serviceID, Name: name}
	err := d.a.Do(rq.Ctx(), func(w *Work) error {
		problems := map[string]string{}
		var serviceExists bool
		if err := w.Tx.QueryRow(w.Ctx, `select exists (select 1 from services where id = $1)`, serviceID).Scan(&serviceExists); err != nil {
			return fmt.Errorf("check service %s: %w", serviceID, err)
		}
		if !serviceExists {
			problems["service_id"] = "Choose a service."
		}
		slug := routingKeySlug(name)
		if slug == "" {
			problems["name"] = nameRequiredSentence
		}
		if len(problems) > 0 {
			return errFields(problems)
		}
		routingKey, err := freeRoutingKey(w, slug)
		if err != nil {
			return fmt.Errorf("name integration %s: %w", name, err)
		}
		created.RoutingKey = routingKey
		_, err = w.Tx.Exec(w.Ctx, `insert into integrations (id, service_id, name, routing_key, created_at) values ($1, $2, $3, $4, $5)`,
			created.ID, serviceID, name, routingKey, w.Now)
		if err != nil {
			return fmt.Errorf("create integration: %w", err)
		}
		w.Publish("integration", map[string]string{"integration_id": created.ID})
		return nil
	})
	if err != nil {
		return fmt.Errorf("create integration %s: %w", name, err)
	}
	return rq.JSON(http.StatusCreated, created)
}

// routingKeySlug is the first word of a name in lowercase letters and digits.
func routingKeySlug(name string) string {
	words := strings.FieldsFunc(strings.ToLower(name), func(r rune) bool {
		return (r < 'a' || r > 'z') && (r < '0' || r > '9')
	})
	if len(words) == 0 {
		return ""
	}
	return words[0][:min(len(words[0]), routingKeySlugLength)]
}

// freeRoutingKey draws rk_<slug>_<4 digits> until one is unused.
func freeRoutingKey(w *Work, slug string) (string, error) {
	first := rand.IntN(routingKeyNumbers)
	for i := 0; i < routingKeyNumbers; i++ {
		candidate := fmt.Sprintf("rk_%s_%04d", slug, (first+i)%routingKeyNumbers)
		var taken bool
		if err := w.Tx.QueryRow(w.Ctx, `select exists (select 1 from integrations where routing_key = $1)`, candidate).Scan(&taken); err != nil {
			return "", fmt.Errorf("check routing key %s: %w", candidate, err)
		}
		if !taken {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("every routing key for %q is taken", slug)
}
