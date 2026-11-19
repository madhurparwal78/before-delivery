// Package mailer composes and sends the confirmation and reminder emails, and
// drains the Postgres outbox so each one sends exactly once.
package mailer

import (
	"fmt"
	"net"
	"net/mail"
	"net/smtp"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

// Mailer talks plain SMTP, without authentication or TLS.
type Mailer struct {
	addr     string
	from     string
	envelope string
	up       atomic.Bool
}

const dialTimeout = 3 * time.Second

// New builds a mailer for a host and port.
func New(host string, port int, from string) (*Mailer, error) {
	address, err := mail.ParseAddress(from)
	if err != nil {
		return nil, err
	}
	return &Mailer{
		addr:     net.JoinHostPort(host, strconv.Itoa(port)),
		from:     from,
		envelope: address.Address,
	}, nil
}

// Up reports the latest probe result.
func (m *Mailer) Up() bool { return m.up.Load() }

// Probe checks that the SMTP server answers.
func (m *Mailer) Probe() {
	client, err := m.dial()
	if err != nil {
		m.up.Store(false)
		return
	}
	defer func() { _ = client.Close() }()
	if err := client.Noop(); err != nil {
		m.up.Store(false)
		return
	}
	_ = client.Quit()
	m.up.Store(true)
}

func (m *Mailer) dial() (*smtp.Client, error) {
	conn, err := net.DialTimeout("tcp", m.addr, dialTimeout)
	if err != nil {
		return nil, err
	}
	_ = conn.SetDeadline(time.Now().Add(2 * dialTimeout))
	host, _, _ := net.SplitHostPort(m.addr)
	client, err := smtp.NewClient(conn, host)
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	return client, nil
}

// Send delivers one email. A failure leaves the caller's outbox row unsent.
func (m *Mailer) Send(to, subject, body string) error {
	client, err := m.dial()
	if err != nil {
		m.up.Store(false)
		return err
	}
	defer func() { _ = client.Close() }()

	if err := client.Mail(m.envelope); err != nil {
		m.up.Store(false)
		return err
	}
	if err := client.Rcpt(to); err != nil {
		return err
	}
	writer, err := client.Data()
	if err != nil {
		m.up.Store(false)
		return err
	}
	if _, err := writer.Write([]byte(m.message(to, subject, body))); err != nil {
		return err
	}
	if err := writer.Close(); err != nil {
		return err
	}
	if err := client.Quit(); err != nil {
		return err
	}
	m.up.Store(true)
	return nil
}

func (m *Mailer) message(to, subject, body string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "From: %s\r\n", m.from)
	fmt.Fprintf(&b, "To: %s\r\n", to)
	fmt.Fprintf(&b, "Subject: %s\r\n", subject)
	fmt.Fprintf(&b, "Date: %s\r\n", time.Now().UTC().Format(time.RFC1123Z))
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: text/plain; charset=utf-8\r\n")
	b.WriteString("\r\n")
	for _, line := range strings.Split(body, "\n") {
		b.WriteString(strings.TrimSuffix(line, "\r"))
		b.WriteString("\r\n")
	}
	return b.String()
}
