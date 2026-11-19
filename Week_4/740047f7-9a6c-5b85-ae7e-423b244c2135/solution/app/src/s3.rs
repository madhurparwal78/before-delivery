//! A minimal S3 client (path style, plain HTTP, SigV4) for MinIO objects.

use hmac::{Hmac, KeyInit, Mac};
use reqwest::Method;
use sha2::{Digest, Sha256};

type HmacSha256 = Hmac<Sha256>;

pub struct S3 {
    http: reqwest::Client,
    endpoint: String,
    host: String,
    region: String,
    pub bucket: String,
    key_id: String,
    secret: String,
}

fn hmac(key: &[u8], data: &str) -> Vec<u8> {
    let mut mac = <HmacSha256 as KeyInit>::new_from_slice(key).expect("hmac accepts any key length");
    mac.update(data.as_bytes());
    mac.finalize().into_bytes().to_vec()
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn encode_path(path: &str) -> String {
    let mut out = String::new();
    for byte in path.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => out.push(byte as char),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn encode_query(text: &str) -> String {
    encode_path(text).replace('/', "%2F")
}

impl S3 {
    pub fn new(endpoint: &str, region: &str, bucket: &str, key_id: &str, secret: &str) -> Result<S3, String> {
        let host = endpoint.split_once("://").map(|(_, h)| h).unwrap_or(endpoint).split('/').next().unwrap_or("").to_string();
        let http = reqwest::Client::builder().build().map_err(|e| e.to_string())?;
        Ok(S3 {
            http,
            endpoint: endpoint.to_string(),
            host,
            region: region.to_string(),
            bucket: bucket.to_string(),
            key_id: key_id.to_string(),
            secret: secret.to_string(),
        })
    }

    async fn send(&self, method: Method, path: &str, query: &[(&str, String)], body: Vec<u8>, content_type: Option<&str>)
        -> Result<(u16, Vec<u8>), String> {
        let now = chrono::Utc::now();
        let (stamp, day) = (now.format("%Y%m%dT%H%M%SZ").to_string(), now.format("%Y%m%d").to_string());
        let payload_hash = sha256_hex(&body);
        let mut sorted: Vec<(String, String)> = query.iter().map(|(k, v)| (encode_query(k), encode_query(v))).collect();
        sorted.sort();
        let canonical_query = sorted.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("&");
        let canonical_path = encode_path(path);
        let headers = format!("host:{}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{stamp}\n", self.host);
        let signed = "host;x-amz-content-sha256;x-amz-date";
        let canonical = format!("{}\n{canonical_path}\n{canonical_query}\n{headers}\n{signed}\n{payload_hash}", method.as_str());
        let scope = format!("{day}/{}/s3/aws4_request", self.region);
        let to_sign = format!("AWS4-HMAC-SHA256\n{stamp}\n{scope}\n{}", sha256_hex(canonical.as_bytes()));
        let mut key = hmac(format!("AWS4{}", self.secret).as_bytes(), &day);
        for part in [self.region.as_str(), "s3", "aws4_request"] {
            key = hmac(&key, part);
        }
        let signature = hex::encode(hmac(&key, &to_sign));
        let authorization = format!(
            "AWS4-HMAC-SHA256 Credential={}/{scope}, SignedHeaders={signed}, Signature={signature}",
            self.key_id
        );
        let url = format!("{}{canonical_path}{}", self.endpoint, if canonical_query.is_empty() { String::new() } else { format!("?{canonical_query}") });
        let mut request = self
            .http
            .request(method, url)
            .header("x-amz-date", stamp)
            .header("x-amz-content-sha256", payload_hash)
            .header("authorization", authorization);
        if let Some(kind) = content_type {
            request = request.header("content-type", kind);
        }
        let response = request.body(body).send().await.map_err(|e| e.to_string())?;
        let status = response.status().as_u16();
        let bytes = response.bytes().await.map_err(|e| e.to_string())?;
        Ok((status, bytes.to_vec()))
    }

    pub async fn ensure_bucket(&self) -> Result<(), String> {
        let (status, _) = self.send(Method::HEAD, &format!("/{}", self.bucket), &[], vec![], None).await?;
        if status == 200 {
            return Ok(());
        }
        let (created, body) = self.send(Method::PUT, &format!("/{}", self.bucket), &[], vec![], None).await?;
        if created == 200 || created == 409 {
            Ok(())
        } else {
            Err(format!("bucket {} unavailable: {created} {}", self.bucket, String::from_utf8_lossy(&body)))
        }
    }

    pub async fn put(&self, key: &str, bytes: Vec<u8>, content_type: &str) -> Result<(), String> {
        let (status, body) = self.send(Method::PUT, &format!("/{}/{key}", self.bucket), &[], bytes, Some(content_type)).await?;
        if status == 200 {
            Ok(())
        } else {
            Err(format!("put {key}: {status} {}", String::from_utf8_lossy(&body)))
        }
    }

    pub async fn get(&self, key: &str) -> Result<Option<Vec<u8>>, String> {
        let (status, body) = self.send(Method::GET, &format!("/{}/{key}", self.bucket), &[], vec![], None).await?;
        match status {
            200 => Ok(Some(body)),
            404 => Ok(None),
            _ => Err(format!("get {key}: {status}")),
        }
    }

    pub async fn delete(&self, key: &str) -> Result<(), String> {
        let (status, _) = self.send(Method::DELETE, &format!("/{}/{key}", self.bucket), &[], vec![], None).await?;
        if status == 204 || status == 200 || status == 404 {
            Ok(())
        } else {
            Err(format!("delete {key}: {status}"))
        }
    }

    pub async fn delete_prefix(&self, prefix: &str) -> Result<(), String> {
        loop {
            let query = [("list-type", "2".to_string()), ("prefix", prefix.to_string())];
            let (status, body) = self.send(Method::GET, &format!("/{}", self.bucket), &query, vec![], None).await?;
            if status != 200 {
                return Err(format!("list {prefix}: {status}"));
            }
            let text = String::from_utf8_lossy(&body).into_owned();
            let keys: Vec<String> = text.split("<Key>").skip(1).filter_map(|part| part.split("</Key>").next()).map(String::from).collect();
            if keys.is_empty() {
                return Ok(());
            }
            for key in keys {
                self.delete(&key).await?;
            }
        }
    }
}
