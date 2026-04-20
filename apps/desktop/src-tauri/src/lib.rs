mod audio;
mod memory;
mod tools;

use futures_util::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tauri::utils::config::Color;
use tauri::{Manager, State};
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, http::HeaderValue, Message},
};

// Audio processor state
struct AudioState {
    processor: Arc<audio::AudioProcessor>,
}

struct RealtimeWebSocketSession {
    tx: mpsc::UnboundedSender<RealtimeWebSocketOutgoing>,
    rx: Arc<Mutex<mpsc::UnboundedReceiver<Vec<u8>>>>,
}

struct RealtimeWebSocketState {
    sessions: Arc<Mutex<HashMap<String, RealtimeWebSocketSession>>>,
}

#[derive(serde::Serialize)]
struct RealtimeWebSocketReceiveResult {
    data: Option<Vec<u8>>,
    timeout: bool,
    closed: bool,
}

// Memory database state
struct MemoryState {
    db: Arc<memory::MemoryDB>,
}

enum RealtimeWebSocketOutgoing {
    Binary(Vec<u8>),
    Text(String),
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Process audio chunk and detect voice activity
/// Returns true if speech is detected
#[tauri::command]
async fn process_audio(state: State<'_, AudioState>, audio_data: Vec<i16>) -> Result<bool, String> {
    state
        .processor
        .process_audio(audio_data)
        .await
        .map_err(|e| e.to_string())
}

// ========== Generic realtime WebSocket bridge ==========

#[tauri::command]
async fn realtime_ws_connect(
    state: State<'_, RealtimeWebSocketState>,
    id: String,
    url: String,
    headers: HashMap<String, String>,
) -> Result<(), String> {
    let mut request = url
        .into_client_request()
        .map_err(|e| format!("Failed to create WebSocket request: {}", e))?;

    for (key, value) in headers {
        let header_name = key
            .parse::<tokio_tungstenite::tungstenite::http::header::HeaderName>()
            .map_err(|e| format!("Invalid WebSocket header name {}: {}", key, e))?;
        let header_value = HeaderValue::from_str(&value)
            .map_err(|e| format!("Invalid WebSocket header value for {}: {}", key, e))?;
        request.headers_mut().insert(header_name, header_value);
    }

    let (ws_stream, _) = connect_async(request)
        .await
        .map_err(|e| format!("WebSocket connection failed: {}", e))?;
    let (mut write, mut read) = ws_stream.split();
    let (tx, mut outgoing_rx) = mpsc::unbounded_channel::<RealtimeWebSocketOutgoing>();
    let (incoming_tx, incoming_rx) = mpsc::unbounded_channel::<Vec<u8>>();

    tokio::spawn(async move {
        while let Some(outgoing) = outgoing_rx.recv().await {
            let message = match outgoing {
                RealtimeWebSocketOutgoing::Binary(data) => Message::Binary(data),
                RealtimeWebSocketOutgoing::Text(data) => Message::Text(data),
            };

            if let Err(error) = write.send(message).await {
                tracing::error!("Realtime WebSocket send failed: {}", error);
                break;
            }
        }
        let _ = write.close().await;
    });

    tokio::spawn(async move {
        while let Some(message) = read.next().await {
            match message {
                Ok(Message::Binary(data)) => {
                    tracing::debug!("Received binary message: {} bytes", data.len());
                    let _ = incoming_tx.send(data);
                }
                Ok(Message::Text(text)) => {
                    tracing::debug!("Received text message: {}", text);
                    let _ = incoming_tx.send(text.into_bytes());
                }
                Ok(Message::Close(frame)) => {
                    if let Some(cf) = frame {
                        tracing::warn!("WebSocket closed by server: code={}, reason={}", cf.code, cf.reason);
                    } else {
                        tracing::warn!("WebSocket closed by server (no close frame)");
                    }
                    break;
                }
                Err(error) => {
                    tracing::error!("Realtime WebSocket receive failed: {}", error);
                    break;
                }
                _ => {}
            }
        }
        tracing::info!("WebSocket receive loop ended");
    });

    let mut sessions = state.sessions.lock().await;
    sessions.insert(
        id,
        RealtimeWebSocketSession {
            tx,
            rx: Arc::new(Mutex::new(incoming_rx)),
        },
    );

    Ok(())
}

#[tauri::command]
async fn realtime_ws_send_binary(
    state: State<'_, RealtimeWebSocketState>,
    id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    let sessions = state.sessions.lock().await;
    let session = sessions
        .get(&id)
        .ok_or_else(|| format!("Realtime WebSocket session not found: {}", id))?;

    session
        .tx
        .send(RealtimeWebSocketOutgoing::Binary(data))
        .map_err(|e| format!("Failed to queue WebSocket message: {}", e))
}

#[tauri::command]
async fn realtime_ws_send_text(
    state: State<'_, RealtimeWebSocketState>,
    id: String,
    data: String,
) -> Result<(), String> {
    let sessions = state.sessions.lock().await;
    let session = sessions
        .get(&id)
        .ok_or_else(|| format!("Realtime WebSocket session not found: {}", id))?;

    session
        .tx
        .send(RealtimeWebSocketOutgoing::Text(data))
        .map_err(|e| format!("Failed to queue WebSocket message: {}", e))
}

#[tauri::command]
async fn realtime_ws_receive(
    state: State<'_, RealtimeWebSocketState>,
    id: String,
    timeout_ms: Option<u64>,
) -> Result<RealtimeWebSocketReceiveResult, String> {
    let rx = {
        let sessions = state.sessions.lock().await;
        sessions
            .get(&id)
            .map(|session| Arc::clone(&session.rx))
            .ok_or_else(|| format!("Realtime WebSocket session not found: {}", id))?
    };

    let timeout = Duration::from_millis(timeout_ms.unwrap_or(10000));
    let mut guard = rx.lock().await;
    match tokio::time::timeout(timeout, guard.recv()).await {
        Ok(Some(data)) => Ok(RealtimeWebSocketReceiveResult {
            data: Some(data),
            timeout: false,
            closed: false,
        }),
        Ok(None) => Ok(RealtimeWebSocketReceiveResult {
            data: None,
            timeout: false,
            closed: true,
        }),
        Err(_) => Ok(RealtimeWebSocketReceiveResult {
            data: None,
            timeout: true,
            closed: false,
        }),
    }
}

#[tauri::command]
async fn realtime_ws_close(
    state: State<'_, RealtimeWebSocketState>,
    id: String,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().await;
    sessions.remove(&id);
    Ok(())
}

// ========== Memory Commands ==========

/// Save conversation turn to database
#[tauri::command]
async fn save_conversation_turn(
    state: State<'_, MemoryState>,
    turn: memory::database::ConversationTurn,
) -> Result<(), String> {
    let conn = state.db.conn();
    let guard = conn.lock().await;
    memory::database::save_conversation_turn(&*guard, &turn).map_err(|e| e.to_string())
}

/// Get recent conversations
#[tauri::command]
async fn get_recent_conversations(
    state: State<'_, MemoryState>,
    limit: usize,
) -> Result<Vec<memory::database::ConversationTurn>, String> {
    let conn = state.db.conn();
    let guard = conn.lock().await;
    memory::database::get_recent_conversations(&*guard, limit).map_err(|e| e.to_string())
}

/// Save user profile entry
#[tauri::command]
async fn save_user_profile_entry(
    state: State<'_, MemoryState>,
    key: String,
    value: String,
) -> Result<(), String> {
    let conn = state.db.conn();
    let guard = conn.lock().await;
    memory::database::save_user_profile_entry(&*guard, &key, &value).map_err(|e| e.to_string())
}

/// Get user profile
#[tauri::command]
async fn get_user_profile(
    state: State<'_, MemoryState>,
) -> Result<Vec<memory::database::UserProfileEntry>, String> {
    let conn = state.db.conn();
    let guard = conn.lock().await;
    memory::database::get_user_profile(&*guard).map_err(|e| e.to_string())
}

/// Save important memory
#[tauri::command]
async fn save_important_memory(
    state: State<'_, MemoryState>,
    key: String,
    value: String,
) -> Result<(), String> {
    let conn = state.db.conn();
    let guard = conn.lock().await;
    memory::database::save_important_memory(&*guard, &key, &value).map_err(|e| e.to_string())
}

/// Get important memories
#[tauri::command]
async fn get_important_memories(
    state: State<'_, MemoryState>,
) -> Result<Vec<memory::database::ImportantMemory>, String> {
    let conn = state.db.conn();
    let guard = conn.lock().await;
    memory::database::get_important_memories(&*guard).map_err(|e| e.to_string())
}

/// Save conversation summary
#[tauri::command]
async fn save_conversation_summary(
    state: State<'_, MemoryState>,
    summary: memory::database::ConversationSummary,
) -> Result<(), String> {
    let conn = state.db.conn();
    let guard = conn.lock().await;
    memory::database::save_conversation_summary(&*guard, &summary).map_err(|e| e.to_string())
}

/// Get conversation summaries
#[tauri::command]
async fn get_conversation_summaries(
    state: State<'_, MemoryState>,
    limit: usize,
) -> Result<Vec<memory::database::ConversationSummary>, String> {
    let conn = state.db.conn();
    let guard = conn.lock().await;
    memory::database::get_conversation_summaries(&*guard, limit).map_err(|e| e.to_string())
}

/// Get memory statistics
#[tauri::command]
async fn get_memory_stats(
    state: State<'_, MemoryState>,
) -> Result<memory::database::MemoryStats, String> {
    let conn = state.db.conn();
    let guard = conn.lock().await;
    memory::database::get_stats(&*guard).map_err(|e| e.to_string())
}

/// Clear all memory data
#[tauri::command]
async fn clear_all_memory(state: State<'_, MemoryState>) -> Result<(), String> {
    let conn = state.db.conn();
    let guard = conn.lock().await;
    memory::database::clear_all(&*guard).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .init();

    // Initialize memory database
    let app_data_dir = std::env::var("APPDATA")
        .or_else(|_| std::env::var("HOME").map(|h| format!("{}/.local/share", h)))
        .unwrap_or_else(|_| ".".to_string());
    let db_path = format!("{}/her-text/memory.db", app_data_dir);

    // Ensure directory exists
    if let Some(parent) = std::path::Path::new(&db_path).parent() {
        std::fs::create_dir_all(parent).ok();
    }

    let memory_db = memory::MemoryDB::new(&db_path).expect("Failed to initialize memory database");

    tracing::info!("Memory database initialized at: {}", db_path);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window.set_shadow(false)?;
                window.set_background_color(Some(Color(0, 0, 0, 0)))?;
            }

            Ok(())
        })
        .manage(AudioState {
            processor: Arc::new(audio::AudioProcessor::new()),
        })
        .manage(RealtimeWebSocketState {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        })
        .manage(MemoryState {
            db: Arc::new(memory_db),
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            process_audio,
            realtime_ws_connect,
            realtime_ws_send_binary,
            realtime_ws_send_text,
            realtime_ws_receive,
            realtime_ws_close,
            save_conversation_turn,
            get_recent_conversations,
            save_user_profile_entry,
            get_user_profile,
            save_important_memory,
            get_important_memories,
            save_conversation_summary,
            get_conversation_summaries,
            get_memory_stats,
            clear_all_memory,
            // Tools
            tools::read_file,
            tools::write_file,
            tools::edit_file,
            tools::glob_files,
            tools::grep_files,
            tools::run_command,
            tools::run_command_background
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
