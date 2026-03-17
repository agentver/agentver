use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;

#[derive(Serialize)]
pub struct DependencyStatus {
    pub found: bool,
    pub version: Option<String>,
    pub path: Option<String>,
}

#[derive(Serialize)]
pub struct PrerequisiteStatus {
    pub git: DependencyStatus,
    pub bun: DependencyStatus,
    pub cli: DependencyStatus,
}

#[derive(Serialize)]
pub struct CLICommandResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

fn agentver_dir() -> PathBuf {
    dirs::home_dir()
        .expect("could not determine home directory")
        .join(".agentver")
}

fn runtime_dir() -> PathBuf {
    agentver_dir().join("runtime")
}

fn bun_path() -> PathBuf {
    let dir = runtime_dir().join("bun");
    if cfg!(target_os = "windows") {
        dir.join("bun.exe")
    } else {
        dir.join("bun")
    }
}

/// Resolves the full path to the agentver binary.
/// Checks system PATH first, then falls back to bun's global bin directory.
fn agentver_bin() -> Result<PathBuf, String> {
    // Try system PATH first
    if let Ok(path) = which::which("agentver") {
        return Ok(path);
    }

    // Fall back to bun's global bin directory
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;
    let bin_dir = home.join(".bun").join("bin");

    if cfg!(target_os = "windows") {
        let cmd_path = bin_dir.join("agentver.cmd");
        if cmd_path.exists() {
            return Ok(cmd_path);
        }
        let exe_path = bin_dir.join("agentver.exe");
        if exe_path.exists() {
            return Ok(exe_path);
        }
    } else {
        let bin_path = bin_dir.join("agentver");
        if bin_path.exists() {
            return Ok(bin_path);
        }
    }

    Err("agentver binary not found on PATH or in bun global bin directory".to_string())
}

fn check_command(cmd: &str, args: &[&str]) -> DependencyStatus {
    match Command::new(cmd).args(args).output() {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let path = which::which(cmd)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            DependencyStatus {
                found: true,
                version: Some(version),
                path: Some(path),
            }
        }
        _ => DependencyStatus {
            found: false,
            version: None,
            path: None,
        },
    }
}

#[tauri::command]
pub async fn check_prerequisites() -> Result<PrerequisiteStatus, String> {
    let git = check_command("git", &["--version"]);

    // Check managed bun first, then system bun
    let bun_binary = bun_path();
    let bun = if bun_binary.exists() {
        check_command(bun_binary.to_str().unwrap_or("bun"), &["--version"])
    } else {
        check_command("bun", &["--version"])
    };

    let cli = match agentver_bin() {
        Ok(path) => check_command(path.to_str().unwrap_or("agentver"), &["--version"]),
        Err(_) => DependencyStatus {
            found: false,
            version: None,
            path: None,
        },
    };

    Ok(PrerequisiteStatus { git, bun, cli })
}

