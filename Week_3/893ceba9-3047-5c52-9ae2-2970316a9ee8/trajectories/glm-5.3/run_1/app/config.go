package main

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	DatabaseURL       string
	S3Endpoint        string
	S3Region          string
	S3Bucket          string
	S3ForcePathStyle  bool
	S3AccessKeyID     string
	S3SecretAccessKey string
	SvixURL           string
	SvixAPIKey        string
	WiremockURL       string
	GitHostURL        string
	AIEngineURL       string
	AssignmentTTL     time.Duration
	ConflictHold      time.Duration
	AuditRetention    time.Duration
	WebhookRetry      time.Duration
	PublicPort        string
}

func envStr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envSeconds(key string, fallback int) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return time.Duration(fallback) * time.Second
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 0 {
		return time.Duration(fallback) * time.Second
	}
	return time.Duration(n) * time.Second
}

func LoadConfig() (Config, error) {
	cfg := Config{
		DatabaseURL:       os.Getenv("DATABASE_URL"),
		S3Endpoint:        os.Getenv("S3_ENDPOINT"),
		S3Region:          envStr("S3_REGION", "us-east-1"),
		S3Bucket:          os.Getenv("S3_BUCKET"),
		S3ForcePathStyle:  os.Getenv("S3_FORCE_PATH_STYLE") == "true",
		S3AccessKeyID:     os.Getenv("S3_ACCESS_KEY_ID"),
		S3SecretAccessKey: os.Getenv("S3_SECRET_ACCESS_KEY"),
		SvixURL:           os.Getenv("SVIX_URL"),
		SvixAPIKey:        os.Getenv("SVIX_API_KEY"),
		WiremockURL:       os.Getenv("WIREMOCK_URL"),
		AssignmentTTL:     envSeconds("ASSIGNMENT_TTL_SECONDS", 172800),
		ConflictHold:      envSeconds("CONFLICT_HOLD_SECONDS", 300),
		AuditRetention:    envSeconds("AUDIT_RETENTION_SECONDS", 15811200),
		WebhookRetry:      envSeconds("WEBHOOK_RETRY_SECONDS", 10),
		PublicPort:        envStr("APP_PUBLIC_PORT", "4173"),
	}
	if cfg.DatabaseURL == "" {
		return cfg, fmt.Errorf("DATABASE_URL is required")
	}
	// local Postgres runs without SSL; respect an explicit sslmode when given
	if !strings.Contains(cfg.DatabaseURL, "sslmode=") {
		cfg.DatabaseURL += "?sslmode=disable"
	}
	cfg.GitHostURL = envStr("GIT_HOST_URL", cfg.WiremockURL)
	cfg.AIEngineURL = envStr("AI_ENGINE_URL", cfg.WiremockURL)
	return cfg, nil
}

// Body limits from the server boundary rules.
const (
	MaxJSONBody   int64 = 1_000_000
	MaxFileBody   int64 = 5_000_000
	MaxMultipart  int64 = 5_100_000
	SessionCookie       = "desk_session"
	SessionTTL          = 12 * time.Hour
)
