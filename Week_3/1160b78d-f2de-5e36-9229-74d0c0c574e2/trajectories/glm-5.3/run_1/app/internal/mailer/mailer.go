// Package mailer sends SMTP mail through Mailpit and keeps a durable queue in
// Postgres for everything that cannot go out yet.
package mailer

import (
	"context"
	"fmt"
	"net"
	"net/smtp"
	"strings"
	"time"
)

// Sender posts one mail to the SMTP host and port read for each attempt.
type Sender struct {
	Host string
	Port string
	From string
}

// Send delivers one message. It reports whether the mail server accepted it.
func (s *Sender) Send(ctx context.Context, to, subject, body string) error {
	addr := net.JoinHostPort(s.Host, s.Port)
	c, err := smtp.Dial(addr)
	if err != nil {
		return fmt.Errorf("dialling %s: %w", addr, err)
	}
	defer c.Close()
	if err := c.Hello("tarecross.example"); err != nil {
		return err
	}
	if err := c.Mail("pager@tarecross.example"); err != nil {
		return err
	}
	if err := c.Rcpt(to); err != nil {
		return err
	}
	w, err := c.Data()
	if err != nil {
		return err
	}
	msg := buildMessage(s.From, to, subject, body)
	if _, err := w.Write([]byte(msg)); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return c.Quit()
}

func buildMessage(from, to, subject, body string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "From: %s\r\n", from)
	fmt.Fprintf(&b, "To: %s\r\n", to)
	fmt.Fprintf(&b, "Subject: %s\r\n", subject)
	fmt.Fprintf(&b, "Date: %s\r\n", time.Now().UTC().Format(time.RFC1123Z))
	b.WriteString("Content-Type: text/plain; charset=utf-8\r\n\r\n")
	b.WriteString(body)
	return b.String()
}

// Healthy probes the SMTP port without sending a message.
func (s *Sender) Healthy(ctx context.Context) bool {
	d := net.Dialer{Timeout: 2 * time.Second}
	c, err := d.DialContext(ctx, "tcp", net.JoinHostPort(s.Host, s.Port))
	if err != nil {
		return false
	}
	c.Close()
	return true
}
