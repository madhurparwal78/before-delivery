package main

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"
)

const (
	statusSubjectPrefix = "[Tarecross status] "
	emailSentence       = "Enter a valid email address."
	unsubscribedLine    = "You will get no more status updates."
)

// updateStateLabels are the update states as displayed and in mail; the API keeps the lowercase value.
var updateStateLabels = map[string]string{
	"investigating": "Investigating", "identified": "Identified", "monitoring": "Monitoring", "resolved": "Resolved",
}

var emailPattern = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)

// updateRecord is a status update as the status desk sees it; PublishedAt is null for a draft.
type updateRecord struct {
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	Body        string   `json:"body"`
	State       string   `json:"state"`
	ServiceIDs  []string `json:"service_ids"`
	PublishedAt *string  `json:"published_at"`
}

// updatePublished is the answer to a publish: the update and how many subscribers were sent it.
type updatePublished struct {
	updateRecord
	Subscribers int `json:"subscribers"`
}

type updateInput struct {
	Title      string   `json:"title"`
	Body       string   `json:"body"`
	State      string   `json:"state"`
	ServiceIDs []string `json:"service_ids"`
}

func (a *App) loadUpdate(ctx context.Context, q dbq, id string) (updateRecord, error) {
	var record updateRecord
	var publishedAt *time.Time
	err := q.QueryRow(ctx, `select id, title, body, state, service_ids, published_at from status_updates where id = $1`, id).
		Scan(&record.ID, &record.Title, &record.Body, &record.State, &record.ServiceIDs, &publishedAt)
	if err != nil {
		return updateRecord{}, fmt.Errorf("read status update %s: %w", id, err)
	}
	if publishedAt != nil {
		stamp := formatInstant(*publishedAt)
		record.PublishedAt = &stamp
	}
	return record, nil
}

// checkUpdate applies the published choices to a draft.
func checkUpdate(ctx context.Context, q dbq, in updateInput) error {
	problems := map[string]string{}
	if _, known := updateStateLabels[in.State]; !known {
		problems["state"] = outOfRange
	}
	for _, id := range in.ServiceIDs {
		var found bool
		if err := q.QueryRow(ctx, `select exists (select 1 from services where id = $1)`, id).Scan(&found); err != nil {
			return fmt.Errorf("check service %s: %w", id, err)
		}
		if !found {
			problems["service_ids"] = chooseServiceSentence
		}
	}
	if len(problems) > 0 {
		return errFields(problems)
	}
	return nil
}

func (a *App) hListUpdates(rq *Req) error {
	rows, err := a.db.Query(rq.Ctx(), `select id from status_updates order by seq desc`)
	if err != nil {
		return fmt.Errorf("list status updates: %w", err)
	}
	ids, err := collectIDs(rows)
	if err != nil {
		return fmt.Errorf("list status updates: %w", err)
	}
	items := make([]updateRecord, 0, len(ids))
	for _, id := range ids {
		record, err := a.loadUpdate(rq.Ctx(), a.db, id)
		if err != nil {
			return fmt.Errorf("load status update: %w", err)
		}
		items = append(items, record)
	}
	var queued int
	err = a.db.QueryRow(rq.Ctx(), `select count(*) from mail_outbox where kind = 'status' and sent_at is null`).Scan(&queued)
	if err != nil {
		return fmt.Errorf("count queued subscriber notices: %w", err)
	}
	return rq.JSON(http.StatusOK, map[string]any{"items": items, "queued_notices": queued})
}

