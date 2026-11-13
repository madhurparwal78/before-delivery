// Package config reads the environment the server runs under. Nothing here is
// ever sent to the browser.
package config

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	DatabaseURL string
	AMQPURL     string
	ValkeyURL   string
	SMTPHost    string
	SMTPPort    int
	MailpitURL  string
	WiremockURL string
	MailFrom    string
	PublicURL   string
	Instance    string
	Port        int
}

func Load() Config {
	c := Config{
		DatabaseURL: os.Getenv("DATABASE_URL"),
		AMQPURL:     os.Getenv("AMQP_URL"),
		ValkeyURL:   os.Getenv("VALKEY_URL"),
		SMTPHost:    os.Getenv("SMTP_HOST"),
		SMTPPort:    intOr(os.Getenv("SMTP_PORT"), 1025),
		MailpitURL:  os.Getenv("MAILPIT_URL"),
		WiremockURL: strings.TrimSuffix(os.Getenv("WIREMOCK_URL"), "/"),
		MailFrom:    os.Getenv("MAIL_FROM"),
		PublicURL:   strings.TrimSuffix(os.Getenv("APP_PUBLIC_URL"), "/"),
		Instance:    os.Getenv("SWITCHLAMP_INSTANCE"),
		Port:        intOr(os.Getenv("APP_PUBLIC_PORT"), 4173),
	}
	if c.MailFrom == "" {
		c.MailFrom = "Switchlamp <pager@tarecross.example>"
	}
	if c.Instance == "" {
		c.Instance = "main"
	}
	return c
}

func intOr(s string, fallback int) int {
	if s == "" {
		return fallback
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return fallback
	}
	return n
}