#[tauri::command]
pub async fn install_bun() -> Result<String, String> {
    let runtime = runtime_dir();
    std::fs::create_dir_all(&runtime)
        .map_err(|e| format!("Failed to create runtime directory: {}", e))?;

    let install_dir = runtime.join("bun");

    let output = if cfg!(target_os = "windows") {
        Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                &format!(
                    "& {{ $env:BUN_INSTALL='{}'; irm bun.sh/install.ps1 | iex }}",
                    install_dir.to_string_lossy()
                ),
            ])
            .output()
            .map_err(|e| format!("Failed to download bun: {}", e))?
    } else {
        Command::new("bash")
            .args([
                "-c",
                &format!(
                    "curl -fsSL https://bun.sh/install | bash -s -- --install-dir {}",
                    install_dir.to_string_lossy()
                ),
            ])
            .output()
            .map_err(|e| format!("Failed to download bun: {}", e))?
    };

    if !output.status.success() {
        return Err(format!(
            "Bun installation failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let bun = bun_path();
    if !bun.exists() {
        return Err("Bun binary not found after installation".to_string());
    }

    let version_output = Command::new(&bun)
        .args(["--version"])
        .output()
        .map_err(|e| format!("Failed to verify bun: {}", e))?;

    Ok(String::from_utf8_lossy(&version_output.stdout)
        .trim()
        .to_string())
}

#[tauri::command]
pub async fn install_cli() -> Result<String, String> {
    let bun = if bun_path().exists() {
        bun_path()
    } else {
        which::which("bun").map_err(|_| "Bun not found. Install bun first.".to_string())?
    };

    let output = Command::new(&bun)
        .args(["add", "-g", "agentver"])
        .output()
        .map_err(|e| format!("Failed to install agentver CLI: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "CLI installation failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let agentver = agentver_bin().map_err(|e| format!("Failed to verify CLI: {}", e))?;
    let version = Command::new(&agentver)
        .args(["--version"])
        .output()
        .map_err(|e| format!("Failed to verify CLI: {}", e))?;

    Ok(String::from_utf8_lossy(&version.stdout)
        .trim()
        .to_string())
}

#[tauri::command]
pub async fn update_cli() -> Result<String, String> {
    let bun = if bun_path().exists() {
        bun_path()
    } else {
        which::which("bun").map_err(|_| "Bun not found.".to_string())?
    };

    let output = Command::new(&bun)
        .args(["update", "-g", "agentver"])
        .output()
        .map_err(|e| format!("Failed to update agentver CLI: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "CLI update failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    get_cli_version().await
}

#[tauri::command]
pub async fn run_cli_command(
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
) -> Result<CLICommandResult, String> {
    let agentver = agentver_bin().map_err(|e| format!("Failed to find agentver: {}", e))?;
    let mut cmd = Command::new(&agentver);
    cmd.arg(&command);
    cmd.args(&args);
    cmd.arg("--json");

    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to execute CLI command: {}", e))?;

    Ok(CLICommandResult {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code().unwrap_or(-1),
    })
}

#[tauri::command]
pub async fn get_cli_version() -> Result<String, String> {
    let agentver = agentver_bin().map_err(|e| format!("Failed to find agentver: {}", e))?;
    let output = Command::new(&agentver)
        .args(["--version"])
        .output()
        .map_err(|e| format!("Failed to get CLI version: {}", e))?;

    if !output.status.success() {
        return Err("CLI not found or not working".to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .trim()
        .to_string())
}

// --- File system commands for the skill editor ---

#[derive(Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileEntry>>,
}

fn read_dir_recursive(dir: &std::path::Path) -> Result<Vec<FileEntry>, String> {
    let mut entries = Vec::new();

    let read = std::fs::read_dir(dir).map_err(|e| format!("Failed to read directory: {}", e))?;

    let mut items: Vec<_> = read.filter_map(|e| e.ok()).collect();
    items.sort_by_key(|e| e.file_name());

    for entry in items {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files and common build directories
        if name.starts_with('.') || name == "node_modules" || name == "target" {
            continue;
        }

        let is_dir = path.is_dir();
        let children = if is_dir {
            Some(read_dir_recursive(&path)?)
        } else {
            None
        };

        entries.push(FileEntry {
            name,
            path: path.to_string_lossy().to_string(),
            is_dir,
            children,
        });
    }

    Ok(entries)
}

#[tauri::command]
pub async fn read_skill_directory(path: String) -> Result<Vec<FileEntry>, String> {
    let dir = std::path::Path::new(&path);
    if !dir.exists() {
        return Err(format!("Directory does not exist: {}", path));
    }
    if !dir.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }
    read_dir_recursive(dir)
}

#[tauri::command]
pub async fn read_skill_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
pub async fn write_skill_file(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent directory: {}", e))?;
    }
    std::fs::write(&path, &content).map_err(|e| format!("Failed to write file: {}", e))
}

#[tauri::command]
pub async fn create_file(path: String) -> Result<(), String> {
    let file_path = std::path::Path::new(&path);
    if file_path.exists() {
        return Err(format!("File already exists: {}", path));
    }
    if let Some(parent) = file_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent directory: {}", e))?;
    }
    std::fs::write(&path, "").map_err(|e| format!("Failed to create file: {}", e))
}

#[tauri::command]
pub async fn delete_file(path: String) -> Result<(), String> {
    let file_path = std::path::Path::new(&path);
    if !file_path.exists() {
        return Err(format!("File does not exist: {}", path));
    }
    if file_path.is_dir() {
        std::fs::remove_dir_all(&path).map_err(|e| format!("Failed to delete directory: {}", e))
    } else {
        std::fs::remove_file(&path).map_err(|e| format!("Failed to delete file: {}", e))
    }
}

#[tauri::command]
pub async fn rename_file(old_path: String, new_path: String) -> Result<(), String> {
    std::fs::rename(&old_path, &new_path).map_err(|e| format!("Failed to rename: {}", e))
}
