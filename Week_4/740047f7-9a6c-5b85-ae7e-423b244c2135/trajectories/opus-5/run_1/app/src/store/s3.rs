use crate::config::S3Config;
use crate::error::{ApiError, ApiResult};
use chrono::Utc;
use hmac::{Hmac, Mac};
use percent_encoding::{utf8_percent_encode, AsciiSet, CONTROLS};
use sha2::{Digest, Sha256};

type HmacSha256 = Hmac<Sha256>;

const PATH_SAFE: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'#')
    .add(b'%')
    .add(b'<')
    .add(b'>')
    .add(b'?')
    .add(b'[')
    .add(b'\\')
    .add(b']')
    .add(b'^')
    .add(b'`')
    .add(b'{')
    .add(b'|')
    .add(b'}');

/// A minimal S3 client that talks plain HTTP to MinIO and signs with SigV4.
#[derive(Clone)]
pub struct ObjectStore {
    config: S3Config,
    client: reqwest::Client,
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn hmac(key: &[u8], data: &str) -> Vec<u8> {
    let mut mac = match HmacSha256::new_from_slice(key) {
        Ok(mac) => mac,
        Err(_) => return Vec::new(),
    };
    mac.update(data.as_bytes());
    mac.finalize().into_bytes().to_vec()
}

impl ObjectStore {
    pub fn new(config: S3Config, client: reqwest::Client) -> ObjectStore {
        ObjectStore { config, client }
    }

    fn url(&self, key: &str, query: &str) -> String {
        let path = self.canonical_path(key);
        if query.is_empty() {
            format!("{}{}", self.config.endpoint, path)
        } else {
            format!("{}{}?{}", self.config.endpoint, path, query)
        }
    }

    fn canonical_path(&self, key: &str) -> String {
        let encoded: Vec<String> = key
            .split('/')
            .map(|segment| utf8_percent_encode(segment, PATH_SAFE).to_string())
            .collect();
        if self.config.force_path_style {
            format!("/{}/{}", self.config.bucket, encoded.join("/"))
        } else {
            format!("/{}", encoded.join("/"))
        }
    }

    fn host(&self) -> String {
        self.config
            .endpoint
            .split_once("://")
            .map(|(_, rest)| rest.split('/').next().unwrap_or(rest).to_string())
            .unwrap_or_default()
    }

    async fn send(
        &self,
        method: reqwest::Method,
        key: &str,
        query: &str,
        body: Vec<u8>,
        content_type: Option<&str>,
    ) -> ApiResult<reqwest::Response> {
        let now = Utc::now();
        let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();
        let date_stamp = now.format("%Y%m%d").to_string();
        let payload_hash = sha256_hex(&body);
        let host = self.host();

        let mut headers: Vec<(String, String)> = vec![
            ("host".to_string(), host.clone()),
            ("x-amz-content-sha256".to_string(), payload_hash.clone()),
            ("x-amz-date".to_string(), amz_date.clone()),
        ];
        if let Some(content_type) = content_type {
            headers.push(("content-type".to_string(), content_type.to_string()));
        }
        headers.sort_by(|a, b| a.0.cmp(&b.0));

        let canonical_headers: String = headers
            .iter()
            .map(|(name, value)| format!("{name}:{}\n", value.trim()))
            .collect();
        let signed_headers: String = headers
            .iter()
            .map(|(name, _)| name.as_str())
            .collect::<Vec<&str>>()
            .join(";");

        let canonical_request = format!(
            "{}\n{}\n{}\n{}\n{}\n{}",
            method.as_str(),
            self.canonical_path(key),
            query,
            canonical_headers,
            signed_headers,
            payload_hash
        );
        let scope = format!("{date_stamp}/{}/s3/aws4_request", self.config.region);
        let string_to_sign = format!(
            "AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{}",
            sha256_hex(canonical_request.as_bytes())
        );

        let mut signing_key = hmac(
            format!("AWS4{}", self.config.secret_access_key).as_bytes(),
            &date_stamp,
        );
        signing_key = hmac(&signing_key, &self.config.region);
        signing_key = hmac(&signing_key, "s3");
        signing_key = hmac(&signing_key, "aws4_request");
        let signature = hex::encode(hmac(&signing_key, &string_to_sign));

        let authorization = format!(
            "AWS4-HMAC-SHA256 Credential={}/{scope}, SignedHeaders={signed_headers}, Signature={signature}",
            self.config.access_key_id
        );

        let mut request = self
            .client
            .request(method, self.url(key, query))
            .header("host", host)
            .header("x-amz-content-sha256", payload_hash)
            .header("x-amz-date", amz_date)
            .header("authorization", authorization);
        if let Some(content_type) = content_type {
            request = request.header("content-type", content_type);
        }
        request
            .body(body)
            .send()
            .await
            .map_err(|error| ApiError::internal(format!("object store request failed: {error}")))
    }

