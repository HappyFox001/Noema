use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Serialize, Deserialize)]
pub struct GrepMatch {
    pub file: String,
    pub line_number: Option<usize>,
    pub line: Option<String>,
    pub count: Option<usize>,
}

/// Read file content
#[tauri::command]
pub async fn read_file(
    path: String,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<String, String> {
    let content = fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))?;

    if offset.is_some() || limit.is_some() {
        let lines: Vec<&str> = content.lines().collect();
        let start = offset.unwrap_or(0);
        let end = limit.map(|l| start + l).unwrap_or(lines.len());
        let end = end.min(lines.len());

        Ok(lines[start..end].join("\n"))
    } else {
        Ok(content)
    }
}

/// Write file content
#[tauri::command]
pub async fn write_file(path: String, content: String) -> Result<(), String> {
    // Ensure parent directory exists
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    fs::write(&path, content).map_err(|e| format!("Failed to write file: {}", e))?;
    Ok(())
}

/// Edit file with exact string replacement
#[tauri::command]
pub async fn edit_file(
    path: String,
    old_string: String,
    new_string: String,
    replace_all: bool,
) -> Result<(), String> {
    let content = fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))?;

    if !content.contains(&old_string) {
        return Err(format!("old_string not found in file: {}", path));
    }

    if !replace_all {
        let occurrences = content.matches(&old_string).count();
        if occurrences > 1 {
            return Err(format!(
                "old_string appears {} times in file. Use replace_all=true to replace all occurrences.",
                occurrences
            ));
        }
    }

    let new_content = if replace_all {
        content.replace(&old_string, &new_string)
    } else {
        content.replacen(&old_string, &new_string, 1)
    };

    fs::write(&path, new_content).map_err(|e| format!("Failed to write file: {}", e))?;
    Ok(())
}

/// Glob file matching
#[tauri::command]
pub async fn glob_files(
    pattern: String,
    path: Option<String>,
    ignore: Option<Vec<String>>,
) -> Result<Vec<String>, String> {
    use glob::glob;

    let search_path = path.unwrap_or_else(|| ".".to_string());
    let full_pattern = format!("{}/{}", search_path, pattern);

    let mut matches = Vec::new();
    let ignore_patterns = ignore.unwrap_or_default();

    for entry in glob(&full_pattern).map_err(|e| format!("Invalid glob pattern: {}", e))? {
        match entry {
            Ok(path_buf) => {
                let path_str = path_buf.to_string_lossy().to_string();

                // Check if path matches any ignore pattern
                let should_ignore = ignore_patterns
                    .iter()
                    .any(|pattern| path_str.contains(pattern));

                if !should_ignore {
                    matches.push(path_str);
                }
            }
            Err(e) => eprintln!("Glob error: {}", e),
        }
    }

    matches.sort();
    Ok(matches)
}

/// Grep search in files
#[tauri::command]
pub async fn grep_files(
    pattern: String,
    path: Option<String>,
    glob: Option<String>,
    case_insensitive: Option<bool>,
    output_mode: Option<String>,
    context_lines: Option<usize>,
    limit: Option<usize>,
) -> Result<Vec<GrepMatch>, String> {
    use regex::RegexBuilder;
    use walkdir::WalkDir;

    let search_path = path.unwrap_or_else(|| ".".to_string());
    let output_mode = output_mode.unwrap_or_else(|| "files_with_matches".to_string());
    let case_insensitive = case_insensitive.unwrap_or(false);

    let regex = RegexBuilder::new(&pattern)
        .case_insensitive(case_insensitive)
        .build()
        .map_err(|e| format!("Invalid regex pattern: {}", e))?;

    let mut matches = Vec::new();
    let mut count = 0;

    for entry in WalkDir::new(&search_path)
        .into_iter()
        .filter_entry(|e| {
            !e.file_name()
                .to_str()
                .map(|s| s.starts_with('.') || s == "node_modules" || s == "target")
                .unwrap_or(false)
        })
    {
        if let Some(lim) = limit {
            if count >= lim {
                break;
            }
        }

        let entry = entry.map_err(|e| format!("Walk error: {}", e))?;

        if !entry.file_type().is_file() {
            continue;
        }

        let file_path = entry.path().to_string_lossy().to_string();

        // Apply glob filter if specified
        if let Some(ref glob_pattern) = glob {
            if !file_path.ends_with(glob_pattern.trim_start_matches("*.")) {
                continue;
            }
        }

        if let Ok(content) = fs::read_to_string(entry.path()) {
            match output_mode.as_str() {
                "files_with_matches" => {
                    if regex.is_match(&content) {
                        matches.push(GrepMatch {
                            file: file_path.clone(),
                            line_number: None,
                            line: None,
                            count: None,
                        });
                        count += 1;
                    }
                }
                "count" => {
                    let match_count = regex.find_iter(&content).count();
                    if match_count > 0 {
                        matches.push(GrepMatch {
                            file: file_path.clone(),
                            line_number: None,
                            line: None,
                            count: Some(match_count),
                        });
                        count += 1;
                    }
                }
                "content" => {
                    for (line_num, line) in content.lines().enumerate() {
                        if regex.is_match(line) {
                            matches.push(GrepMatch {
                                file: file_path.clone(),
                                line_number: Some(line_num + 1),
                                line: Some(line.to_string()),
                                count: None,
                            });
                            count += 1;

                            if let Some(lim) = limit {
                                if count >= lim {
                                    break;
                                }
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }

    Ok(matches)
}
