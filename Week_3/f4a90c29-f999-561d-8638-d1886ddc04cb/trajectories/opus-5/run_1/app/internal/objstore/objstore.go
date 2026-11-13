// Package objstore talks plain HTTP to MinIO, which holds every print and
// iCalendar file. The browser never talks to it.
package objstore

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

type Client struct {
	endpoint       string
	region         string
	bucket         string
	accessKeyID    string
	secret         string
	forcePathStyle bool
	http           *http.Client
}

// Unavailable reports that the file storage did not answer, so nothing changed.
type Unavailable struct{ Err error }

func (u Unavailable) Error() string { return "file storage unavailable: " + u.Err.Error() }

func New(endpoint, region, bucket, accessKeyID, secret string, forcePathStyle bool) *Client {
	return &Client{
		endpoint:       strings.TrimRight(endpoint, "/"),
		region:         region,
		bucket:         bucket,
		accessKeyID:    accessKeyID,
		secret:         secret,
		forcePathStyle: forcePathStyle,
		http:           &http.Client{Timeout: 20 * time.Second},
	}
}

// Put writes an object.
func (c *Client) Put(key, contentType string, body []byte) error {
	req, err := c.request(http.MethodPut, key, body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", contentType)
	c.sign(req, body)
	res, err := c.http.Do(req)
	if err != nil {
		return Unavailable{err}
	}
	defer res.Body.Close()
	if res.StatusCode/100 != 2 {
		return fmt.Errorf("put %s: %s", key, res.Status)
	}
	return nil
}

// Size reads an object's size back, which is how a write is confirmed.
func (c *Client) Size(key string) (int64, error) {
	req, err := c.request(http.MethodHead, key, nil)
	if err != nil {
		return 0, err
	}
	c.sign(req, nil)
	res, err := c.http.Do(req)
	if err != nil {
		return 0, Unavailable{err}
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound {
		return 0, fmt.Errorf("head %s: not stored", key)
	}
	if res.StatusCode/100 != 2 {
		return 0, fmt.Errorf("head %s: %s", key, res.Status)
	}
	return res.ContentLength, nil
}

// Get reads an object back.
func (c *Client) Get(key string) ([]byte, error) {
	req, err := c.request(http.MethodGet, key, nil)
	if err != nil {
		return nil, err
	}
	c.sign(req, nil)
	res, err := c.http.Do(req)
	if err != nil {
		return nil, Unavailable{err}
	}
	defer res.Body.Close()
	if res.StatusCode/100 != 2 {
		return nil, fmt.Errorf("get %s: %s", key, res.Status)
	}
	return io.ReadAll(res.Body)
}

func (c *Client) request(method, key string, body []byte) (*http.Request, error) {
	target := c.endpoint
	if c.forcePathStyle {
		target += "/" + c.bucket + "/" + key
	} else {
		parsed, err := url.Parse(c.endpoint)
		if err != nil {
			return nil, err
		}
		parsed.Host = c.bucket + "." + parsed.Host
		parsed.Path = "/" + key
		target = parsed.String()
	}
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequest(method, target, reader)
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.ContentLength = int64(len(body))
	}
	return req, nil
}

// sign adds an AWS Signature Version 4 authorization header.
func (c *Client) sign(req *http.Request, body []byte) {
	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")
	payloadHash := hex.EncodeToString(sha256.New().Sum(nil))
	if len(body) > 0 {
		sum := sha256.Sum256(body)
		payloadHash = hex.EncodeToString(sum[:])
	}
	req.Header.Set("X-Amz-Date", amzDate)
	req.Header.Set("X-Amz-Content-Sha256", payloadHash)
	req.Header.Set("Host", req.URL.Host)

	var names []string
	headers := map[string]string{"host": req.URL.Host}
	for name, values := range req.Header {
		lower := strings.ToLower(name)
		if lower == "host" {
			continue
		}
		headers[lower] = strings.TrimSpace(strings.Join(values, ","))
	}
	for name := range headers {
		names = append(names, name)
	}
	sort.Strings(names)
	var canonicalHeaders strings.Builder
	for _, name := range names {
		canonicalHeaders.WriteString(name + ":" + headers[name] + "\n")
	}
	signedHeaders := strings.Join(names, ";")

	canonicalRequest := strings.Join([]string{
		req.Method,
		escapePath(req.URL.Path),
		req.URL.RawQuery,
		canonicalHeaders.String(),
		signedHeaders,
		payloadHash,
	}, "\n")
	scope := dateStamp + "/" + c.region + "/s3/aws4_request"
	requestSum := sha256.Sum256([]byte(canonicalRequest))
	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256", amzDate, scope, hex.EncodeToString(requestSum[:]),
	}, "\n")

	key := hmacSHA256([]byte("AWS4"+c.secret), dateStamp)
	key = hmacSHA256(key, c.region)
	key = hmacSHA256(key, "s3")
	key = hmacSHA256(key, "aws4_request")
	signature := hex.EncodeToString(hmacSHA256(key, stringToSign))

	req.Header.Set("Authorization", fmt.Sprintf(
		"AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		c.accessKeyID, scope, signedHeaders, signature))
}

func hmacSHA256(key []byte, data string) []byte {
	h := hmac.New(sha256.New, key)
	h.Write([]byte(data))
	return h.Sum(nil)
}

// escapePath escapes each path segment the way S3 signing expects.
func escapePath(path string) string {
	segments := strings.Split(path, "/")
	for i, segment := range segments {
		segments[i] = strings.ReplaceAll(url.QueryEscape(segment), "+", "%20")
	}
	return strings.Join(segments, "/")
}
