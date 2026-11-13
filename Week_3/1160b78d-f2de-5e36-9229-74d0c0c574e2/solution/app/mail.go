package main

import (
	"context"
	"fmt"
	"log"
	"mime"
	"net"
	"net/mail"
	"net/smtp"
	"strings"
	"sync/atomic"
	"time"
)

const (
	mailPoll      = 250 * time.Millisecond
	mailRetry     = 5 * time.Second
	mailProbeEach = 5 * time.Second
	mailTimeout   = 10 * time.Second
)

// mailer is the outbound mail worker's shared state: whether the mail server answered on the last try.
var mailer mailWorker

type mailWorker struct{ up atomic.Bool }

func init() {
	systemProbes["mail"] = func(*App) any {
		if mailer.up.Load() {
			return "ok"
		}
		return "down"
	}
	workerSetups = append(workerSetups, func(a *App, ctx context.Context) { go mailer.run(ctx, a) })
}

// queuedMail is one unsent row of the outbox.
type queuedMail struct {
	ID      int64
	StepID  *string
	To      string
	Subject string
	Body    string
}

// enqueueMail puts a message in the durable mail queue, sent once the mail server accepts it.
func (w *Work) enqueueMail(m outboundMail) error {
	if err := w.A.enqueue(w, nil, m); err != nil {
		return fmt.Errorf("queue mail: %w", err)
	}
	return nil
}

// enqueue writes one outbox row, for a step when stepID is set.
func (a *App) enqueue(w *Work, stepID *string, m outboundMail) error {
	_, err := w.Tx.Exec(w.Ctx, `insert into mail_outbox (kind, step_id, to_address, subject, body, due_at) values ($1, $2, $3, $4, $5, $6)`,
		m.Kind, stepID, m.To, m.Subject, m.Body, m.DueAt.UTC())
	if err != nil {
		return fmt.Errorf("queue %s mail to %s: %w", m.Kind, m.To, err)
	}
	return nil
}

// run sends due mail one message at a time about four times a second, retries a failure every five real seconds and
// probes the mail server's address the same often.
func (m *mailWorker) run(ctx context.Context, a *App) {
	poll := time.NewTicker(mailPoll)
	defer poll.Stop()
	probe := time.NewTicker(mailProbeEach)
	defer probe.Stop()
	m.probe(ctx, a)
	var retryAt time.Time
	for {
		select {
		case <-ctx.Done():
			return
		case <-probe.C:
			m.probe(ctx, a)
		case <-poll.C:
			if !instantReached(a.clock.Real(), retryAt) {
				continue
			}
			if err := m.sendDue(ctx, a); err != nil && ctx.Err() == nil {
				log.Printf("mail: %v", err)
				retryAt = a.clock.Real().Add(mailRetry)
			}
		}
	}
}

// probe dials the mail server's address as it reads now.
func (m *mailWorker) probe(ctx context.Context, a *App) {
	ctx, cancel := context.WithTimeout(ctx, mailTimeout)
	defer cancel()
	var dialer net.Dialer
	conn, err := dialer.DialContext(ctx, "tcp", smtpAddress(a))
	if err == nil {
		err = conn.Close()
	}
	m.up.Store(err == nil)
}

// smtpAddress is the mail host and port, read again for each attempt.
func smtpAddress(a *App) string { return net.JoinHostPort(a.cfg.SMTPHost, a.cfg.SMTPPort) }

// sendDue sends every unsent message that is due on the server clock, in due order, stopping at the first failure.
func (m *mailWorker) sendDue(ctx context.Context, a *App) error {
	for {
		next, found, err := a.nextDueMail(ctx)
		if err != nil {
			return fmt.Errorf("send due mail: %w", err)
		}
		if !found {
			return nil
		}
		if err := a.deliver(ctx, next); err != nil {
			m.up.Store(false)
			return fmt.Errorf("send mail %d to %s: %w", next.ID, next.To, err)
		}
		m.up.Store(true)
		if err := a.markMailSent(ctx, next); err != nil {
			return fmt.Errorf("record mail %d: %w", next.ID, err)
		}
	}
}

