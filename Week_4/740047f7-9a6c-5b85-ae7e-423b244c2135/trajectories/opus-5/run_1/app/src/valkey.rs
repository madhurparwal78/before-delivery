use crate::error::{ApiError, ApiResult};
use redis::AsyncCommands;
use serde_json::Value;
use tokio::sync::broadcast;

pub const HEARTBEAT_TTL_S: i64 = 15;
pub const LOCK_TTL_S: i64 = 30;
pub const EVENT_CHANNEL: &str = "pensight:events";

fn heartbeat_key(device_id: &str) -> String {
    format!("pensight:heartbeat:{device_id}")
}

fn lock_key(defect_id: &str) -> String {
    format!("pensight:lock:defect:{defect_id}")
}

#[derive(Clone, Debug)]
pub struct EditLock {
    pub device_id: String,
    pub expires_in_s: i64,
}

/// Valkey holds presence heartbeats, the short-lived defect edit locks and the
/// live broadcast between the inspector's two devices.
#[derive(Clone)]
pub struct Live {
    client: redis::Client,
    pub events: broadcast::Sender<String>,
}

impl Live {
    pub fn connect(url: &str) -> ApiResult<Live> {
        let client = redis::Client::open(url)
            .map_err(|error| ApiError::internal(format!("valkey url is not usable: {error}")))?;
        let (events, _) = broadcast::channel(256);
        Ok(Live { client, events })
    }

    async fn connection(&self) -> ApiResult<redis::aio::MultiplexedConnection> {
        Ok(self.client.get_multiplexed_async_connection().await?)
    }

    pub async fn ping(&self) -> ApiResult<()> {
        let mut connection = self.connection().await?;
        redis::cmd("PING")
            .query_async::<String>(&mut connection)
            .await?;
        Ok(())
    }

    pub async fn heartbeat(&self, device_id: &str) -> ApiResult<()> {
        let mut connection = self.connection().await?;
        connection
            .set_ex::<_, _, ()>(heartbeat_key(device_id), "1", HEARTBEAT_TTL_S as u64)
            .await?;
        Ok(())
    }

    pub async fn online(&self, device_ids: &[String]) -> ApiResult<Vec<bool>> {
        let mut connection = self.connection().await?;
        let mut online = Vec::with_capacity(device_ids.len());
        for device_id in device_ids {
            let present: bool = connection.exists(heartbeat_key(device_id)).await?;
            online.push(present);
        }
        Ok(online)
    }

    pub async fn lock_holder(&self, defect_id: &str) -> ApiResult<Option<EditLock>> {
        let mut connection = self.connection().await?;
        let key = lock_key(defect_id);
        let holder: Option<String> = connection.get(&key).await?;
        let Some(device_id) = holder else {
            return Ok(None);
        };
        let ttl: i64 = connection.ttl(&key).await?;
        Ok(Some(EditLock {
            device_id,
            expires_in_s: ttl.max(0),
        }))
    }

    pub async fn lock_holders(&self, defect_ids: &[String]) -> ApiResult<Vec<(String, EditLock)>> {
        let mut held = Vec::new();
        for defect_id in defect_ids {
            if let Some(lock) = self.lock_holder(defect_id).await? {
                held.push((defect_id.clone(), lock));
            }
        }
        Ok(held)
    }

    /// Takes the lock for 30 seconds. The holder calling again refreshes it.
    pub async fn take_lock(&self, defect_id: &str, device_id: &str) -> ApiResult<Result<i64, EditLock>> {
        let mut connection = self.connection().await?;
        let key = lock_key(defect_id);
        let taken: Option<String> = redis::cmd("SET")
            .arg(&key)
            .arg(device_id)
            .arg("NX")
            .arg("EX")
            .arg(LOCK_TTL_S)
            .query_async(&mut connection)
            .await?;
        if taken.is_some() {
            return Ok(Ok(LOCK_TTL_S));
        }
        let holder: Option<String> = connection.get(&key).await?;
        match holder {
            Some(holder) if holder == device_id => {
                connection
                    .set_ex::<_, _, ()>(&key, device_id, LOCK_TTL_S as u64)
                    .await?;
                Ok(Ok(LOCK_TTL_S))
            }
            Some(holder) => {
                let ttl: i64 = connection.ttl(&key).await?;
                Ok(Err(EditLock {
                    device_id: holder,
                    expires_in_s: ttl.max(0),
                }))
            }
            None => {
                connection
                    .set_ex::<_, _, ()>(&key, device_id, LOCK_TTL_S as u64)
                    .await?;
                Ok(Ok(LOCK_TTL_S))
            }
        }
    }

    pub async fn release_lock(&self, defect_id: &str, device_id: &str) -> ApiResult<()> {
        let mut connection = self.connection().await?;
        let script = redis::Script::new(
            "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        );
        script
            .key(lock_key(defect_id))
            .arg(device_id)
            .invoke_async::<i64>(&mut connection)
            .await?;
        Ok(())
    }

    pub async fn release_locks(&self, defect_ids: &[String]) -> ApiResult<()> {
        let mut connection = self.connection().await?;
        for defect_id in defect_ids {
            connection.del::<_, ()>(lock_key(defect_id)).await?;
        }
        Ok(())
    }

    pub async fn publish(&self, event: &Value) -> ApiResult<()> {
        let payload = serde_json::to_string(event)?;
        let mut connection = self.connection().await?;
        connection
            .publish::<_, _, ()>(EVENT_CHANNEL, payload)
            .await?;
        Ok(())
    }

    /// Relays every broadcast change to the open consoles over a same-origin
    /// stream.
    pub fn spawn_relay(&self) {
        let client = self.client.clone();
        let sender = self.events.clone();
        tokio::spawn(async move {
            loop {
                match client.get_async_pubsub().await {
                    Ok(mut pubsub) => {
                        if pubsub.subscribe(EVENT_CHANNEL).await.is_ok() {
                            use futures_util::StreamExt;
                            let mut stream = pubsub.on_message();
                            while let Some(message) = stream.next().await {
                                if let Ok(payload) = message.get_payload::<String>() {
                                    let _ = sender.send(payload);
                                }
                            }
                        }
                    }
                    Err(_) => {}
                }
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            }
        });
    }
}
