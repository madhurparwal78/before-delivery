// Package config reads every service address, credential and duration the
// saleroom needs from the process environment at start.
package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

// Config holds the settings the server reads once at start.
type Config struct {
	DatabaseURL        string
	KeycloakURL        string
	KeycloakRealm      string
	AuthIssuerURL      string
	AuthClientID       string
	AuthClientSecret   string
	PublicPort         int
	PublicURL          string
	LotGap             time.Duration
	SoftClose          time.Duration
	PaymentDue         time.Duration
	OfferWindow        time.Duration
	WatchNotice        time.Duration
	LotGapSeconds      int
	SoftCloseSeconds   int
	PaymentDueSeconds  int
	OfferSeconds       int
	WatchNoticeSeconds int
}

// Load reads the environment. Missing service settings are fatal because the
// saleroom cannot reach PostgreSQL or Keycloak without them.
func Load() (*Config, error) {
	c := &Config{
		DatabaseURL:      os.Getenv("DATABASE_URL"),
		KeycloakURL:      os.Getenv("KEYCLOAK_URL"),
		KeycloakRealm:    os.Getenv("KEYCLOAK_REALM"),
		AuthIssuerURL:    os.Getenv("AUTH_ISSUER_URL"),
		AuthClientID:     os.Getenv("AUTH_CLIENT_ID"),
		AuthClientSecret: os.Getenv("AUTH_CLIENT_SECRET"),
		PublicURL:        os.Getenv("APP_PUBLIC_URL"),
	}
	if c.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is not set")
	}

	port, err := intFromEnv("APP_PUBLIC_PORT", 4173)
	if err != nil {
		return nil, err
	}
	c.PublicPort = port

	type durSetting struct {
		name    string
		def     int
		seconds *int
		dur     *time.Duration
	}
	for _, s := range []durSetting{
		{"LOT_GAP_SECONDS", 60, &c.LotGapSeconds, &c.LotGap},
		{"SOFT_CLOSE_SECONDS", 120, &c.SoftCloseSeconds, &c.SoftClose},
		{"PAYMENT_DUE_SECONDS", 259200, &c.PaymentDueSeconds, &c.PaymentDue},
		{"OFFER_SECONDS", 86400, &c.OfferSeconds, &c.OfferWindow},
		{"WATCH_NOTICE_SECONDS", 300, &c.WatchNoticeSeconds, &c.WatchNotice},
	} {
		v, err := intFromEnv(s.name, s.def)
		if err != nil {
			return nil, err
		}
		if v < 1 {
			return nil, fmt.Errorf("%s must be a positive whole number of seconds", s.name)
		}
		*s.seconds = v
		*s.dur = time.Duration(v) * time.Second
	}
	return c, nil
}

func intFromEnv(name string, def int) (int, error) {
	raw := os.Getenv(name)
	if raw == "" {
		return def, nil
	}
	v, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("%s: %q is not a whole number: %w", name, raw, err)
	}
	return v, nil
}

// CallbackURL is the sign-in redirect address registered with Keycloak. It
// falls back to the request's own origin when APP_PUBLIC_URL is unset.
func (c *Config) CallbackURL(requestOrigin string) string {
	base := c.PublicURL
	if base == "" {
		base = requestOrigin
	}
	return base + "/auth/callback"
}
