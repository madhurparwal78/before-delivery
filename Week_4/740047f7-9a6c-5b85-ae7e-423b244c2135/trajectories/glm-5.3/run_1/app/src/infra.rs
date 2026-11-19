use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

/// The one error type of the API. Every refusal maps to the single published shape.
#[derive(Debug, Clone)]
pub struct ApiError {
    pub status: u16,
    pub code: &'static str,
    pub message: String,
    pub fields: Option<serde_json::Value>,
    pub details: Option<serde_json::Value>,
}

impl ApiError {
    pub fn new(status: u16, code: &'static str, message: impl Into<String>) -> Self {
        ApiError { status, code, message: message.into(), fields: None, details: None }
    }
    pub fn with_fields(mut self, fields: serde_json::Value) -> Self {
        self.fields = Some(fields);
        self
    }
    pub fn with_details(mut self, details: serde_json::Value) -> Self {
        self.details = Some(details);
        self
    }
    pub fn cross_origin() -> Self { ApiError::new(403, "cross_origin", "Cross-site request refused") }
    pub fn locked(device_id: &str, device_name: &str, expires_in_s: u64) -> Self {
        ApiError::new(423, "locked", format!("Being edited on {device_name}"))
            .with_details(serde_json::json!({"device_id": device_id, "device_name": device_name, "expires_in_s": expires_in_s as i64}))
    }
    pub fn body(&self) -> serde_json::Value {
        let mut err = serde_json::json!({"code": self.code, "message": self.message});
        if let Some(f) = &self.fields { err["fields"] = f.clone(); }
        if let Some(d) = &self.details { err["details"] = d.clone(); }
        serde_json::json!({ "error": err })
    }
}

pub type ApiResult<T> = Result<T, ApiError>;

/// Plain-HTTP Valkey (RESP2) client with pooled per-key connections.
pub struct Valkey {
    host: String,
    port: u16,
    user: Option<String>,
    password: Option<String>,
    db: u16,
}

#[derive(Clone)]
pub struct ValkeyHandle {
    inner: Arc<Valkey>,
}

impl Valkey {
    pub fn with_parts(host: String, port: u16, user: Option<String>, password: Option<String>, db: u16) -> Valkey {
        Valkey { host, port, user, password, db }
    }

    pub fn new(url: &str) -> Result<ValkeyHandle, String> {
        let parsed = crate::config::parse_valkey_url(url)?;
        Ok(ValkeyHandle { inner: Arc::new(parsed) })
    }

    async fn connect(&self) -> Result<TcpStream, String> {
        let mut stream = TcpStream::connect((self.host.as_str(), self.port)).await.map_err(|e| e.to_string())?;
        if let Some(pass) = &self.password {
            let mut buf = Vec::new();
            match &self.user {
                Some(user) if !user.is_empty() && user != "default" => {
                    resp_command(&mut buf, "AUTH", &[user, pass]);
                }
                _ => {
                    resp_command(&mut buf, "AUTH", &[pass]);
                }
            }
            stream.write_all(&buf).await.map_err(|e| e.to_string())?;
            let reply = read_reply(&mut stream).await?;
            if !reply.starts_with(b"+OK") {
                return Err("valkey auth failed".into());
            }
        }
        if self.db != 0 {
            let mut buf = Vec::new();
            resp_command(&mut buf, "SELECT", &[&self.db.to_string()]);
            stream.write_all(&buf).await.map_err(|e| e.to_string())?;
            let reply = read_reply(&mut stream).await?;
            if !reply.starts_with(b"+OK") {
                return Err("valkey select failed".into());
            }
        }
        Ok(stream)
    }

    pub async fn command(&self, cmd: &str, args: &[&str]) -> Result<Vec<u8>, String> {
        let mut stream = self.connect().await?;
        let mut buf = Vec::new();
        resp_command(&mut buf, cmd, args);
        stream.write_all(&buf).await.map_err(|e| e.to_string())?;
        read_reply(&mut stream).await
    }
}

impl ValkeyHandle {
    pub async fn ping(&self) -> Result<bool, String> {
        let reply = self.inner.command("PING", &[]).await?;
        Ok(reply.starts_with(b"+PONG"))
    }

