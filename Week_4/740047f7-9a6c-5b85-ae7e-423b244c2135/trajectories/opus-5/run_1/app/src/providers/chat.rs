use crate::domain::copilot::ToolCall;
use serde_json::Value;
use std::time::Duration;

const TIMEOUT: Duration = Duration::from_secs(20);

pub struct ChatReply {
    pub content: Option<String>,
    pub tool_calls: Vec<ToolCall>,
}

pub enum ChatOutcome {
    Reply(ChatReply),
    Unavailable { timed_out: bool },
}

/// `POST <WIREMOCK_URL>/v1/chat/completions`, with no credentials and no
/// Authorization header.
pub async fn complete(
    client: &reqwest::Client,
    base_url: &str,
    body: &Value,
) -> ChatOutcome {
    let request = client
        .post(format!("{base_url}/v1/chat/completions"))
        .header("content-type", "application/json")
        .body(serde_json::to_vec(body).unwrap_or_default());
    let response = match tokio::time::timeout(TIMEOUT, request.send()).await {
        Err(_) => return ChatOutcome::Unavailable { timed_out: true },
        Ok(Err(error)) if error.is_timeout() => {
            return ChatOutcome::Unavailable { timed_out: true }
        }
        Ok(Err(_)) => return ChatOutcome::Unavailable { timed_out: false },
        Ok(Ok(response)) => response,
    };
    if !response.status().is_success() {
        return ChatOutcome::Unavailable { timed_out: false };
    }
    let payload = match tokio::time::timeout(TIMEOUT, response.json::<Value>()).await {
        Err(_) => return ChatOutcome::Unavailable { timed_out: true },
        Ok(Err(_)) => return ChatOutcome::Unavailable { timed_out: false },
        Ok(Ok(payload)) => payload,
    };
    match read(&payload) {
        Some(reply) => ChatOutcome::Reply(reply),
        None => ChatOutcome::Unavailable { timed_out: false },
    }
}

fn read(payload: &Value) -> Option<ChatReply> {
    let message = payload
        .get("choices")?
        .as_array()?
        .first()?
        .get("message")?
        .as_object()?;
    let content = match message.get("content") {
        Some(Value::String(text)) => Some(text.clone()),
        Some(Value::Null) | None => None,
        Some(_) => return None,
    };
    let tool_calls = message
        .get("tool_calls")
        .and_then(Value::as_array)
        .map(|calls| {
            calls
                .iter()
                .map(|call| ToolCall {
                    id: call
                        .get("id")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    name: call
                        .get("function")
                        .and_then(|function| function.get("name"))
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    arguments: call
                        .get("function")
                        .and_then(|function| function.get("arguments"))
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                })
                .collect()
        })
        .unwrap_or_default();
    Some(ChatReply {
        content,
        tool_calls,
    })
}
