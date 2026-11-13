package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"html/template"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	ackLifetime  = 30 * time.Minute
	ackSecretKey = "ack_secret"
)

// ackToken is what an acknowledge link is signed for: one person, one incident and one assignment, through the step whose
// mail carries it; Due is the second that mail goes out.
type ackToken struct {
	Step       string
	Person     string
	Incident   string
	Assignment int
	Due        time.Time
}

// ackSecret is the signing secret, generated on first use and kept in Postgres.
var ackSecret struct {
	sync.Mutex
	value []byte
}

func loadAckSecret(ctx context.Context, q dbq) ([]byte, error) {
	ackSecret.Lock()
	defer ackSecret.Unlock()
	if ackSecret.value != nil {
		return ackSecret.value, nil
	}
	if _, err := q.Exec(ctx, `insert into meta (key, value) values ($1, $2) on conflict do nothing`, ackSecretKey, newToken(32)); err != nil {
		return nil, fmt.Errorf("create acknowledge secret: %w", err)
	}
	var stored string
	if err := q.QueryRow(ctx, `select value from meta where key = $1`, ackSecretKey).Scan(&stored); err != nil {
		return nil, fmt.Errorf("read acknowledge secret: %w", err)
	}
	ackSecret.value = []byte(stored)
	return ackSecret.value, nil
}

func ackSignature(secret []byte, payload string) []byte {
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(payload))
	return mac.Sum(nil)
}

// signAckToken makes the link token: the payload, a dot and its signature.
func signAckToken(ctx context.Context, q dbq, t ackToken) (string, error) {
	secret, err := loadAckSecret(ctx, q)
	if err != nil {
		return "", fmt.Errorf("sign acknowledge link: %w", err)
	}
	payload := strings.Join([]string{t.Step, t.Person, t.Incident, strconv.Itoa(t.Assignment), strconv.FormatInt(t.Due.Unix(), 10)}, "|")
	encode := base64.RawURLEncoding.EncodeToString
	return encode([]byte(payload)) + "." + encode(ackSignature(secret, payload)), nil
}

// readAckToken verifies a token's signature; ok is false for anything that was not signed by this app.
func (a *App) readAckToken(ctx context.Context, token string) (t ackToken, ok bool, err error) {
	encodedPayload, encodedSignature, found := strings.Cut(token, ".")
	if !found {
		return t, false, nil
	}
	// Strict: a last character whose unused bits are set decodes to the same bytes in the lenient decoder, so a
	// changed link would still pass the signature check. Only the exact text the app signed is a valid link.
	strict := base64.RawURLEncoding.Strict()
	payload, payloadErr := strict.DecodeString(encodedPayload)
	signature, signatureErr := strict.DecodeString(encodedSignature)
	if payloadErr != nil || signatureErr != nil {
		return t, false, nil
	}
	if strict.EncodeToString(payload)+"."+strict.EncodeToString(signature) != token {
		return t, false, nil
	}
	secret, err := loadAckSecret(ctx, a.db)
	if err != nil {
		return t, false, fmt.Errorf("verify acknowledge link: %w", err)
	}
	if !hmac.Equal(signature, ackSignature(secret, string(payload))) {
		return t, false, nil
	}
	parts := strings.Split(string(payload), "|")
	if len(parts) != 5 {
		return t, false, nil
	}
	assignment, assignmentErr := strconv.Atoi(parts[3])
	due, dueErr := strconv.ParseInt(parts[4], 10, 64)
	if assignmentErr != nil || dueErr != nil {
		return t, false, nil
	}
	return ackToken{Step: parts[0], Person: parts[1], Incident: parts[2], Assignment: assignment, Due: time.Unix(due, 0).UTC()}, true, nil
}

// ackExpired is the one place the 30-minute life of a link ends: it is valid while now is before its mail's due second plus 30 minutes.
func ackExpired(now time.Time, t ackToken) bool { return instantReached(now, t.Due.Add(ackLifetime)) }

// ackPage is one of the five published pages.
type ackPage struct {
	Number   int
	Status   int
	Heading  string
	Sentence string
	Button   string
}

func invalidPage() ackPage {
	return ackPage{Status: http.StatusNotFound, Heading: "This link is not valid.", Sentence: "Ask your lead for help if you expected it to work."}
}

func usedPage(number int, name string) ackPage {
	return ackPage{Number: number, Status: http.StatusGone, Heading: "This link has already been used.",
		Sentence: fmt.Sprintf("Incident #%d was acknowledged by %s.", number, name)}
}

func outOfDatePage(number int) ackPage {
	return ackPage{Number: number, Status: http.StatusGone, Heading: "This link is out of date.",
		Sentence: fmt.Sprintf("Incident #%d has moved on. Sign in to see where it stands.", number)}
}

