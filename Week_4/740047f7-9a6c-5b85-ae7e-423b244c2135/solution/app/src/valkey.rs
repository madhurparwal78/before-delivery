//! A small RESP client for Valkey: heartbeats, edit locks, the live-update channel.

use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio::time::timeout;

pub const EVENT_CHANNEL: &str = "pensight:events";
const IO_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone)]
pub enum Resp {
    Text(String),
    Int(i64),
    Bulk(Option<Vec<u8>>),
    Array(Vec<Resp>),
}

impl Resp {
    pub fn string(&self) -> Option<String> {
        match self {
            Resp::Bulk(Some(bytes)) => Some(String::from_utf8_lossy(bytes).into_owned()),
            Resp::Text(text) => Some(text.clone()),
            _ => None,
        }
    }
    pub fn int(&self) -> Option<i64> {
        if let Resp::Int(n) = self {
            Some(*n)
        } else {
            None
        }
    }
}

struct Connection {
    stream: BufReader<TcpStream>,
}

fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(value) = u8::from_str_radix(&text[i + 1..i + 3], 16) {
                out.push(value);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub struct Valkey {
    address: String,
    user: Option<String>,
    password: Option<String>,
    database: u32,
    idle: Mutex<Vec<Connection>>,
}

fn encode(args: &[Vec<u8>]) -> Vec<u8> {
    let mut out = format!("*{}\r\n", args.len()).into_bytes();
    for arg in args {
        out.extend(format!("${}\r\n", arg.len()).bytes());
        out.extend(arg);
        out.extend(b"\r\n");
    }
    out
}

async fn read_reply(stream: &mut BufReader<TcpStream>) -> Result<Resp, String> {
    let mut line = String::new();
    if stream.read_line(&mut line).await.map_err(|e| e.to_string())? == 0 {
        return Err("connection closed".into());
    }
    let Some(&kind) = line.as_bytes().first() else { return Err("empty reply".into()) };
    let rest = line.get(1..).unwrap_or("").trim_end().to_string();
    match kind {
        b'+' => Ok(Resp::Text(rest)),
        b'-' => Err(rest),
        b':' => Ok(Resp::Int(rest.parse().map_err(|_| "bad integer".to_string())?)),
        b'$' => {
            let length: i64 = rest.parse().map_err(|_| "bad length".to_string())?;
            if length < 0 {
                return Ok(Resp::Bulk(None));
            }
            let mut buffer = vec![0u8; length as usize + 2];
            stream.read_exact(&mut buffer).await.map_err(|e| e.to_string())?;
            buffer.truncate(length as usize);
            Ok(Resp::Bulk(Some(buffer)))
        }
        b'*' => {
            let count: i64 = rest.parse().map_err(|_| "bad count".to_string())?;
            let mut items = vec![];
            for _ in 0..count.max(0) {
                items.push(Box::pin(read_reply(stream)).await?);
            }
            Ok(Resp::Array(items))
        }
        _ => Err("unexpected reply".into()),
    }
}

impl Valkey {
    pub fn new(url: &str) -> Result<Valkey, String> {
        let rest = url.strip_prefix("redis://").ok_or("VALKEY_URL must start with redis://")?;
        let (auth, host) = rest.rsplit_once('@').map(|(a, h)| (Some(a), h)).unwrap_or((None, rest));
        let (address, database) = host.split_once('/').unwrap_or((host, "0"));
        let (user, password) = match auth.map(|a| a.split_once(':').unwrap_or(("", a))) {
            Some((u, p)) => (Some(u).filter(|u| !u.is_empty()).map(percent_decode), Some(percent_decode(p))),
            None => (None, None),
        };
        Ok(Valkey {
            address: if address.contains(':') { address.to_string() } else { format!("{address}:6379") },
            user,
            password,
            database: database.parse().unwrap_or(0),
            idle: Mutex::new(vec![]),
        })
    }

    async fn connect(&self) -> Result<Connection, String> {
        let stream = timeout(IO_TIMEOUT, TcpStream::connect(&self.address))
            .await
            .map_err(|_| "connect timed out".to_string())?
            .map_err(|e| e.to_string())?;
        let mut connection = Connection { stream: BufReader::new(stream) };
        if let Some(password) = &self.password {
            let mut auth = vec![b"AUTH".to_vec()];
            if let Some(user) = &self.user {
                auth.push(user.clone().into_bytes());
            }
            auth.push(password.clone().into_bytes());
            Self::send(&mut connection, &[auth]).await?;
        }
        if self.database != 0 {
            Self::send(&mut connection, &[vec![b"SELECT".to_vec(), self.database.to_string().into_bytes()]]).await?;
        }
        Ok(connection)
    }

    async fn send(connection: &mut Connection, commands: &[Vec<Vec<u8>>]) -> Result<Vec<Resp>, String> {
        let mut payload = vec![];
        for command in commands {
            payload.extend(encode(command));
        }
        let io = async {
            connection.stream.get_mut().write_all(&payload).await.map_err(|e| e.to_string())?;
            let mut replies = vec![];
            for _ in commands {
                replies.push(read_reply(&mut connection.stream).await?);
            }
            Ok(replies)
        };
        timeout(IO_TIMEOUT, io).await.map_err(|_| "valkey timed out".to_string())?
    }

    pub async fn pipeline(&self, commands: Vec<Vec<Vec<u8>>>) -> Result<Vec<Resp>, String> {
        let pooled = self.idle.lock().await.pop();
        let mut connection = match pooled {
            Some(c) => c,
            None => self.connect().await?,
        };
        let replies = Self::send(&mut connection, &commands).await;
        if replies.is_ok() {
            self.idle.lock().await.push(connection);
        }
        replies
    }

    pub async fn cmd(&self, args: &[&str]) -> Result<Resp, String> {
        let command = args.iter().map(|a| a.as_bytes().to_vec()).collect();
        Ok(self.pipeline(vec![command]).await?.remove(0))
    }

    pub async fn ping(&self) -> Result<(), String> {
        self.cmd(&["PING"]).await.map(|_| ())
    }

    pub async fn publish(&self, payload: &str) {
        if let Err(error) = self.cmd(&["PUBLISH", EVENT_CHANNEL, payload]).await {
            eprintln!("publish failed: {error}");
        }
    }

    /// Reads events from one subscription until the connection fails.
    async fn listen(&self, on_event: &impl Fn(String)) -> Result<std::convert::Infallible, String> {
        let mut connection = self.connect().await?;
        connection
            .stream
            .get_mut()
            .write_all(&encode(&[b"SUBSCRIBE".to_vec(), EVENT_CHANNEL.as_bytes().to_vec()]))
            .await
            .map_err(|e| e.to_string())?;
        loop {
            if let Resp::Array(items) = read_reply(&mut connection.stream).await? {
                if items.first().and_then(Resp::string).as_deref() == Some("message") {
                    if let Some(payload) = items.get(2).and_then(Resp::string) {
                        on_event(payload);
                    }
                }
            }
        }
    }

    /// Hands every event payload to `on_event`; reconnects forever.
    pub async fn subscribe_forever(&self, on_event: impl Fn(String)) {
        loop {
            let Err(error) = self.listen(&on_event).await;
            eprintln!("event subscription lost: {error}");
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    }
}