    pub async fn put(&self, key: &str, bytes: Vec<u8>, content_type: &str) -> ApiResult<()> {
        let response = self
            .send(reqwest::Method::PUT, key, "", bytes, Some(content_type))
            .await?;
        if !response.status().is_success() {
            return Err(ApiError::internal(format!(
                "object store rejected put of {key}: {}",
                response.status()
            )));
        }
        Ok(())
    }

    pub async fn get(&self, key: &str) -> ApiResult<Option<Vec<u8>>> {
        let response = self
            .send(reqwest::Method::GET, key, "", Vec::new(), None)
            .await?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(ApiError::internal(format!(
                "object store rejected get of {key}: {}",
                response.status()
            )));
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|error| ApiError::internal(format!("object store read failed: {error}")))?;
        Ok(Some(bytes.to_vec()))
    }

    pub async fn delete(&self, key: &str) -> ApiResult<()> {
        let response = self
            .send(reqwest::Method::DELETE, key, "", Vec::new(), None)
            .await?;
        if !response.status().is_success() && response.status() != reqwest::StatusCode::NOT_FOUND {
            return Err(ApiError::internal(format!(
                "object store rejected delete of {key}: {}",
                response.status()
            )));
        }
        Ok(())
    }

    /// Lists every key under a prefix, following continuation tokens.
    pub async fn list(&self, prefix: &str) -> ApiResult<Vec<String>> {
        let mut keys = Vec::new();
        let mut continuation: Option<String> = None;
        loop {
            let mut query = format!(
                "list-type=2&prefix={}",
                utf8_percent_encode(prefix, percent_encoding::NON_ALPHANUMERIC)
            );
            if let Some(token) = &continuation {
                query = format!(
                    "continuation-token={}&{query}",
                    utf8_percent_encode(token, percent_encoding::NON_ALPHANUMERIC)
                );
            }
            let response = self
                .send(reqwest::Method::GET, "", &query, Vec::new(), None)
                .await?;
            if !response.status().is_success() {
                return Err(ApiError::internal(format!(
                    "object store rejected list: {}",
                    response.status()
                )));
            }
            let body = response
                .text()
                .await
                .map_err(|error| ApiError::internal(format!("object store list failed: {error}")))?;
            keys.extend(extract_tags(&body, "Key"));
            match extract_tags(&body, "NextContinuationToken").into_iter().next() {
                Some(token) => continuation = Some(token),
                None => break,
            }
        }
        Ok(keys)
    }

    pub async fn delete_prefix(&self, prefix: &str) -> ApiResult<()> {
        for key in self.list(prefix).await? {
            self.delete(&key).await?;
        }
        Ok(())
    }

    /// Creates the configured bucket when it is missing. Used only at boot.
    pub async fn ensure_bucket(&self) -> ApiResult<()> {
        let response = self
            .send(reqwest::Method::GET, "", "list-type=2&max-keys=0", Vec::new(), None)
            .await?;
        if response.status().is_success() {
            return Ok(());
        }
        if response.status() != reqwest::StatusCode::NOT_FOUND {
            return Err(ApiError::internal(format!(
                "object store is not ready: {}",
                response.status()
            )));
        }
        let created = self
            .send(reqwest::Method::PUT, "", "", Vec::new(), None)
            .await?;
        if created.status().is_success() {
            Ok(())
        } else {
            Err(ApiError::internal(format!(
                "object store could not create the bucket: {}",
                created.status()
            )))
        }
    }
}

fn extract_tags(xml: &str, tag: &str) -> Vec<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let mut values = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find(&open) {
        let after = &rest[start + open.len()..];
        match after.find(&close) {
            Some(end) => {
                values.push(unescape(&after[..end]));
                rest = &after[end + close.len()..];
            }
            None => break,
        }
    }
    values
}

fn unescape(text: &str) -> String {
    text.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}
