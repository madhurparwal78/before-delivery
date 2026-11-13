package main

import (
	"os"
	"strings"
)

// Config holds every value read from the environment at start. Nothing here is sent to the browser.
type Config struct {
	Port        string
	PublicURL   string
	Instance    string
	DatabaseURL string
	AMQPURL     string
	ValkeyURL   string
	SMTPHost    string
	SMTPPort    string
	WiremockURL string
	MailFrom    string
}

const defaultMailFrom = "Switchlamp <pager@tarecross.example>"

func loadConfig() Config {
	cfg := Config{
		Port:        env("APP_PUBLIC_PORT", "4173"),
		PublicURL:   strings.TrimRight(os.Getenv("APP_PUBLIC_URL"), "/"),
		Instance:    env("SWITCHLAMP_INSTANCE", "main"),
		DatabaseURL: os.Getenv("DATABASE_URL"),
		AMQPURL:     os.Getenv("AMQP_URL"),
		ValkeyURL:   os.Getenv("VALKEY_URL"),
		SMTPHost:    os.Getenv("SMTP_HOST"),
		SMTPPort:    os.Getenv("SMTP_PORT"),
		WiremockURL: strings.TrimRight(os.Getenv("WIREMOCK_URL"), "/"),
		MailFrom:    env("MAIL_FROM", defaultMailFrom),
	}
	return cfg
}

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

// queueName is the durable intake queue of this copy.
func (c Config) queueName() string { return "switchlamp." + c.Instance + ".events" }

// deadQueueName is the durable dead-letter queue of this copy.
func (c Config) deadQueueName() string { return c.queueName() + ".dead" }

// cacheKey builds a Valkey key under this copy's prefix.
func (c Config) cacheKey(parts ...string) string {
	return "switchlamp:" + c.Instance + ":" + strings.Join(parts, ":")
}
