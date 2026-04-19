mod audio;
mod memory;
mod tools;

use std::sync::Arc;
use tauri::utils::config::Color;
use tauri::{Manager, State};
use tokio::sync::Mutex;

// Audio processor state
struct AudioState {
    processor: Arc<Mutex<audio::AudioProcessor>>,
}

// Memory database state
struct MemoryState {
    db: Arc<memory::MemoryDB>,
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Initialize STT service with API key
#[tauri::command]
async fn init_stt(state: State<'_, AudioState>, api_key: String) -> Result<(), String> {
    let processor = state.processor.lock().await;
    processor.init_stt(api_key).await.map_err(|e| e.to_string())
}

/// Process audio chunk and detect voice activity
/// Returns true if speech is detected
#[tauri::command]
async fn process_audio(state: State<'_, AudioState>, audio_data: Vec<i16>) -> Result<bool, String> {
    let processor = state.processor.lock().await;
    processor
        .process_audio(audio_data)
        .await
        .map_err(|e| e.to_string())
}

/// Transcribe audio to text
#[tauri::command]
async fn transcribe_audio(
    state: State<'_, AudioState>,
    audio_data: Vec<i16>,
) -> Result<String, String> {
    let processor = state.processor.lock().await;
    processor
        .transcribe(audio_data)
        .await
        .map_err(|e| e.to_string())
}

/// Initialize TTS service with API key
#[tauri::command]
async fn init_tts(
    state: State<'_, AudioState>,
    api_key: String,
    voice_id: Option<String>,
) -> Result<(), String> {
    let processor = state.processor.lock().await;
    processor
        .init_tts(api_key, voice_id)
        .await
        .map_err(|e| e.to_string())
}

/// Synthesize text to speech
#[tauri::command]
async fn synthesize_text(state: State<'_, AudioState>, text: String) -> Result<(), String> {
    let processor = state.processor.lock().await;
    processor.synthesize(&text).await.map_err(|e| e.to_string())
}

/// Receive next TTS audio chunk
#[tauri::command]
async fn receive_tts_audio(state: State<'_, AudioState>) -> Result<Option<Vec<u8>>, String> {
    let processor = state.processor.lock().await;
    processor
        .receive_tts_audio()
        .await
        .map_err(|e| e.to_string())
}

/// Shutdown audio processor
#[tauri::command]
async fn shutdown_audio(state: State<'_, AudioState>) -> Result<(), String> {
    let processor = state.processor.lock().await;
    processor.shutdown().await.map_err(|e| e.to_string())
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
            processor: Arc::new(Mutex::new(audio::AudioProcessor::new())),
        })
        .manage(MemoryState {
            db: Arc::new(memory_db),
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            init_stt,
            process_audio,
            transcribe_audio,
            init_tts,
            synthesize_text,
            receive_tts_audio,
            shutdown_audio,
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
