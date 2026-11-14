package main

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Notice events.
const (
	eventHeld        = "held"
	eventPaid        = "paid"
	eventShare       = "share"
	eventLessonShare = "lesson share"
	eventReleased    = "released"
	eventJoined      = "joined"
	eventFull        = "full"
	eventCancelled   = "cancelled"
	eventRefunded    = "refunded"
	eventCovered     = "covered"
	eventCredited    = "credited"

	channelEmail = "email"
	channelPush  = "push"
	deskTopic    = "yardline-desk"
	// deskRecipient names the desk's topic in the notice list, which never shows a topic name.
	deskRecipient = "desk"
	// playerTopicPrefix starts every player's private topic; 24 random characters from a to z and 0 to 9 follow.
	playerTopicPrefix = "yardline-p-"

	maxAttempts = 5
	// noticeLease keeps other senders away from a claimed notice while its send is in flight.
	noticeLease = 60 * time.Second
)

// newPushTopic makes a player's private, unguessable ntfy topic. It is made once per player and stored.
func newPushTopic() string { return playerTopicPrefix + strings.ToLower(rand.Text())[:24] }

// notice is one message to one recipient on one channel; a push keeps its title in subject and its message in body.
// The recipient is the account email for email, the username for a player push and "desk" for the desk's topic.
type notice struct {
	event, channel, recipient, subject, body string
}

// creditLine is the sentence every credit email carries.
func creditLine(cents int) string { return euros(cents) + " is now in your Yardline credits." }

func emailAndPush(event string, p person, emailSubject, emailBody, pushTitle, pushMessage string) []notice {
	return []notice{
		{event, channelEmail, p.Email, emailSubject, emailBody},
		{event, channelPush, p.Username, pushTitle, pushMessage},
	}
}

func (a *App) heldNotices(p person, slot slotRef, expires time.Time) []notice {
	label := a.clock.slotLabel(slot.court, slot.start)
	return emailAndPush(eventHeld, p, "Slot held: "+label,
		fmt.Sprintf("Hello %s,\n\n%s is held for you until %s (club time). Pay before then to keep it.\n", p.Name, label, a.clock.clubHM(expires)),
		"Slot held", label)
}

func (a *App) paidNotices(p person, slot slotRef, amount int) []notice {
	label := a.clock.slotLabel(slot.court, slot.start)
	return emailAndPush(eventPaid, p, "Payment received: "+label,
		fmt.Sprintf("Hello %s,\n\nWe received %s for %s.\n", p.Name, euros(amount), label), "Payment received", label)
}

func (a *App) shareLink(token string) string { return a.cfg.PublicURL + "/share/" + token }

// shareNotice names only the reader's own amount, the slot, the organiser's name and the reader's own link.
func (a *App) shareNotice(p person, organiserName string, slot slotRef, amount int, settleAt time.Time, token string) notice {
	label := a.clock.slotLabel(slot.court, slot.start)
	return notice{eventShare, channelEmail, p.Email, fmt.Sprintf("Your share: %s for %s", euros(amount), label),
		fmt.Sprintf("Hello %s,\n\n%s booked %s and split it four ways. Your share is %s.\nPay it before %s %s (club time) at:\n%s\n\nAfter that the organiser's card covers it.\n",
			p.Name, organiserName, label, euros(amount), a.clock.clubDay(settleAt), a.clock.clubHM(settleAt), a.shareLink(token))}
}

func (a *App) lessonShareNotice(p person, slot slotRef, amount int, coachName, token string) notice {
	label := a.clock.slotLabel(slot.court, slot.start)
	return notice{eventLessonShare, channelEmail, p.Email, fmt.Sprintf("Lesson share: %s for %s", euros(amount), label),
		fmt.Sprintf("Hello %s,\n\n%s has booked %s for you. Your share is %s. Pay it at:\n%s\n", p.Name, coachName, label, euros(amount), a.shareLink(token))}
}

func (a *App) releasedNotices(p person, slot slotRef) []notice {
	label := a.clock.slotLabel(slot.court, slot.start)
	return emailAndPush(eventReleased, p, "Hold released: "+label,
		fmt.Sprintf("Hello %s,\n\nYour hold on %s has been released.\n", p.Name, label), "Hold released", label)
}

func (a *App) joinedNotices(p person, slot slotRef) []notice {
	label := a.clock.slotLabel(slot.court, slot.start)
	return emailAndPush(eventJoined, p, "You joined: "+label,
		fmt.Sprintf("Hello %s,\n\nYou are in the open match on %s.\n", p.Name, label), "You joined", label)
}

func (a *App) fullNotices(p person, slot slotRef) []notice {
	label := a.clock.slotLabel(slot.court, slot.start)
	return emailAndPush(eventFull, p, "Match full: "+label,
		fmt.Sprintf("Hello %s,\n\nThe match on %s has four players. See you on court.\n", p.Name, label), "Match full", label)
}