func (a *App) hCreateUpdate(rq *Req) error {
	var in updateInput
	if err := rq.Decode(&in); err != nil {
		return fmt.Errorf("read status update: %w", err)
	}
	var created updateRecord
	err := a.Do(rq.Ctx(), func(w *Work) error {
		if err := checkUpdate(w.Ctx, w.Tx, in); err != nil {
			return fmt.Errorf("check status update: %w", err)
		}
		id := newID()
		_, err := w.Tx.Exec(w.Ctx, `insert into status_updates (id, title, body, state, service_ids, created_at) values ($1, $2, $3, $4, $5, $6)`,
			id, in.Title, in.Body, in.State, append([]string{}, in.ServiceIDs...), w.Now)
		if err != nil {
			return fmt.Errorf("insert status update: %w", err)
		}
		created, err = a.loadUpdate(w.Ctx, w.Tx, id)
		if err != nil {
			return fmt.Errorf("load created status update: %w", err)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("create status update: %w", err)
	}
	return rq.JSON(http.StatusCreated, created)
}

// lockDraft reads an update for change and refuses one that is already published.
func (a *App) lockDraft(w *Work, id string) error {
	var published bool
	err := w.Tx.QueryRow(w.Ctx, `select published_at is not null from status_updates where id = $1 for update`, id).Scan(&published)
	if err != nil {
		return fmt.Errorf("lock status update %s: %w", id, err)
	}
	if published {
		return errConflict("already_published")
	}
	return nil
}

func (a *App) hSaveUpdate(rq *Req) error {
	var in updateInput
	if err := rq.Decode(&in); err != nil {
		return fmt.Errorf("read status update: %w", err)
	}
	id := rq.Param("id")
	var saved updateRecord
	err := a.Do(rq.Ctx(), func(w *Work) error {
		if err := a.lockDraft(w, id); err != nil {
			return fmt.Errorf("lock draft status update: %w", err)
		}
		if err := checkUpdate(w.Ctx, w.Tx, in); err != nil {
			return fmt.Errorf("check status update: %w", err)
		}
		_, err := w.Tx.Exec(w.Ctx, `update status_updates set title = $2, body = $3, state = $4, service_ids = $5 where id = $1`,
			id, in.Title, in.Body, in.State, append([]string{}, in.ServiceIDs...))
		if err != nil {
			return fmt.Errorf("update status update %s: %w", id, err)
		}
		saved, err = a.loadUpdate(w.Ctx, w.Tx, id)
		if err != nil {
			return fmt.Errorf("load saved status update: %w", err)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("save status update: %w", err)
	}
	return rq.JSON(http.StatusOK, saved)
}

// subscriberMail is the mail one subscriber gets for a published update.
func (a *App) subscriberMail(update updateRecord, address, token string, at time.Time) outboundMail {
	body := fmt.Sprintf("State: %s\n\n%s\n\nUnsubscribe: %s/status/unsubscribe/%s\n", updateStateLabels[update.State], update.Body, a.cfg.PublicURL, token)
	return outboundMail{Kind: "status", To: address, Subject: statusSubjectPrefix + update.Title, Body: body, DueAt: at}
}

func (a *App) hPublishUpdate(rq *Req) error {
	if err := rq.Idempotent(func() error {
		id := rq.Param("id")
		var published updatePublished
		err := a.Do(rq.Ctx(), func(w *Work) error {
			if err := a.lockDraft(w, id); err != nil {
				return fmt.Errorf("lock draft status update: %w", err)
			}
			if _, err := w.Tx.Exec(w.Ctx, `update status_updates set published_at = $2 where id = $1`, id, w.Now); err != nil {
				return fmt.Errorf("publish status update %s: %w", id, err)
			}
			update, err := a.loadUpdate(w.Ctx, w.Tx, id)
			if err != nil {
				return fmt.Errorf("load status update: %w", err)
			}
			rows, err := w.Tx.Query(w.Ctx, `select email, token from subscribers where unsubscribed_at is null order by created_at, id`)
			if err != nil {
				return fmt.Errorf("read subscribers: %w", err)
			}
			defer rows.Close()
			var mails []outboundMail
			for rows.Next() {
				var address, token string
				if err := rows.Scan(&address, &token); err != nil {
					return fmt.Errorf("scan subscriber: %w", err)
				}
				mails = append(mails, a.subscriberMail(update, address, token, w.Now))
			}
			if err := rows.Err(); err != nil {
				return fmt.Errorf("read subscribers: %w", err)
			}
			for _, mail := range mails {
				if err := w.enqueueMail(mail); err != nil {
					return fmt.Errorf("queue update mail: %w", err)
				}
			}
			w.After(a.clearStatusCache)
			w.Publish("status", map[string]any{})
			published = updatePublished{updateRecord: update, Subscribers: len(mails)}
			return nil
		})
		if err != nil {
			return fmt.Errorf("publish status update: %w", err)
		}
		return rq.JSON(http.StatusOK, published)
	}); err != nil {
		return fmt.Errorf("publish status update: %w", err)
	}
	return nil
}

func (a *App) hSubscribe(rq *Req) error {
	var in struct {
		Email string `json:"email"`
	}
	if err := rq.Decode(&in); err != nil {
		return fmt.Errorf("read subscriber: %w", err)
	}
	address := strings.TrimSpace(in.Email)
	if !emailPattern.MatchString(address) {
		return errField("email", emailSentence)
	}
	_, err := a.db.Exec(rq.Ctx(), `insert into subscribers (id, email, token, created_at) values ($1, $2, $3, $4)
		on conflict (lower(email)) do update set unsubscribed_at = null`, newID(), address, newToken(16), a.clock.Now())
	if err != nil {
		return fmt.Errorf("save subscriber: %w", err)
	}
	return rq.JSON(http.StatusCreated, map[string]string{"status": "subscribed"})
}

// hUnsubscribe is the page a subscriber's mail links to.
func (a *App) hUnsubscribe(rq *Req) error {
	tag, err := a.db.Exec(rq.Ctx(), `update subscribers set unsubscribed_at = coalesce(unsubscribed_at, $2) where token = $1`,
		rq.Param("token"), a.clock.Now())
	if err != nil {
		return fmt.Errorf("unsubscribe: %w", err)
	}
	if tag.RowsAffected() == 0 {
		a.notFoundPage(rq.W, rq.R)
		return nil
	}
	a.renderPage(rq.W, "status_plain.html", map[string]any{"Title": "Unsubscribed · Switchlamp", "Sentence": unsubscribedLine})
	return nil
}

func init() {
	routeSetups = append(routeSetups, func(a *App) {
		a.route(route{Pattern: "POST /api/status/subscribers", Access: accPublic, Handler: a.hSubscribe})
		a.route(route{Pattern: "GET /status/unsubscribe/{token}", Access: accPublic, Handler: a.hUnsubscribe})
		a.route(route{Pattern: "GET /api/status-updates", Access: accLead, Handler: a.hListUpdates})
		a.route(route{Pattern: "POST /api/status-updates", Access: accLead, Handler: a.hCreateUpdate})
		a.route(route{Pattern: "PUT /api/status-updates/{id}", Access: accLead, Resource: "statusupdate", Handler: a.hSaveUpdate})
		a.route(route{Pattern: "POST /api/status-updates/{id}/publish", Access: accLead, Resource: "statusupdate", Handler: a.hPublishUpdate})
	})
}