func (a *App) nextDueMail(ctx context.Context) (queuedMail, bool, error) {
	var next queuedMail
	// due_at <= now is the SQL form of the edge rule (edge.go): a message is sent from its due second.
	err := a.db.QueryRow(ctx, `select id, step_id, to_address, subject, body from mail_outbox
		where sent_at is null and due_at <= $1 order by due_at, id limit 1`, a.clock.Now()).
		Scan(&next.ID, &next.StepID, &next.To, &next.Subject, &next.Body)
	if isNoRows(err) {
		return next, false, nil
	}
	if err != nil {
		return next, false, fmt.Errorf("find due mail: %w", err)
	}
	return next, true, nil
}

// markMailSent records an accepted message, marks its step sent and tells open screens.
func (a *App) markMailSent(ctx context.Context, sent queuedMail) error {
	if err := a.Do(ctx, func(w *Work) error {
		if _, err := w.Tx.Exec(w.Ctx, `update mail_outbox set sent_at = $2 where id = $1`, sent.ID, w.Now); err != nil {
			return fmt.Errorf("mark mail %d sent: %w", sent.ID, err)
		}
		if sent.StepID == nil {
			return nil
		}
		var incidentID string
		err := w.Tx.QueryRow(w.Ctx, `update steps set status = 'sent', sent_at = $2 where id = $1 returning incident_id`,
			*sent.StepID, w.Now).Scan(&incidentID)
		if err != nil {
			return fmt.Errorf("mark step %s sent: %w", *sent.StepID, err)
		}
		if err := w.publishIncident(incidentID, ""); err != nil {
			return fmt.Errorf("publish incident: %w", err)
		}
		return nil
	}); err != nil {
		return fmt.Errorf("record sent mail: %w", err)
	}
	return nil
}

// deliver gives one message to the mail server; it succeeds only once the server accepted the message data.
func (a *App) deliver(ctx context.Context, m queuedMail) error {
	from, err := mail.ParseAddress(a.cfg.MailFrom)
	if err != nil {
		return fmt.Errorf("read MAIL_FROM: %w", err)
	}
	ctx, cancel := context.WithTimeout(ctx, mailTimeout)
	defer cancel()
	var dialer net.Dialer
	conn, err := dialer.DialContext(ctx, "tcp", smtpAddress(a))
	if err != nil {
		return fmt.Errorf("connect: %w", err)
	}
	defer conn.Close()
	// The smtp client takes no context; closing the connection when ctx ends is how a cancel reaches its calls.
	stopWatch := context.AfterFunc(ctx, func() { _ = conn.Close() })
	defer stopWatch()
	deadline, _ := ctx.Deadline()
	if err := conn.SetDeadline(deadline); err != nil {
		return fmt.Errorf("set deadline: %w", err)
	}
	client, err := smtp.NewClient(conn, a.cfg.SMTPHost)
	if err != nil {
		return fmt.Errorf("greet: %w", err)
	}
	defer client.Close()
	if err := client.Mail(from.Address); err != nil {
		return fmt.Errorf("sender: %w", err)
	}
	if err := client.Rcpt(m.To); err != nil {
		return fmt.Errorf("recipient: %w", err)
	}
	data, err := client.Data()
	if err != nil {
		return fmt.Errorf("data: %w", err)
	}
	if _, err := data.Write([]byte(a.compose(from, m))); err != nil {
		return fmt.Errorf("write message: %w", err)
	}
	if err := data.Close(); err != nil {
		return fmt.Errorf("message refused: %w", err)
	}
	return nil
}

// compose is the message text with its headers.
func (a *App) compose(from *mail.Address, m queuedMail) string {
	headers := []string{
		"From: " + from.String(),
		"To: " + m.To,
		"Subject: " + mime.QEncoding.Encode("utf-8", m.Subject),
		"Date: " + a.clock.Now().Format(time.RFC1123Z),
		"Message-ID: <" + newID() + "@" + messageDomain(from) + ">",
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=utf-8",
		"Content-Transfer-Encoding: 8bit",
	}
	return strings.Join(headers, "\r\n") + "\r\n\r\n" + m.Body
}

func messageDomain(from *mail.Address) string {
	_, domain, _ := strings.Cut(from.Address, "@")
	return domain
}
