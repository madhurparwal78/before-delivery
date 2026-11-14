package main

import (
	"bytes"
	"context"
	"fmt"
	"mime"
	"mime/quotedprintable"
	"net"
	"net/http"
	"net/mail"
	"net/smtp"
	"strings"
	"time"
)

const sendTimeout = 10 * time.Second

// sendEmail hands one plain-text message to Mailpit over plain SMTP; the send succeeds only when Mailpit accepts it.
func (a *App) sendEmail(ctx context.Context, to, subject, body string) error {
	from, err := mail.ParseAddress(a.cfg.MailFrom)
	if err != nil {
		return fmt.Errorf("read MAIL_FROM: %w", err)
	}
	var message bytes.Buffer
	headers := []struct{ name, value string }{
		{"From", a.cfg.MailFrom}, {"To", to}, {"Subject", mime.QEncoding.Encode("utf-8", subject)},
		{"Date", time.Now().UTC().Format(time.RFC1123Z)}, {"MIME-Version", "1.0"},
		{"Content-Type", "text/plain; charset=utf-8"}, {"Content-Transfer-Encoding", "quoted-printable"},
	}
	for _, h := range headers {
		message.WriteString(h.name + ": " + h.value + "\r\n")
	}
	message.WriteString("\r\n")
	encoder := quotedprintable.NewWriter(&message)
	if _, err := encoder.Write([]byte(strings.ReplaceAll(body, "\n", "\r\n"))); err != nil {
		return fmt.Errorf("encode email body: %w", err)
	}
	if err := encoder.Close(); err != nil {
		return fmt.Errorf("encode email body: %w", err)
	}
	dialer := net.Dialer{Timeout: sendTimeout}
	conn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(a.cfg.SMTPHost, a.cfg.SMTPPort))
	if err != nil {
		return fmt.Errorf("reach Mailpit: %w", err)
	}
	if err := conn.SetDeadline(time.Now().Add(sendTimeout)); err != nil {
		conn.Close()
		return fmt.Errorf("set SMTP deadline: %w", err)
	}
	client, err := smtp.NewClient(conn, a.cfg.SMTPHost)
	if err != nil {
		conn.Close()
		return fmt.Errorf("start SMTP: %w", err)
	}
	defer client.Close()
	if err := client.Mail(from.Address); err != nil {
		return fmt.Errorf("SMTP sender: %w", err)
	}
	if err := client.Rcpt(to); err != nil {
		return fmt.Errorf("SMTP recipient: %w", err)
	}
	data, err := client.Data()
	if err != nil {
		return fmt.Errorf("SMTP data: %w", err)
	}
	if _, err := data.Write(message.Bytes()); err != nil {
		return fmt.Errorf("SMTP write: %w", err)
	}
	if err := data.Close(); err != nil {
		return fmt.Errorf("SMTP accept: %w", err)
	}
	return client.Quit()
}

// sendPush publishes one notice to its ntfy topic; the send succeeds only when ntfy answers 2xx.
func (a *App) sendPush(ctx context.Context, topic, title, message string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.cfg.NtfyURL+"/"+topic, strings.NewReader(message))
	if err != nil {
		return fmt.Errorf("build push: %w", err)
	}
	req.SetBasicAuth(a.cfg.NtfyUsername, a.cfg.NtfyPassword)
	req.Header.Set("Title", title)
	client := http.Client{Timeout: sendTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("reach ntfy: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("ntfy answered %d", resp.StatusCode)
	}
	return nil
}
