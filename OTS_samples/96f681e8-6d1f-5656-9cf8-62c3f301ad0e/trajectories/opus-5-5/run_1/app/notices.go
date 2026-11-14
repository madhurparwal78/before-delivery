package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log"
	"mime"
	"mime/quotedprintable"
	"net"
	"net/http"
	"net/smtp"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const deskTopic = "yardline-desk"

type noticeSpec struct {
	Event     string
	Channel   string
	Recipient string
	Address   string
	Subject   string
	Body      string
}

// txn is a short transaction that queues its notices just before it commits.
type txn struct {
	pgx.Tx
	notices []noticeSpec
}

func (t *txn) notify(n ...noticeSpec) { t.notices = append(t.notices, n...) }

func (a *app) tx(ctx context.Context, fn func(*txn) error) error {
	return pgx.BeginFunc(ctx, a.db, func(tx pgx.Tx) error {
		t := &txn{Tx: tx}
		if err := fn(t); err != nil {
			return err
		}
		return flushNotices(ctx, t)
	})
}

// flushNotices writes one outbox row per notice. Recipients are locked in a
// fixed order so rows of one recipient and channel are created in commit order.
func flushNotices(ctx context.Context, t *txn) error {
	if len(t.notices) == 0 {
		return nil
	}
	keys := map[string]bool{}
	for _, n := range t.notices {
		keys[n.Channel+":"+n.Recipient] = true
	}
	ordered := make([]string, 0, len(keys))
	for k := range keys {
		ordered = append(ordered, k)
	}
	sort.Strings(ordered)
	for _, k := range ordered {
		if _, err := t.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, "notice:"+k); err != nil {
			return fmt.Errorf("lock notice queue: %w", err)
		}
	}
	for _, n := range t.notices {
		if _, err := t.Exec(ctx, `INSERT INTO notice (event, channel, recipient, address, subject, body, next_attempt_at)
			VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN EXISTS (SELECT 1 FROM notice o WHERE o.channel = $2
				AND o.recipient = $3 AND o.status = 'pending') THEN NULL ELSE now() END)`,
			n.Event, n.Channel, n.Recipient, n.Address, n.Subject, n.Body); err != nil {
			return fmt.Errorf("queue notice: %w", err)
		}
	}
	t.notices = nil
	return nil
}

type recipient struct {
	Username string
	Name     string
	Email    string
	Topic    *string
}

func recipientOf(ctx context.Context, q querier, username string) (recipient, error) {
	r := recipient{Username: username}
	if err := q.QueryRow(ctx, `SELECT name, email, push_topic FROM app_user WHERE username = $1`, username).
		Scan(&r.Name, &r.Email, &r.Topic); err != nil {
		return r, fmt.Errorf("read recipient %s: %w", username, err)
	}
	return r, nil
}

// slotRef names the slot a notice is about.
type slotRef struct {
	Court int
	Start time.Time
}

func (a *app) emailTo(r recipient, event, subject, body string) noticeSpec {
	return noticeSpec{Event: event, Channel: "email", Recipient: r.Email, Address: r.Email, Subject: subject, Body: body}
}

func (a *app) pushTo(r recipient, event, title, message string) []noticeSpec {
	if r.Topic == nil {
		return nil
	}
	return []noticeSpec{{Event: event, Channel: "push", Recipient: r.Username, Address: *r.Topic, Subject: title, Body: message}}
}

func (a *app) both(r recipient, event, subject, body, title, message string) []noticeSpec {
	return append([]noticeSpec{a.emailTo(r, event, subject, body)}, a.pushTo(r, event, title, message)...)
}

const creditLine = " is now in your Yardline credits."

func (a *app) heldNotices(r recipient, s slotRef, expiresAt time.Time) []noticeSpec {
	label := a.cfg.slotLabel(s.Court, s.Start)
	return a.both(r, "held", "Slot held: "+label,
		fmt.Sprintf("Hi %s,\n\nYou are holding %s until %s club time. Pay before then to keep it.\n", r.Name, label, a.cfg.clubDateTime(expiresAt)),
		"Slot held", label)
}