// judgeAck applies the published order of checks to a verified token. ok is true when the link may acknowledge, and the
// page is then the valid page.
func (a *App) judgeAck(ctx context.Context, q dbq, t ackToken, now time.Time) (page ackPage, ok bool, err error) {
	var (
		number, assignment int
		title, status      string
		holders            []string
		used               bool
	)
	err = q.QueryRow(ctx, `select i.number, i.title, i.status, i.holders, i.assignment, s.used_at is not null
		from incidents i, steps s where i.id = $1 and s.id = $2`, t.Incident, t.Step).
		Scan(&number, &title, &status, &holders, &assignment, &used)
	if isNoRows(err) {
		return invalidPage(), false, nil
	}
	if err != nil {
		return page, false, fmt.Errorf("read incident for acknowledge link: %w", err)
	}
	switch {
	case used:
		name, err := userName(ctx, q, t.Person)
		if err != nil {
			return page, false, fmt.Errorf("name link person: %w", err)
		}
		return usedPage(number, name), false, nil
	case status == "resolved":
		return outOfDatePage(number), false, nil
	case alreadyAcknowledged(status):
		var name string
		err := q.QueryRow(ctx, `select actor from timeline where incident_id = $1 and kind = 'acknowledged' order by at desc, id desc limit 1`,
			t.Incident).Scan(&name)
		if err != nil {
			return page, false, fmt.Errorf("read who acknowledged incident %s: %w", t.Incident, err)
		}
		return usedPage(number, name), false, nil
	case ackExpired(now, t) || assignment != t.Assignment || !slices.Contains(holders, t.Person):
		return outOfDatePage(number), false, nil
	}
	return ackPage{Number: number, Status: http.StatusOK, Heading: fmt.Sprintf("Acknowledge incident #%d", number), Sentence: title,
		Button: fmt.Sprintf("Acknowledge incident #%d", number)}, true, nil
}

var ackTemplate = template.Must(template.New("ack").Parse(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{.Heading}} · Switchlamp</title>
<link rel="stylesheet" href="/assets/css/app.css">
</head>
<body class="plain">
<main class="plain-band">
<h1>{{.Heading}}</h1>
<p class="sentence">{{.Sentence}}</p>
{{if .Button}}<form method="post"><button type="submit">{{.Button}}</button></form>{{end}}
</main>
</body>
</html>
`))

func (rq *Req) ackPage(page ackPage) error {
	var buf bytes.Buffer
	if err := ackTemplate.Execute(&buf, page); err != nil {
		return fmt.Errorf("render acknowledge page: %w", err)
	}
	rq.W.Header().Set("Content-Type", "text/html; charset=utf-8")
	rq.W.Header().Set("Cache-Control", "no-store")
	rq.W.WriteHeader(page.Status)
	if _, err := rq.W.Write(buf.Bytes()); err != nil {
		return fmt.Errorf("write acknowledge page: %w", err)
	}
	return nil
}

// hAckShow is GET /ack/{token}; it never changes anything.
func (a *App) hAckShow(rq *Req) error {
	token, ok, err := a.readAckToken(rq.Ctx(), rq.Param("token"))
	if err != nil {
		return fmt.Errorf("read acknowledge link: %w", err)
	}
	if !ok {
		if err := rq.ackPage(invalidPage()); err != nil {
			return fmt.Errorf("answer invalid acknowledge link: %w", err)
		}
		return nil
	}
	page, _, err := a.judgeAck(rq.Ctx(), a.db, token, a.clock.Now())
	if err != nil {
		return fmt.Errorf("check acknowledge link: %w", err)
	}
	if err := rq.ackPage(page); err != nil {
		return fmt.Errorf("answer acknowledge link: %w", err)
	}
	return nil
}

// hAckDo is POST /ack/{token}: the one POST that finds the link valid acknowledges as its person.
func (a *App) hAckDo(rq *Req) error {
	token, ok, err := a.readAckToken(rq.Ctx(), rq.Param("token"))
	if err != nil {
		return fmt.Errorf("read acknowledge link: %w", err)
	}
	if !ok {
		if err := rq.ackPage(invalidPage()); err != nil {
			return fmt.Errorf("answer invalid acknowledge link: %w", err)
		}
		return nil
	}
	var page ackPage
	err = a.Do(rq.Ctx(), func(w *Work) error {
		judged, valid, err := a.judgeAck(w.Ctx, w.Tx, token, w.Now)
		page = judged
		if err != nil {
			return fmt.Errorf("check acknowledge link: %w", err)
		}
		if !valid {
			return nil
		}
		// The link is spent by one conditional update: of two posts that both judged it valid, only the one that
		// changes the row goes on to acknowledge; the other answers the used page.
		marked, err := w.Tx.Exec(w.Ctx, `update steps set used_at = $2 where id = $1 and used_at is null`, token.Step, w.Now)
		if err != nil {
			return fmt.Errorf("mark link used: %w", err)
		}
		if marked.RowsAffected() != 1 {
			name, err := userName(w.Ctx, w.Tx, token.Person)
			if err != nil {
				return fmt.Errorf("name link person: %w", err)
			}
			page = usedPage(judged.Number, name)
			return nil
		}
		name, err := userName(w.Ctx, w.Tx, token.Person)
		if err != nil {
			return fmt.Errorf("name link person: %w", err)
		}
		if err := a.acknowledgeIncident(w, token.Incident, actorRef{ID: token.Person, Name: name}); err != nil {
			return fmt.Errorf("acknowledge from link: %w", err)
		}
		page = ackPage{Number: judged.Number, Status: http.StatusOK, Heading: "Acknowledged.",
			Sentence: fmt.Sprintf("Incident #%d is with you now.", judged.Number)}
		return nil
	})
	if err != nil {
		return fmt.Errorf("acknowledge by link: %w", err)
	}
	if err := rq.ackPage(page); err != nil {
		return fmt.Errorf("answer acknowledge link: %w", err)
	}
	return nil
}

func init() {
	routeSetups = append(routeSetups, func(a *App) {
		a.route(route{Pattern: "GET /ack/{token}", Access: accPublic, Handler: a.hAckShow})
		a.route(route{Pattern: "POST /ack/{token}", Access: accPublic, Handler: a.hAckDo})
	})
}
