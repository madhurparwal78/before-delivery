package main

import (
	"os"
	"strconv"
	"time"
)

// Config holds every value read from the environment at start.
type Config struct {
	Port           string
	DatabaseURL    string
	S3Endpoint     string
	S3Region       string
	S3Bucket       string
	S3AccessKey    string
	S3SecretKey    string
	SvixURL        string
	SvixAPIKey     string
	GitHostURL     string
	AIEngineURL    string
	AssignmentTTL  time.Duration
	HoldTTL        time.Duration
	AuditRetention time.Duration
	WebhookRetry   time.Duration
}

func loadConfig() Config {
	wiremock := os.Getenv("WIREMOCK_URL")
	return Config{
		Port:           firstNonEmpty(os.Getenv("APP_PUBLIC_PORT"), "4173"),
		DatabaseURL:    os.Getenv("DATABASE_URL"),
		S3Endpoint:     os.Getenv("S3_ENDPOINT"),
		S3Region:       firstNonEmpty(os.Getenv("S3_REGION"), "us-east-1"),
		S3Bucket:       os.Getenv("S3_BUCKET"),
		S3AccessKey:    os.Getenv("S3_ACCESS_KEY_ID"),
		S3SecretKey:    os.Getenv("S3_SECRET_ACCESS_KEY"),
		SvixURL:        os.Getenv("SVIX_URL"),
		SvixAPIKey:     os.Getenv("SVIX_API_KEY"),
		GitHostURL:     firstNonEmpty(os.Getenv("GIT_HOST_URL"), wiremock),
		AIEngineURL:    firstNonEmpty(os.Getenv("AI_ENGINE_URL"), wiremock),
		AssignmentTTL:  seconds("ASSIGNMENT_TTL_SECONDS", 172800),
		HoldTTL:        seconds("CONFLICT_HOLD_SECONDS", 300),
		AuditRetention: seconds("AUDIT_RETENTION_SECONDS", 15811200),
		WebhookRetry:   seconds("WEBHOOK_RETRY_SECONDS", 10),
	}
}

func seconds(name string, fallback int) time.Duration {
	if n, err := strconv.Atoi(os.Getenv(name)); err == nil && n > 0 {
		return time.Duration(n) * time.Second
	}
	return time.Duration(fallback) * time.Second
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