func (a *app) paidNotices(r recipient, s slotRef, amount int) []noticeSpec {
	label := a.cfg.slotLabel(s.Court, s.Start)
	return a.both(r, "paid", "Payment received: "+label,
		fmt.Sprintf("Hi %s,\n\nWe received %s for %s.\n", r.Name, euros(amount), label),
		"Payment received", label)
}

func (a *app) shareNotice(r recipient, s slotRef, amount int, organiserName string, settleAt time.Time, token string) noticeSpec {
	label := a.cfg.slotLabel(s.Court, s.Start)
	return a.emailTo(r, "share", fmt.Sprintf("Your share: %s for %s", euros(amount), label),
		fmt.Sprintf("Hi %s,\n\n%s booked %s and split it four ways. Your share is %s.\n\nPay it here before %s club time, when unpaid shares go on the organiser's card:\n%s\n",
			r.Name, organiserName, label, euros(amount), a.cfg.clubDateTime(settleAt), a.shareLink(token)))
}

func (a *app) lessonShareNotice(r recipient, s slotRef, amount int, coachName, token string) noticeSpec {
	label := a.cfg.slotLabel(s.Court, s.Start)
	return a.emailTo(r, "lesson share", fmt.Sprintf("Lesson share: %s for %s", euros(amount), label),
		fmt.Sprintf("Hi %s,\n\nCoach %s booked a lesson on %s. Your share is %s.\n\nPay it here:\n%s\n",
			r.Name, coachName, label, euros(amount), a.shareLink(token)))
}

func (a *app) shareLink(token string) string { return a.cfg.PublicURL + "/share/" + token }

func (a *app) releasedNotices(r recipient, s slotRef) []noticeSpec {
	label := a.cfg.slotLabel(s.Court, s.Start)
	return a.both(r, "released", "Hold released: "+label,
		fmt.Sprintf("Hi %s,\n\nYour hold on %s has ended and the court is free again.\n", r.Name, label),
		"Hold released", label)
}

func (a *app) joinedNotices(r recipient, s slotRef) []noticeSpec {
	label := a.cfg.slotLabel(s.Court, s.Start)
	return a.both(r, "joined", "You joined: "+label,
		fmt.Sprintf("Hi %s,\n\nYou have a place in the open match on %s.\n", r.Name, label),
		"You joined", label)
}

func (a *app) fullNotices(r recipient, s slotRef) []noticeSpec {
	label := a.cfg.slotLabel(s.Court, s.Start)
	return a.both(r, "full", "Match full: "+label,
		fmt.Sprintf("Hi %s,\n\nThe open match on %s now has four players. See you on court.\n", r.Name, label),
		"Match full", label)
}

func (a *app) deskFullNotice(s slotRef) noticeSpec {
	return noticeSpec{Event: "full", Channel: "push", Recipient: "desk", Address: deskTopic, Subject: "Match full",
		Body: a.cfg.slotLabel(s.Court, s.Start) + " is full. Release it for check-in."}
}

func (a *app) creditNotices(r recipient, s slotRef, event, subjectPrefix, title string, credit int) []noticeSpec {
	label := a.cfg.slotLabel(s.Court, s.Start)
	return a.both(r, event, subjectPrefix+label,
		fmt.Sprintf("Hi %s,\n\n%s\n\n%s%s\n", r.Name, label, euros(credit), creditLine),
		title, label+". Credit added to your Yardline account.")
}

func (a *app) cancelledNotices(r recipient, s slotRef, credit int) []noticeSpec {
	return a.creditNotices(r, s, "cancelled", "Match cancelled: ", "Match cancelled", credit)
}

func (a *app) refundedNotices(r recipient, s slotRef, credit int) []noticeSpec {
	return a.creditNotices(r, s, "refunded", "Booking cancelled: ", "Booking cancelled", credit)
}

func (a *app) creditedNotices(r recipient, s slotRef, credit int) []noticeSpec {
	return a.creditNotices(r, s, "credited", "Credit added: ", "Credit added", credit)
}

