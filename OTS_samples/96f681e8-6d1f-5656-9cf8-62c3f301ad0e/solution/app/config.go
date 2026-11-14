package main

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config holds every setting the server reads from the environment at start.
type Config struct {
	DatabaseURL      string
	KeycloakURL      string
	KeycloakRealm    string
	AuthIssuerURL    string
	AuthClientID     string
	AuthClientSecret string
	WiremockURL      string
	SMTPHost         string
	SMTPPort         string
	MailFrom         string
	NtfyURL          string
	NtfyUsername     string
	NtfyPassword     string
	PublicPort       string
	PublicURL        string
	Timing           ClubTiming
}

// ClubTiming is the club's timing: every value has the default the brief documents.
type ClubTiming struct {
	HoldSeconds        int
	MatchCutoffSeconds int
	FreeCancelSeconds  int
	ShareSettleSeconds int
	AuthRefreshSeconds int
	NoShowGraceSeconds int
	SlotStepMinutes    int
	OpeningHours       string
	ClubTimezone       string
	NoticeRetry        []time.Duration
}

func loadConfig() (Config, error) {
	var missing []string
	need := func(name string) string {
		value := os.Getenv(name)
		if value == "" {
			missing = append(missing, name)
		}
		return value
	}
	fallback := func(name, def string) string {
		if value := os.Getenv(name); value != "" {
			return value
		}
		return def
	}
	cfg := Config{
		DatabaseURL:      need("DATABASE_URL"),
		KeycloakURL:      strings.TrimRight(need("KEYCLOAK_URL"), "/"),
		KeycloakRealm:    need("KEYCLOAK_REALM"),
		AuthIssuerURL:    strings.TrimRight(need("AUTH_ISSUER_URL"), "/"),
		AuthClientID:     need("AUTH_CLIENT_ID"),
		AuthClientSecret: need("AUTH_CLIENT_SECRET"),
		WiremockURL:      strings.TrimRight(need("WIREMOCK_URL"), "/"),
		SMTPHost:         need("SMTP_HOST"),
		SMTPPort:         need("SMTP_PORT"),
		MailFrom:         fallback("MAIL_FROM", "Marlowe Yard Padel Club <desk@marloweyard.test>"),
		NtfyURL:          strings.TrimRight(need("NTFY_URL"), "/"),
		NtfyUsername:     need("NTFY_USERNAME"),
		NtfyPassword:     need("NTFY_PASSWORD"),
		PublicPort:       fallback("APP_PUBLIC_PORT", "4173"),
		PublicURL:        strings.TrimRight(need("APP_PUBLIC_URL"), "/"),
	}
	if len(missing) > 0 {
		return Config{}, fmt.Errorf("missing environment: %s", strings.Join(missing, ", "))
	}
	timing, err := loadTiming(fallback)
	if err != nil {
		return Config{}, err
	}
	cfg.Timing = timing
	return cfg, nil
}

func loadTiming(fallback func(name, def string) string) (ClubTiming, error) {
	var timing ClubTiming
	seconds := map[string]struct {
		target *int
		def    string
	}{
		"HOLD_SECONDS":          {&timing.HoldSeconds, "600"},
		"MATCH_CUTOFF_SECONDS":  {&timing.MatchCutoffSeconds, "7200"},
		"FREE_CANCEL_SECONDS":   {&timing.FreeCancelSeconds, "86400"},
		"SHARE_SETTLE_SECONDS":  {&timing.ShareSettleSeconds, "21600"},
		"AUTH_REFRESH_SECONDS":  {&timing.AuthRefreshSeconds, "518400"},
		"NO_SHOW_GRACE_SECONDS": {&timing.NoShowGraceSeconds, "900"},
		"SLOT_STEP_MINUTES":     {&timing.SlotStepMinutes, "30"},
	}
	for name, setting := range seconds {
		value, err := strconv.Atoi(fallback(name, setting.def))
		if err != nil || value < 1 {
			return ClubTiming{}, fmt.Errorf("%s must be a positive whole number", name)
		}
		*setting.target = value
	}
	timing.OpeningHours = fallback("OPENING_HOURS", "08:00-23:00")
	timing.ClubTimezone = fallback("CLUB_TIMEZONE", "Europe/Madrid")
	for _, part := range strings.Split(fallback("NOTICE_RETRY_SECONDS", "30,120,600,3600"), ",") {
		value, err := strconv.Atoi(strings.TrimSpace(part))
		if err != nil || value < 0 {
			return ClubTiming{}, fmt.Errorf("NOTICE_RETRY_SECONDS must list whole seconds")
		}
		timing.NoticeRetry = append(timing.NoticeRetry, time.Duration(value)*time.Second)
	}
	return timing, nil
}
