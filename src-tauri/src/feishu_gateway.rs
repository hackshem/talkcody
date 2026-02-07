use open_lark::client::ws_client::LarkWsClient;
use open_lark::prelude::{
    AppType, CreateMessageRequest, CreateMessageRequestBody, EventDispatcherHandler, LarkClient,
};
use open_lark::service::im::v1::message::UpdateMessageRequest;
use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tokio::runtime::Builder;
use tokio::sync::{watch, Mutex};
use tokio::time::sleep;

const FEISHU_ATTACHMENTS_DIR: &str = "attachments";
const FEISHU_MEDIA_PREFIX: &str = "feishu";
const DEFAULT_ERROR_BACKOFF_MS: u64 = 1500;
const MAX_ERROR_BACKOFF_MS: u64 = 30000;
const MAX_FEISHU_MEDIA_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeishuConfig {
    pub enabled: bool,
    pub app_id: String,
    pub app_secret: String,
    pub encrypt_key: String,
    pub verification_token: String,
    pub allowed_open_ids: Vec<String>,
}

impl Default for FeishuConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            app_id: String::new(),
            app_secret: String::new(),
            encrypt_key: String::new(),
            verification_token: String::new(),
            allowed_open_ids: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeishuRemoteAttachment {
    pub id: String,
    pub attachment_type: String,
    pub file_path: String,
    pub filename: String,
    pub mime_type: String,
    pub size: u64,
    pub duration_seconds: Option<u32>,
    pub caption: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeishuInboundMessage {
    pub chat_id: String,
    pub message_id: String,
    pub text: String,
    pub open_id: String,
    pub date: i64,
    pub attachments: Option<Vec<FeishuRemoteAttachment>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeishuSendMessageRequest {
    pub open_id: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeishuSendMessageResponse {
    pub message_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeishuEditMessageRequest {
    pub message_id: String,
    pub text: String,
}

#[derive(Debug)]
pub struct FeishuGateway {
    config: FeishuConfig,
    running: bool,
    last_event_at_ms: Option<i64>,
    last_error: Option<String>,
    last_error_at_ms: Option<i64>,
    backoff_ms: u64,
    stop_tx: Option<watch::Sender<bool>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FeishuSenderKind {
    User,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FeishuChatKind {
    P2p,
    Other,
}

impl FeishuGateway {
    pub fn new() -> Self {
        Self {
            config: FeishuConfig::default(),
            running: false,
            last_event_at_ms: None,
            last_error: None,
            last_error_at_ms: None,
            backoff_ms: DEFAULT_ERROR_BACKOFF_MS,
            stop_tx: None,
        }
    }
}

type FeishuGatewayState = Arc<Mutex<FeishuGateway>>;

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn record_error_state(state: &mut FeishuGateway, message: impl Into<String>) {
    state.last_error = Some(message.into());
    state.last_error_at_ms = Some(now_ms());
}

fn clear_error_state(state: &mut FeishuGateway) {
    state.last_error = None;
    state.last_error_at_ms = None;
    state.backoff_ms = DEFAULT_ERROR_BACKOFF_MS;
}

fn compute_backoff_ms(current: u64) -> u64 {
    let jitter = rand::thread_rng().gen_range(0..250u64);
    let next = current.saturating_mul(2).saturating_add(jitter);
    next.clamp(DEFAULT_ERROR_BACKOFF_MS, MAX_ERROR_BACKOFF_MS)
}

fn build_client(config: &FeishuConfig) -> Result<LarkClient, String> {
    if config.app_id.is_empty() || config.app_secret.is_empty() {
        return Err("Feishu app_id/app_secret not configured".to_string());
    }

    let client = LarkClient::builder(&config.app_id, &config.app_secret)
        .with_app_type(AppType::SelfBuild)
        .with_enable_token_cache(true)
        .build();

    Ok(client)
}

fn is_open_id_allowed(allowed_open_ids: &[String], open_id: &str) -> bool {
    if allowed_open_ids.is_empty() {
        return true;
    }
    allowed_open_ids.iter().any(|id| id == open_id)
}

fn sender_kind(sender_type: &str) -> FeishuSenderKind {
    if sender_type == "user" {
        FeishuSenderKind::User
    } else {
        FeishuSenderKind::Other
    }
}

fn chat_kind(chat_type: &str) -> FeishuChatKind {
    if chat_type == "p2p" {
        FeishuChatKind::P2p
    } else {
        FeishuChatKind::Other
    }
}

async fn attachments_root<R: Runtime>(
    app_handle: &AppHandle<R>,
) -> Result<Option<PathBuf>, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(Some(app_data_dir.join(FEISHU_ATTACHMENTS_DIR)))
}

async fn save_attachment_file(
    attachments_dir: &PathBuf,
    filename: &str,
    data: &[u8],
) -> Result<String, String> {
    tokio::fs::create_dir_all(attachments_dir)
        .await
        .map_err(|e| format!("Failed to create attachments dir: {}", e))?;
    let target_path = attachments_dir.join(filename);
    tokio::fs::write(&target_path, data)
        .await
        .map_err(|e| format!("Failed to write attachment: {}", e))?;
    Ok(target_path.to_string_lossy().to_string())
}

fn build_attachment_filename(prefix: &str, original_name: Option<&str>, suffix: &str) -> String {
    let safe_name = original_name
        .map(|name| name.replace('/', "_"))
        .unwrap_or_else(|| format!("{}-{}", prefix, suffix));
    if safe_name.contains('.') {
        safe_name
    } else {
        format!("{}.bin", safe_name)
    }
}

fn parse_text_content(content: &str) -> String {
    serde_json::from_str::<Value>(content)
        .ok()
        .and_then(|value| {
            value
                .get("text")
                .and_then(|text| text.as_str())
                .map(String::from)
        })
        .unwrap_or_else(|| content.to_string())
}

async fn build_message_payload(
    app_handle: &AppHandle,
    client: &LarkClient,
    message_type: &str,
    content: &str,
    message_id: &str,
) -> Result<(String, Vec<FeishuRemoteAttachment>), String> {
    let mut text_parts: Vec<String> = Vec::new();
    let mut attachments: Vec<FeishuRemoteAttachment> = Vec::new();

    let parsed = serde_json::from_str::<Value>(content).ok();

    if message_type == "text" {
        text_parts.push(parse_text_content(content));
    } else if let Some(text) = parsed
        .as_ref()
        .and_then(|value| value.get("text"))
        .and_then(|value| value.as_str())
    {
        text_parts.push(text.to_string());
    }

    let Some(attachments_dir) = attachments_root(app_handle).await? else {
        return Ok((text_parts.join("\n"), attachments));
    };

    if message_type == "image" {
        if let Some(image_key) = parsed
            .as_ref()
            .and_then(|value| value.get("image_key"))
            .and_then(|value| value.as_str())
        {
            let image_data = client
                .im
                .v1
                .image
                .get(image_key, None)
                .await
                .map_err(|e| format!("Feishu image download failed: {e:?}"))?;
            let size = image_data.data.len() as u64;
            if size <= MAX_FEISHU_MEDIA_BYTES {
                let filename = build_attachment_filename(
                    FEISHU_MEDIA_PREFIX,
                    Some(&format!("image-{}", image_key)),
                    "image",
                );
                let saved_path =
                    save_attachment_file(&attachments_dir, &filename, &image_data.data).await?;
                attachments.push(FeishuRemoteAttachment {
                    id: image_key.to_string(),
                    attachment_type: "image".to_string(),
                    file_path: saved_path,
                    filename,
                    mime_type: "image/png".to_string(),
                    size,
                    duration_seconds: None,
                    caption: None,
                });
            }
        }
    }

    if message_type == "file" || message_type == "audio" || message_type == "media" {
        if let Some(file_key) = parsed
            .as_ref()
            .and_then(|value| value.get("file_key"))
            .and_then(|value| value.as_str())
        {
            let file_data = client
                .im
                .v1
                .file
                .get(file_key, None)
                .await
                .map_err(|e| format!("Feishu file download failed: {e:?}"))?;
            let size = file_data.data.len() as u64;
            if size <= MAX_FEISHU_MEDIA_BYTES {
                let filename_from_content = parsed
                    .as_ref()
                    .and_then(|value| value.get("file_name"))
                    .and_then(|value| value.as_str());
                let filename = build_attachment_filename(
                    FEISHU_MEDIA_PREFIX,
                    filename_from_content.or(Some(&format!("file-{}", file_key))),
                    message_type,
                );
                let saved_path =
                    save_attachment_file(&attachments_dir, &filename, &file_data.data).await?;
                let attachment_type = if message_type == "audio" {
                    "audio"
                } else {
                    "file"
                };
                let caption = filename_from_content.map(|name| name.to_string());
                attachments.push(FeishuRemoteAttachment {
                    id: file_key.to_string(),
                    attachment_type: attachment_type.to_string(),
                    file_path: saved_path,
                    filename,
                    mime_type: if message_type == "audio" {
                        "audio/mpeg".to_string()
                    } else {
                        "application/octet-stream".to_string()
                    },
                    size,
                    duration_seconds: None,
                    caption,
                });
            }
        }
    }

    if message_type == "file" && attachments.is_empty() {
        text_parts.push(format!("[file: {}]", message_id));
    }

    Ok((text_parts.join("\n").trim().to_string(), attachments))
}

async fn run_ws_loop(
    app_handle: AppHandle,
    state: FeishuGatewayState,
    stop_rx: watch::Receiver<bool>,
) {
    loop {
        if stop_rx.has_changed().unwrap_or(false) && *stop_rx.borrow() {
            break;
        }

        let (config, running, backoff_ms) = {
            let gateway = state.lock().await;
            (gateway.config.clone(), gateway.running, gateway.backoff_ms)
        };

        if !running {
            break;
        }

        if !config.enabled || config.app_id.is_empty() || config.app_secret.is_empty() {
            log::debug!(
                "[FeishuGateway] Skipping ws loop tick (enabled={}, app_id_set={}, app_secret_set={})",
                config.enabled,
                !config.app_id.is_empty(),
                !config.app_secret.is_empty()
            );
            sleep(Duration::from_millis(DEFAULT_ERROR_BACKOFF_MS)).await;
            continue;
        }

        log::info!(
            "[FeishuGateway] Starting ws connection (allowed_open_ids={})",
            config.allowed_open_ids.len()
        );
        let result = start_ws_connection(app_handle.clone(), state.clone(), config.clone()).await;
        if let Err(error) = result {
            let backoff = {
                let mut gateway = state.lock().await;
                record_error_state(&mut gateway, error);
                gateway.backoff_ms = compute_backoff_ms(gateway.backoff_ms);
                gateway.backoff_ms
            };
            sleep(Duration::from_millis(backoff)).await;
        } else {
            let mut gateway = state.lock().await;
            clear_error_state(&mut gateway);
            gateway.backoff_ms = backoff_ms;
        }
    }
}

async fn start_ws_connection(
    app_handle: AppHandle,
    state: FeishuGatewayState,
    config: FeishuConfig,
) -> Result<(), String> {
    let client = Arc::new(build_client(&config)?);
    let ws_config = Arc::new(client.config.clone());
    let open_id_allowlist = config.allowed_open_ids.clone();
    let verification_token = config.verification_token.clone();
    let encrypt_key = config.encrypt_key.clone();

    let handler_app = app_handle.clone();
    let handler = EventDispatcherHandler::builder()
        .register_p2_im_message_receive_v1(move |event| {
            let client = client.clone();
            let app_handle = handler_app.clone();
            let open_id_allowlist = open_id_allowlist.clone();
            let state = state.clone();
            tokio::spawn(async move {
                let sender = event.event.sender;
                if sender_kind(&sender.sender_type) != FeishuSenderKind::User {
                    log::debug!(
                        "[FeishuGateway] Ignoring non-user sender type={}",
                        sender.sender_type
                    );
                    return;
                }

                let message = event.event.message;
                if chat_kind(&message.chat_type) != FeishuChatKind::P2p {
                    log::debug!(
                        "[FeishuGateway] Ignoring non-p2p chat type={}",
                        message.chat_type
                    );
                    return;
                }

                let open_id = sender.sender_id.open_id;
                if !is_open_id_allowed(&open_id_allowlist, &open_id) {
                    log::debug!(
                        "[FeishuGateway] Open id not in allowlist open_id={} count={}",
                        open_id,
                        open_id_allowlist.len()
                    );
                    return;
                }

                log::debug!(
                    "[FeishuGateway] Processing inbound message open_id={} message_id={} type={}",
                    open_id,
                    message.message_id,
                    message.message_type
                );

                let (text, attachments) = match build_message_payload(
                    &app_handle,
                    &client,
                    &message.message_type,
                    &message.content,
                    &message.message_id,
                )
                .await
                {
                    Ok(payload) => payload,
                    Err(error) => {
                        log::warn!("[FeishuGateway] Failed to build message payload: {error}");
                        (String::new(), Vec::new())
                    }
                };

                if text.trim().is_empty() && attachments.is_empty() {
                    log::debug!(
                        "[FeishuGateway] Ignoring empty message open_id={} message_id={}",
                        open_id,
                        message.message_id
                    );
                    return;
                }

                log::debug!(
                    "[FeishuGateway] Inbound message open_id={} message_id={} text_len={} attachments={}",
                    open_id,
                    message.message_id,
                    text.len(),
                    attachments.len()
                );

                let date = message
                    .create_time
                    .parse::<i64>()
                    .unwrap_or_else(|_| now_ms());

                let message_id = message.message_id.clone();
                let payload = FeishuInboundMessage {
                    chat_id: open_id.clone(),
                    message_id: message_id.clone(),
                    text,
                    open_id: open_id.clone(),
                    date,
                    attachments: if attachments.is_empty() {
                        None
                    } else {
                        Some(attachments)
                    },
                };

                match app_handle.emit("feishu-inbound-message", payload) {
                    Ok(_) => {
                        log::debug!(
                            "[FeishuGateway] Emitted inbound message open_id={} message_id={}",
                            open_id,
                            message_id
                        );
                    }
                    Err(error) => {
                        log::error!("[FeishuGateway] Failed to emit message: {}", error);
                    }
                }

                let mut gateway = state.lock().await;
                gateway.last_event_at_ms = Some(now_ms());
            });
        })
        .map_err(|error| format!("Feishu handler registration failed: {error}"))?
        .build();

    let mut handler = handler;
    if !verification_token.is_empty() {
        handler.set_verification_token(verification_token);
    }
    if !encrypt_key.is_empty() {
        handler.set_event_encrypt_key(encrypt_key);
    }

    LarkWsClient::open(ws_config, handler)
        .await
        .map_err(|error| format!("Feishu websocket failed: {error:?}"))
}

#[tauri::command]
pub async fn feishu_get_config(
    state: State<'_, FeishuGatewayState>,
) -> Result<FeishuConfig, String> {
    let gateway = state.lock().await;
    Ok(gateway.config.clone())
}

#[tauri::command]
pub async fn feishu_set_config(
    app_handle: AppHandle,
    state: State<'_, FeishuGatewayState>,
    config: FeishuConfig,
) -> Result<(), String> {
    {
        let mut gateway = state.lock().await;
        gateway.config = config.clone();
    }

    if config.enabled && !config.app_id.is_empty() && !config.app_secret.is_empty() {
        log::info!(
            "[FeishuGateway] Config updated (enabled={}, allowed_open_ids={})",
            config.enabled,
            config.allowed_open_ids.len()
        );
        let _ = start_gateway(app_handle, state.inner().clone()).await;
    }

    Ok(())
}

pub async fn start_gateway(app_handle: AppHandle, state: FeishuGatewayState) -> Result<(), String> {
    let (config, running) = {
        let gateway = state.lock().await;
        (gateway.config.clone(), gateway.running)
    };

    if running {
        log::info!("[FeishuGateway] Start requested but already running");
        return Ok(());
    }

    if config.app_id.is_empty() || config.app_secret.is_empty() {
        return Err("Feishu app_id/app_secret not configured".to_string());
    }

    log::info!(
        "[FeishuGateway] Starting gateway (allowed_open_ids={})",
        config.allowed_open_ids.len()
    );

    let (stop_tx, stop_rx) = watch::channel(false);

    {
        let mut gateway = state.lock().await;
        gateway.running = true;
        gateway.last_event_at_ms = None;
        gateway.last_error = None;
        gateway.last_error_at_ms = None;
        gateway.backoff_ms = DEFAULT_ERROR_BACKOFF_MS;
        gateway.stop_tx = Some(stop_tx);
    }

    let state_clone = state.clone();
    thread::spawn(move || {
        let runtime = Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("Failed to build Feishu runtime");
        runtime.block_on(async move {
            run_ws_loop(app_handle, state_clone, stop_rx).await;
        });
    });

    Ok(())
}

#[tauri::command]
pub async fn feishu_start(
    app_handle: AppHandle,
    state: State<'_, FeishuGatewayState>,
) -> Result<(), String> {
    start_gateway(app_handle, state.inner().clone()).await
}

#[tauri::command]
pub async fn feishu_stop(state: State<'_, FeishuGatewayState>) -> Result<(), String> {
    let mut gateway = state.lock().await;
    if let Some(stop_tx) = gateway.stop_tx.take() {
        let _ = stop_tx.send(true);
    }
    gateway.running = false;
    log::info!("[FeishuGateway] Stop requested");
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeishuGatewayStatus {
    pub running: bool,
    pub last_event_at_ms: Option<i64>,
    pub last_error: Option<String>,
    pub last_error_at_ms: Option<i64>,
    pub backoff_ms: u64,
}

#[tauri::command]
pub async fn feishu_get_status(
    state: State<'_, FeishuGatewayState>,
) -> Result<FeishuGatewayStatus, String> {
    let gateway = state.lock().await;
    Ok(FeishuGatewayStatus {
        running: gateway.running,
        last_event_at_ms: gateway.last_event_at_ms,
        last_error: gateway.last_error.clone(),
        last_error_at_ms: gateway.last_error_at_ms,
        backoff_ms: gateway.backoff_ms,
    })
}

#[tauri::command]
pub async fn feishu_is_running(state: State<'_, FeishuGatewayState>) -> Result<bool, String> {
    let gateway = state.lock().await;
    Ok(gateway.running)
}

#[tauri::command]
pub async fn feishu_send_message(
    state: State<'_, FeishuGatewayState>,
    request: FeishuSendMessageRequest,
) -> Result<FeishuSendMessageResponse, String> {
    let config = {
        let gateway = state.lock().await;
        gateway.config.clone()
    };

    let client = build_client(&config)?;
    log::debug!(
        "[FeishuGateway] sendMessage open_id={} text_len={}",
        request.open_id,
        request.text.len()
    );
    let body = CreateMessageRequestBody::builder()
        .receive_id(request.open_id.clone())
        .msg_type("text")
        .content(serde_json::json!({ "text": request.text }).to_string())
        .build();
    let req = CreateMessageRequest::builder()
        .receive_id_type("open_id")
        .request_body(body)
        .build();

    let message = client
        .im
        .v1
        .message
        .create(req, None)
        .await
        .map_err(|error| format!("Feishu send message failed: {error:?}"))?;

    Ok(FeishuSendMessageResponse {
        message_id: message.message_id,
    })
}

#[tauri::command]
pub async fn feishu_edit_message(
    state: State<'_, FeishuGatewayState>,
    request: FeishuEditMessageRequest,
) -> Result<(), String> {
    let config = {
        let gateway = state.lock().await;
        gateway.config.clone()
    };

    let client = build_client(&config)?;
    log::debug!(
        "[FeishuGateway] editMessage message_id={} text_len={}",
        request.message_id,
        request.text.len()
    );
    let update_request = UpdateMessageRequest::builder()
        .content(serde_json::json!({ "text": request.text }).to_string())
        .build();

    client
        .im
        .v1
        .message
        .update(&request.message_id, update_request, None)
        .await
        .map_err(|error| format!("Feishu edit message failed: {error:?}"))?;

    Ok(())
}

pub fn default_state() -> FeishuGatewayState {
    Arc::new(Mutex::new(FeishuGateway::new()))
}

#[cfg(test)]
mod tests {
    use super::{chat_kind, is_open_id_allowed, sender_kind, FeishuChatKind, FeishuSenderKind};

    #[test]
    fn open_id_allowlist_allows_when_empty() {
        assert!(is_open_id_allowed(&[], "ou_test"));
    }

    #[test]
    fn open_id_allowlist_blocks_when_missing() {
        let allowed = vec!["ou_allowed".to_string()];
        assert!(!is_open_id_allowed(&allowed, "ou_other"));
    }

    #[test]
    fn sender_kind_filters_non_user() {
        assert_eq!(sender_kind("user"), FeishuSenderKind::User);
        assert_eq!(sender_kind("app"), FeishuSenderKind::Other);
    }

    #[test]
    fn chat_kind_filters_non_p2p() {
        assert_eq!(chat_kind("p2p"), FeishuChatKind::P2p);
        assert_eq!(chat_kind("group"), FeishuChatKind::Other);
    }
}