// deskFullNotice tells the desk a match is full so it can release the court for check-in.
func (a *App) deskFullNotice(slot slotRef) notice {
	return notice{eventFull, channelPush, deskRecipient, "Match full",
		a.clock.slotLabel(slot.court, slot.start) + " is full. Release it for check-in."}
}

// creditSubjects are the email subject prefix and push title of each notice that reports a credit.
var creditSubjects = map[string]struct{ email, push string }{
	eventCancelled: {"Match cancelled: ", "Match cancelled"},
	eventRefunded:  {"Booking cancelled: ", "Booking cancelled"},
	eventCredited:  {"Credit added: ", "Credit added"},
}

// creditNotices tells a payer about a credit: a cancelled match, a cancelled booking, or a late capture. The email
// names the credit; the push, readable by anyone holding the topic, carries no money.
func (a *App) creditNotices(event string, p person, slot slotRef, credit int) []notice {
	label := a.clock.slotLabel(slot.court, slot.start)
	subject := creditSubjects[event]
	return emailAndPush(event, p, subject.email+label,
		fmt.Sprintf("Hello %s,\n\n%s\n", p.Name, creditLine(credit)), subject.push, label+". Credit added to your Yardline account.")
}

func (a *App) coveredNotices(p person, slot slotRef, amount, count int) []notice {
	label := a.clock.slotLabel(slot.court, slot.start)
	return emailAndPush(eventCovered, p, "Shares covered: "+label,
		fmt.Sprintf("Hello %s,\n\n%s for %d unpaid shares was charged to your card.\n", p.Name, euros(amount), count),
		"Shares covered", label+". Unpaid shares were charged to your card.")
}

// queueNotices writes the notices in the transaction of the change that causes them, each with the address it goes
// to: the email address, the desk's topic, or the player's own private topic.
func (a *App) queueNotices(ctx context.Context, q querier, notices []notice) error {
	for _, n := range notices {
		address, err := noticeAddress(ctx, q, n)
		if err != nil {
			return err
		}
		if _, err := q.Exec(ctx, "INSERT INTO notices (event, channel, recipient, address, subject, body) VALUES ($1, $2, $3, $4, $5, $6)",
			n.event, n.channel, n.recipient, address, n.subject, n.body); err != nil {
			return fmt.Errorf("queue %s %s notice: %w", n.event, n.channel, err)
		}
	}
	return nil
}

func noticeAddress(ctx context.Context, q querier, n notice) (string, error) {
	switch {
	case n.channel == channelEmail:
		return n.recipient, nil
	case n.recipient == deskRecipient:
		return deskTopic, nil
	}
	var topic *string
	if err := q.QueryRow(ctx, "SELECT push_topic FROM people WHERE username = $1", n.recipient).Scan(&topic); err != nil {
		return "", fmt.Errorf("push topic of %s: %w", n.recipient, err)
	}
	if topic != nil {
		return *topic, nil
	}
	// A player recorded before topics existed gets theirs now, once.
	var made string
	err := q.QueryRow(ctx, "UPDATE people SET push_topic = COALESCE(push_topic, $2) WHERE username = $1 RETURNING push_topic",
		n.recipient, newPushTopic()).Scan(&made)
	if err != nil {
		return "", fmt.Errorf("make push topic of %s: %w", n.recipient, err)
	}
	return made, nil
}

// ---- the one sending path ----

type claimedNotice struct {
	id       int64
	attempts int
	address  string
	notice
}

// waitingSQL is the one rule of notice order: a pending notice waits while an older notice of the same recipient
// and channel is still pending.
func waitingSQL(n string) string {
	return fmt.Sprintf(`EXISTS (SELECT 1 FROM notices older WHERE older.recipient = %[1]s.recipient AND older.channel = %[1]s.channel
		AND older.status = '%[2]s' AND older.id < %[1]s.id)`, n, noticePending)
}

// claimNextNotice records an attempt on the next due notice, then lets go of the row; other senders skip it
// while the lease runs. A notice is due only once every older notice of its recipient and channel is sent or
// failed. It reports false when none is due.
func (a *App) claimNextNotice(ctx context.Context) (claimedNotice, bool, error) {
	var c claimedNotice
	err := a.pool.QueryRow(ctx, `UPDATE notices SET attempts = attempts + 1, next_attempt_at = clock_timestamp() + $1::interval
		WHERE id = (SELECT n.id FROM notices n WHERE n.status = $2 AND n.next_attempt_at <= clock_timestamp() AND NOT `+waitingSQL("n")+`
			ORDER BY n.next_attempt_at, n.id LIMIT 1 FOR UPDATE SKIP LOCKED)
		RETURNING id, attempts, event, channel, recipient, address, subject, body`,
		fmt.Sprintf("%d seconds", int(noticeLease.Seconds())), noticePending).
		Scan(&c.id, &c.attempts, &c.event, &c.channel, &c.recipient, &c.address, &c.subject, &c.body)
	if errors.Is(err, pgx.ErrNoRows) {
		return claimedNotice{}, false, nil
	}
	if err != nil {
		return claimedNotice{}, false, fmt.Errorf("claim notice: %w", err)
	}
	return c, true, nil
}

