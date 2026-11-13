package config

import (
	"fmt"
	"net/url"
	"os"
)

// Config is read once at start and never sent to the browser.
type Config struct {
	DatabaseURL string
	AMQPURL     string
	ValkeyURL   string
	SMTPHost    string
	SMTPPort    string
	MailpitURL  string
	WiremockURL string
	MailFrom    string
	PublicURL   string
	Port        string
	Instance    string
}

func env(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}

// Load reads the published environment values.
func Load() (*Config, error) {
	c := &Config{
		DatabaseURL: os.Getenv("DATABASE_URL"),
		AMQPURL:     os.Getenv("AMQP_URL"),
		ValkeyURL:   os.Getenv("VALKEY_URL"),
		SMTPHost:    os.Getenv("SMTP_HOST"),
		SMTPPort:    os.Getenv("SMTP_PORT"),
		MailpitURL:  os.Getenv("MAILPIT_URL"),
		WiremockURL: os.Getenv("WIREMOCK_URL"),
		MailFrom:    os.Getenv("MAIL_FROM"),
		PublicURL:   os.Getenv("APP_PUBLIC_URL"),
		Instance:    env("SWITCHLAMP_INSTANCE", "main"),
	}
	if c.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is not set")
	}
	if c.AMQPURL == "" {
		return nil, fmt.Errorf("AMQP_URL is not set")
	}
	if c.ValkeyURL == "" {
		return nil, fmt.Errorf("VALKEY_URL is not set")
	}
	if c.SMTPHost == "" || c.SMTPPort == "" {
		return nil, fmt.Errorf("SMTP_HOST and SMTP_PORT must both be set")
	}
	c.Port = env("APP_PUBLIC_PORT", "4173")
	if c.PublicURL == "" {
		c.PublicURL = fmt.Sprintf("http://127.0.0.1:%s", c.Port)
	}
	if u, err := url.Parse(c.PublicURL); err == nil && u.Port() != "" && u.Port() != c.Port {
		// The public URL names the serving origin when it carries a port.
		c.Port = u.Port()
	}
	if c.MailFrom == "" {
		c.MailFrom = "Switchlamp <pager@tarecross.example>"
	}
	return c, nil
}

// ValidateEnv reports whether an Origin header matches the app's own origin.
func (c *Config) OriginAllowed(origin string) bool {
	if origin == "" {
		return true
	}
	return origin == c.PublicURL
}
