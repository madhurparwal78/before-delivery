use std::env;

#[derive(Clone)]
pub struct Config {
    pub database_url: String,
    pub s3_endpoint: String,
    pub s3_region: String,
    pub s3_bucket: String,
    pub s3_force_path_style: bool,
    pub s3_access_key_id: String,
    pub s3_secret_access_key: String,
    pub valkey_url: String,
    pub wiremock_url: String,
    pub app_public_port: u16,
    pub app_public_url: Option<String>,
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let get = |k: &str| env::var(k).ok().filter(|v| !v.is_empty());
        Ok(Config {
            database_url: get("DATABASE_URL").ok_or("DATABASE_URL is not set")?,
            s3_endpoint: get("S3_ENDPOINT").ok_or("S3_ENDPOINT is not set")?,
            s3_region: get("S3_REGION").unwrap_or_else(|| "us-east-1".into()),
            s3_bucket: get("S3_BUCKET").ok_or("S3_BUCKET is not set")?,
            s3_force_path_style: get("S3_FORCE_PATH_STYLE").map(|v| v != "false").unwrap_or(true),
            s3_access_key_id: get("S3_ACCESS_KEY_ID").ok_or("S3_ACCESS_KEY_ID is not set")?,
            s3_secret_access_key: get("S3_SECRET_ACCESS_KEY").ok_or("S3_SECRET_ACCESS_KEY is not set")?,
            valkey_url: get("VALKEY_URL").ok_or("VALKEY_URL is not set")?,
            wiremock_url: get("WIREMOCK_URL").ok_or("WIREMOCK_URL is not set")?,
            app_public_port: get("APP_PUBLIC_PORT").and_then(|v| v.parse().ok()).unwrap_or(4173),
            app_public_url: get("APP_PUBLIC_URL"),
        })
    }

    /// The origin this app treats as its own, when APP_PUBLIC_URL is set.
    pub fn public_origin(&self) -> Option<String> {
        self.app_public_url.as_ref().map(|u| {
            let t = u.trim_end_matches('/');
            let scheme_end = t.find("://").map(|i| i + 3).unwrap_or(0);
            t[scheme_end..].split('/').next().map(|host| format!("{}://{}", t.split("://").next().unwrap_or("http"), host)).unwrap_or_else(|| t.to_string())
        })
    }
}

/// (host, path, port, scheme, password) of a service URL.
pub fn parse_url_host(url: &str) -> Result<(String, String, u16, String, Option<String>), String> {
    let (scheme, rest) = url.split_once("://").ok_or("url must have a scheme")?;
    let (default_port, secure) = match scheme {
        "http" | "tcp" | "redis" => (80u16, false),
        "https" | "tls" | "rediss" => (443u16, true),
        _ => return Err(format!("unsupported scheme {scheme}")),
    };
    let rest_no_auth = match rest.rsplit_once('@') {
        Some((_, host_part)) => host_part.to_string(),
        None => rest.to_string(),
    };
    let (authority, path) = match rest_no_auth.split_once('/') {
        Some((a, p)) => (a.to_string(), format!("/{p}")),
        None => (rest_no_auth.clone(), "/".to_string()),
    };
    let (host, port) = match authority.rsplit_once(':') {
        Some((h, p)) => (h.to_string(), p.parse().unwrap_or(default_port)),
        None => (authority.clone(), default_port),
    };
    let password = rest.split_once('@').and_then(|(userinfo, _)| {
        userinfo.split_once(':').map(|(_, p)| urldecode(p)).filter(|p| !p.is_empty())
    });
    Ok((
        host,
        path.trim_end_matches('/').to_string(),
        port,
        if secure { "https".into() } else { "http".into() },
        password,
    ))
}

fn urldecode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(h) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(h);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}


/// (host, port, user, password, db) of a Valkey URL.
pub fn parse_valkey_url(url: &str) -> Result<crate::infra::Valkey, String> {
    let (scheme, rest) = url.split_once("://").ok_or("valkey url must have a scheme")?;
    if !["redis", "rediss", "valkey", "tcp"].contains(&scheme) {
        return Err(format!("unsupported valkey scheme {scheme}"));
    }
    let (default_port, _secure) = if scheme == "rediss" { (443u16, true) } else { (6379u16, false) };
    let (userinfo, host_part) = match rest.rsplit_once('@') {
        Some((u, h)) => (Some(u.to_string()), h.to_string()),
        None => (None, rest.to_string()),
    };
    let (authority, path) = match host_part.split_once('/') {
        Some((a, p)) => (a.to_string(), p.to_string()),
        None => (host_part.clone(), String::new()),
    };
    let (host, port) = match authority.rsplit_once(':') {
        Some((h, p)) => (h.to_string(), p.parse().unwrap_or(default_port)),
        None => (authority.clone(), default_port),
    };
    let db = path.split('/').next().and_then(|d| d.parse().ok()).unwrap_or(0);
    let (user, password) = match &userinfo {
        Some(ui) => match ui.split_once(':') {
            Some((u, p)) => (Some(urldecode(u)), Some(urldecode(p)).filter(|p| !p.is_empty())),
            None => (Some(String::new()), Some(urldecode(ui))),
        },
        None => (None, None),
    };
    Ok(crate::infra::Valkey::with_parts(host, port, user, password, db))
}