// deliverNextNotice sends the next due notice. A notice counts as sent only once Mailpit accepts the email or
// ntfy answers 2xx; a failed attempt is retried after the published delay and the fifth failure ends it.
func (a *App) deliverNextNotice(ctx context.Context) (bool, error) {
	c, found, err := a.claimNextNotice(ctx)
	if err != nil || !found {
		return false, err
	}
	var sendErr error
	switch c.channel {
	case channelEmail:
		sendErr = a.sendEmail(ctx, c.address, c.subject, c.body)
	default:
		sendErr = a.sendPush(ctx, c.address, c.subject, c.body)
	}
	if sendErr == nil {
		return true, a.recordNotice(ctx, c.id, noticeSent, nil)
	}
	if c.attempts >= maxAttempts {
		return true, a.recordNotice(ctx, c.id, noticeFailed, nil)
	}
	delay := a.cfg.Timing.NoticeRetry[min(c.attempts-1, len(a.cfg.Timing.NoticeRetry)-1)]
	return true, a.recordNotice(ctx, c.id, noticePending, &delay)
}

func (a *App) recordNotice(ctx context.Context, id int64, status string, retryAfter *time.Duration) error {
	var lastErr error
	for attempt := 0; attempt < 5; attempt++ {
		_, lastErr = a.pool.Exec(ctx, `UPDATE notices SET status = $2,
			next_attempt_at = CASE WHEN $3::bigint IS NULL THEN next_attempt_at ELSE clock_timestamp() + ($3::bigint * interval '1 millisecond') END
			WHERE id = $1 AND status = $4`, id, status, millisPointer(retryAfter), noticePending)
		if lastErr == nil {
			return nil
		}
		sleepOrDone(ctx, 200*time.Millisecond)
	}
	return fmt.Errorf("record notice %d as %s: %w", id, status, lastErr)
}

func millisPointer(d *time.Duration) *int64 {
	if d == nil {
		return nil
	}
	millis := d.Milliseconds()
	return &millis
}

// ---- desk list ----

const msgNoticeStatus = "Use pending, sent or failed."

type noticeCursor struct {
	At time.Time `json:"a"`
	ID int64     `json:"i"`
}

// NoticeView is a notice row in the desk's list.
type NoticeView struct {
	ID            int64   `json:"id"`
	Event         string  `json:"event"`
	Channel       string  `json:"channel"`
	Recipient     string  `json:"recipient"`
	Status        string  `json:"status"`
	Attempts      int     `json:"attempts"`
	NextAttemptAt *string `json:"next_attempt_at"`
	CreatedAt     string  `json:"created_at"`
}

func (a *App) getDeskNotices(ctx context.Context, rq *request) (result, error) {
	page, err := parsePage(rq.r.URL.Query())
	if err != nil {
		return result{}, err
	}
	status := rq.r.URL.Query().Get("status")
	if status != "" && status != noticePending && status != noticeSent && status != noticeFailed {
		return result{}, failValidation(map[string]string{"status": msgNoticeStatus})
	}
	var after noticeCursor
	query := `SELECT n.id, n.event, n.channel, n.recipient, n.status, n.attempts, n.next_attempt_at, n.created_at,
		n.status = '` + noticePending + `' AND ` + waitingSQL("n") + ` FROM notices n WHERE ($1 = '' OR n.status = $1)`
	args := []any{status}
	if page.cursor != "" {
		if err := decodeCursor(page.cursor, &after); err != nil {
			return result{}, err
		}
		query += " AND (n.created_at, n.id) < ($2, $3)"
		args = append(args, after.At, after.ID)
	}
	args = append(args, page.limit+1)
	rows, err := a.pool.Query(ctx, query+fmt.Sprintf(" ORDER BY n.created_at DESC, n.id DESC LIMIT $%d", len(args)), args...)
	if err != nil {
		return result{}, fmt.Errorf("list notices: %w", err)
	}
	defer rows.Close()
	items := []NoticeView{}
	var times []time.Time
	for rows.Next() {
		var n NoticeView
		var next, createdAt time.Time
		var waiting bool
		if err := rows.Scan(&n.ID, &n.Event, &n.Channel, &n.Recipient, &n.Status, &n.Attempts, &next, &createdAt, &waiting); err != nil {
			return result{}, fmt.Errorf("read notice: %w", err)
		}
		if n.Status == noticePending && !waiting {
			text := formatUTC(next)
			n.NextAttemptAt = &text
		}
		n.CreatedAt = formatUTC(createdAt)
		items = append(items, n)
		times = append(times, createdAt)
	}
	if err := rows.Err(); err != nil {
		return result{}, fmt.Errorf("list notices: %w", err)
	}
	var next *string
	if len(items) > page.limit {
		items, times = items[:page.limit], times[:page.limit]
		last := items[len(items)-1]
		token, err := encodeCursor(noticeCursor{times[len(times)-1], last.ID})
		if err != nil {
			return result{}, err
		}
		next = &token
	}
	return ok(map[string]any{"items": items, "next_cursor": next}), nil
}