func (a *app) coveredNotices(r recipient, s slotRef, amount, count int) []noticeSpec {
	label := a.cfg.slotLabel(s.Court, s.Start)
	return a.both(r, "covered", "Shares covered: "+label,
		fmt.Sprintf("Hi %s,\n\n%s for %d unpaid shares was charged to your card.\n\nThe booking is %s.\n", r.Name, euros(amount), count, label),
		"Shares covered", label+". Unpaid shares were charged to your card.")
}

// noticeSender delivers outbox rows of one channel, oldest first per recipient.
type noticeSender struct {
	a       *app
	channel string
	http    *http.Client
}

type claimedNotice struct {
	ID        int64
	Recipient string
	Address   string
	Subject   string
	Body      string
	Attempts  int
}

func (s *noticeSender) run(ctx context.Context) {
	if _, err := s.a.db.Exec(ctx, `UPDATE notice SET in_flight = false WHERE in_flight AND channel = $1`, s.channel); err != nil {
		log.Printf("notice recovery: %v", err)
	}
	for {
		sent, err := s.sendDue(ctx)
		if err != nil {
			log.Printf("notices %s: %v", s.channel, err)
		}
		if sent == 0 && !sleepCtx(ctx, 500*time.Millisecond) {
			return
		}
	}
}

func (s *noticeSender) sendDue(ctx context.Context) (int, error) {
	n, ok, err := s.claim(ctx)
	if err != nil || !ok {
		return 0, err
	}
	var sendErr error
	if s.channel == "email" {
		sendErr = s.a.sendEmail(n)
	} else {
		sendErr = s.a.sendPush(ctx, s.http, n)
	}
	if sendErr != nil {
		log.Printf("notice %d attempt %d: %v", n.ID, n.Attempts, sendErr)
	}
	for {
		err := s.finish(ctx, n, sendErr == nil)
		if err == nil {
			return 1, nil
		}
		log.Printf("record notice %d: %v", n.ID, err)
		if !sleepCtx(ctx, time.Second) {
			return 0, ctx.Err()
		}
	}
}

// claim takes one due row under a skip-locked row lock and records the attempt before sending.
func (s *noticeSender) claim(ctx context.Context) (claimedNotice, bool, error) {
	var n claimedNotice
	err := s.a.db.QueryRow(ctx, `UPDATE notice SET attempts = attempts + 1, in_flight = true
		WHERE id = (SELECT n.id FROM notice n WHERE n.channel = $1 AND n.status = 'pending' AND NOT n.in_flight
			AND n.next_attempt_at <= now()
			AND NOT EXISTS (SELECT 1 FROM notice o WHERE o.channel = n.channel AND o.recipient = n.recipient
				AND o.status = 'pending' AND o.id < n.id)
			ORDER BY n.next_attempt_at, n.id LIMIT 1 FOR UPDATE SKIP LOCKED)
		RETURNING id, recipient, address, subject, body, attempts`, s.channel).
		Scan(&n.ID, &n.Recipient, &n.Address, &n.Subject, &n.Body, &n.Attempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return n, false, nil
	}
	if err != nil {
		return n, false, fmt.Errorf("claim notice: %w", err)
	}
	return n, true, nil
}

