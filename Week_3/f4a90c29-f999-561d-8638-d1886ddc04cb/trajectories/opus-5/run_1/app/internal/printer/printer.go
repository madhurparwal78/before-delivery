// Package printer renders the printed week through Gotenberg.
package printer

import (
	"bytes"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"time"
)

type Client struct {
	url  string
	http *http.Client
}

// Unreachable reports that the document service did not answer.
type Unreachable struct{ Err error }

func (u Unreachable) Error() string { return "document service unreachable: " + u.Err.Error() }

func New(url string) *Client {
	return &Client{url: strings.TrimRight(url, "/"), http: &http.Client{Timeout: 60 * time.Second}}
}

// Render posts an HTML page and reads back a PDF.
func (c *Client) Render(html string) ([]byte, error) {
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	part, err := form.CreateFormFile("files", "index.html")
	if err != nil {
		return nil, err
	}
	if _, err := part.Write([]byte(html)); err != nil {
		return nil, err
	}
	if err := form.WriteField("paperWidth", "8.27"); err != nil {
		return nil, err
	}
	if err := form.WriteField("paperHeight", "11.7"); err != nil {
		return nil, err
	}
	if err := form.Close(); err != nil {
		return nil, err
	}
	req, err := http.NewRequest(http.MethodPost, c.url+"/forms/chromium/convert/html", &body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", form.FormDataContentType())
	res, err := c.http.Do(req)
	if err != nil {
		return nil, Unreachable{err}
	}
	defer res.Body.Close()
	if res.StatusCode/100 != 2 {
		return nil, fmt.Errorf("document service answered %s", res.Status)
	}
	return io.ReadAll(res.Body)
}
