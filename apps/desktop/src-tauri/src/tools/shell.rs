use serde::{Deserialize, Serialize};
use std::process::{Command, Stdio};
use std::time::Duration;
use tokio::process::Command as TokioCommand;

#[derive(Debug, Serialize, Deserialize)]
pub struct CommandOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

/// Run a shell command
#[tauri::command]
pub async fn run_command(
    command: String,
    cwd: Option<String>,
    timeout: Option<u64>,
) -> Result<CommandOutput, String> {
    let timeout_ms = timeout.unwrap_or(120000); // Default 2 minutes

    #[cfg(target_os = "windows")]
    let shell = "cmd";
    #[cfg(target_os = "windows")]
    let shell_arg = "/C";

    #[cfg(not(target_os = "windows"))]
    let shell = "sh";
    #[cfg(not(target_os = "windows"))]
    let shell_arg = "-c";

    let mut cmd = TokioCommand::new(shell);
    cmd.arg(shell_arg).arg(&command);

    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }

    cmd.stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());

    let child = cmd.spawn().map_err(|e| format!("Failed to spawn command: {}", e))?;

    // Wait with timeout
    let output = tokio::time::timeout(
        Duration::from_millis(timeout_ms),
        child.wait_with_output(),
    )
    .await
    .map_err(|_| "Command timeout".to_string())?
    .map_err(|e| format!("Failed to execute command: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let exit_code = output.status.code().unwrap_or(-1);

    // Truncate if too long
    let max_len = 30000;
    let stdout = if stdout.len() > max_len {
        format!("{}\\n... (output truncated)", &stdout[..max_len])
    } else {
        stdout
    };

    let stderr = if stderr.len() > max_len {
        format!("{}\\n... (output truncated)", &stderr[..max_len])
    } else {
        stderr
    };

    Ok(CommandOutput {
        stdout,
        stderr,
        exit_code,
    })
}

/// Run a command in the background
#[tauri::command]
pub async fn run_command_background(
    command: String,
    cwd: Option<String>,
) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    let shell = "cmd";
    #[cfg(target_os = "windows")]
    let shell_arg = "/C";

    #[cfg(not(target_os = "windows"))]
    let shell = "sh";
    #[cfg(not(target_os = "windows"))]
    let shell_arg = "-c";

    let mut cmd = Command::new(shell);
    cmd.arg(shell_arg).arg(&command);

    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }

    cmd.stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null());

    let child = cmd.spawn().map_err(|e| format!("Failed to spawn command: {}", e))?;

    let pid = child.id();

    Ok(format!("task_{}", pid))
}