func (s *noticeSender) finish(ctx context.Context, n claimedNotice, delivered bool) error {
	retries := s.a.cfg.NoticeRetryDelay
	return pgx.BeginFunc(ctx, s.a.db, func(tx pgx.Tx) error {
		var status string
		switch {
		case delivered:
			status = "sent"
			_, err := tx.Exec(ctx, `UPDATE notice SET status = 'sent', in_flight = false, next_attempt_at = NULL WHERE id = $1`, n.ID)
			if err != nil {
				return fmt.Errorf("mark sent: %w", err)
			}
		case n.Attempts > len(retries):
			status = "failed"
			_, err := tx.Exec(ctx, `UPDATE notice SET status = 'failed', in_flight = false, next_attempt_at = NULL WHERE id = $1`, n.ID)
			if err != nil {
				return fmt.Errorf("mark failed: %w", err)
			}
		default:
			_, err := tx.Exec(ctx, `UPDATE notice SET in_flight = false, next_attempt_at = now() + make_interval(secs => $2)
				WHERE id = $1`, n.ID, retries[n.Attempts-1])
			if err != nil {
				return fmt.Errorf("schedule retry: %w", err)
			}
		}
		if status == "" {
			return nil
		}
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, "notice:"+s.channel+":"+n.Recipient); err != nil {
			return fmt.Errorf("lock notice queue: %w", err)
		}
		_, err := tx.Exec(ctx, `UPDATE notice SET next_attempt_at = now() WHERE id = (SELECT id FROM notice
			WHERE channel = $1 AND recipient = $2 AND status = 'pending' ORDER BY id LIMIT 1) AND next_attempt_at IS NULL`,
			s.channel, n.Recipient)
		if err != nil {
			return fmt.Errorf("promote next notice: %w", err)
		}
		return nil
	})
}

func (a *app) sendEmail(n claimedNotice) error {
	var body bytes.Buffer
	qp := quotedprintable.NewWriter(&body)
	if _, err := qp.Write([]byte(strings.ReplaceAll(n.Body, "\n", "\r\n"))); err != nil {
		return fmt.Errorf("encode body: %w", err)
	}
	if err := qp.Close(); err != nil {
		return fmt.Errorf("encode body: %w", err)
	}
	from := a.cfg.MailFrom
	var msg bytes.Buffer
	fmt.Fprintf(&msg, "From: %s\r\n", from.String())
	fmt.Fprintf(&msg, "To: <%s>\r\n", n.Address)
	fmt.Fprintf(&msg, "Subject: %s\r\n", mime.QEncoding.Encode("utf-8", n.Subject))
	fmt.Fprintf(&msg, "Date: %s\r\n", time.Now().UTC().Format(time.RFC1123Z))
	fmt.Fprintf(&msg, "Message-ID: <notice-%d-%s@marloweyard.test>\r\n", n.ID, randomString(8))
	msg.WriteString("MIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n")
	msg.Write(body.Bytes())
	return sendSMTP(net.JoinHostPort(a.cfg.SMTPHost, a.cfg.SMTPPort), from.Address, n.Address, msg.Bytes())
}

func sendSMTP(addr, from, to string, msg []byte) error {
	conn, err := net.DialTimeout("tcp", addr, 5*time.Second)
	if err != nil {
		return fmt.Errorf("dial smtp: %w", err)
	}
	if err := conn.SetDeadline(time.Now().Add(15 * time.Second)); err != nil {
		conn.Close()
		return fmt.Errorf("smtp deadline: %w", err)
	}
	host, _, _ := net.SplitHostPort(addr)
	c, err := smtp.NewClient(conn, host)
	if err != nil {
		conn.Close()
		return fmt.Errorf("smtp hello: %w", err)
	}
	defer c.Close()
	if err := c.Mail(from); err != nil {
		return fmt.Errorf("smtp from: %w", err)
	}
	if err := c.Rcpt(to); err != nil {
		return fmt.Errorf("smtp rcpt: %w", err)
	}
	w, err := c.Data()
	if err != nil {
		return fmt.Errorf("smtp data: %w", err)
	}
	if _, err := w.Write(msg); err != nil {
		return fmt.Errorf("smtp write: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("smtp accept: %w", err)
	}
	// The server has accepted the message; a failed QUIT must not cause a resend.
	_ = c.Quit()
	return nil
}

func (a *app) sendPush(ctx context.Context, client *http.Client, n claimedNotice) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.cfg.NtfyURL+"/"+n.Address, strings.NewReader(n.Body))
	if err != nil {
		return fmt.Errorf("build push: %w", err)
	}
	req.Header.Set("Title", n.Subject)
	if a.cfg.NtfyUsername != "" {
		req.SetBasicAuth(a.cfg.NtfyUsername, a.cfg.NtfyPassword)
	}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("publish push: %w", err)
	}
	resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("ntfy answered %d", resp.StatusCode)
	}
	return nil
}