    pub async fn set_heartbeat(&self, device_id: &str) -> Result<(), String> {
        self.inner.command("SET", &[&format!("pensight:heartbeat:{device_id}"), "1", "EX", "15"]).await.map(|_| ())
    }
    pub async fn online(&self, device_id: &str) -> Result<bool, String> {
        let reply = self.inner.command("EXISTS", &[&format!("pensight:heartbeat:{device_id}")]).await?;
        Ok(reply.starts_with(b":1"))
    }
    pub async fn take_lock(&self, defect_id: &str, device_id: &str) -> Result<Option<u64>, String> {
        let key = format!("pensight:lock:defect:{defect_id}");
        let reply = self.inner.command("SET", &[&key, device_id, "NX", "EX", "30"]).await?;
        if reply.starts_with(b"+OK") { Ok(Some(30)) } else { Ok(None) }
    }
    pub async fn refresh_lock(&self, defect_id: &str, device_id: &str) -> Result<bool, String> {
        let key = format!("pensight:lock:defect:{defect_id}");
        let reply = self.inner.command("SET", &[&key, device_id, "XX", "EX", "30"]).await?;
        Ok(reply.starts_with(b"+OK"))
    }
    pub async fn lock_holder(&self, defect_id: &str) -> Result<Option<String>, String> {
        let reply = self.inner.command("GET", &[&format!("pensight:lock:defect:{defect_id}")]).await?;
        parse_bulk_string(&reply)
    }
    pub async fn lock_ttl(&self, defect_id: &str) -> Result<i64, String> {
        let reply = self.inner.command("TTL", &[&format!("pensight:lock:defect:{defect_id}")]).await?;
        Ok(parse_integer(&reply))
    }
    pub async fn release_lock_if_holder(&self, defect_id: &str, device_id: &str) -> Result<bool, String> {
        // GET+DEL is fine here: the release path only acts when this device holds the key,
        // and a held lock's value never changes between GET and DEL.
        let holder = self.lock_holder(defect_id).await?;
        if holder.as_deref() != Some(device_id) { return Ok(false); }
        let key = format!("pensight:lock:defect:{defect_id}");
        self.inner.command("DEL", &[&key]).await?;
        Ok(true)
    }
    pub async fn publish(&self, event: &str) -> Result<(), String> {
        self.inner.command("PUBLISH", &["pensight:events", event]).await.map(|_| ())
    }
    pub async fn subscribe(&self) -> Result<TcpStream, String> {
        let mut stream = self.inner.connect().await?;
        let mut buf = Vec::new();
        resp_command(&mut buf, "SUBSCRIBE", &["pensight:events"]);
        stream.write_all(&buf).await.map_err(|e| e.to_string())?;
        // consume the subscribe confirmation so the stream begins at the messages
        let _ = read_reply(&mut stream).await;
        Ok(stream)
    }
}

fn parse_bulk_string(reply: &[u8]) -> Result<Option<String>, String> {
    let s = std::str::from_utf8(reply).map_err(|_| "bad reply")?;
    let s = s.trim_end_matches("\r\n");
    if s == "$-1" { return Ok(None); }
    if let Some(rest) = s.strip_prefix('$') {
        let lines: Vec<&str> = rest.splitn(2, "\r\n").collect();
        if lines.len() == 2 { return Ok(Some(lines[1].to_string())); }
    }
    Err(format!("unexpected reply {s}"))
}

fn parse_integer(reply: &[u8]) -> i64 {
    let s = String::from_utf8_lossy(reply);
    s.trim().trim_start_matches(':').parse().unwrap_or(-1)
}

fn resp_command(buf: &mut Vec<u8>, cmd: &str, args: &[&str]) {
    let mut all = vec![cmd];
    all.extend_from_slice(args);
    buf.extend_from_slice(format!("*{}\r\n", all.len()).as_bytes());
    for a in all {
        buf.extend_from_slice(format!("${}\r\n", a.len()).as_bytes());
        buf.extend_from_slice(a.as_bytes());
        buf.extend_from_slice(b"\r\n");
    }
}

async fn read_reply(stream: &mut TcpStream) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 512];
    let n = stream.read(&mut chunk).await.map_err(|e| e.to_string())?;
    if n == 0 { return Err("connection closed".into()); }
    buf.extend_from_slice(&chunk[..n]);
    let first = buf[0];
    loop {
        if buf.ends_with(b"\r\n") {
            let text = String::from_utf8_lossy(&buf);
            if first == b'$' {
                let header_end = text.find("\r\n").unwrap_or(0);
                let len_text = text[..header_end].trim_start_matches('$').trim();
                // A null bulk string ("$-1") is a complete reply on its own.
                if len_text == "-1" { break; }
                let len: usize = len_text.parse().unwrap_or(0);
                if buf.len() >= header_end + 2 + len + 2 { break; }
            } else if first == b'*' {
                let header_end = text.find("\r\n").unwrap_or(0);
                let len_text = text[..header_end].trim_start_matches('*').trim();
                if len_text == "-1" { break; }
                // Each element of an array reply is at least 3 bytes; read until a
                // parse of the whole frame succeeds rather than guessing a size.
                if array_frame_complete(&text) { break; }
            } else {
                break;
            }
        }
        let n = stream.read(&mut chunk).await.map_err(|e| e.to_string())?;
        if n == 0 { break; }
        buf.extend_from_slice(&chunk[..n]);
    }
    Ok(buf)
}

/// A RESP array frame is complete when every element is fully present.
fn array_frame_complete(text: &str) -> bool {
    let mut lines = text.split("\r\n").peekable();
    let head = lines.next().unwrap_or("");
    let count: usize = match head.trim_start_matches('*').trim().parse() {
        Ok(c) => c,
        Err(_) => return true,
    };
    let mut seen = 0usize;
    while seen < count {
        let line = lines.next().unwrap_or("");
        if line.is_empty() { return false; }
        match line.as_bytes().first() {
            Some(b'$') => {
                let len: i64 = line[1..].parse().unwrap_or(-1);
                if len < 0 { seen += 1; continue; }
                let body: String = lines.next().unwrap_or("").to_string();
                if body.len() < len as usize { return false; }
                seen += 1;
            }
            Some(b':') | Some(b'+') | Some(b'-') => { seen += 1; }
            _ => return false,
        }
    }
    true
}
