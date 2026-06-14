use serde::{Serialize, Deserialize};
use std::fs;
use std::path::Path;
use chrono::{Datelike, Timelike, Local};

#[derive(Serialize, Deserialize)]
pub struct BackupResult {
    success: bool,
    message: String,
}

#[tauri::command]
async fn check_and_run_backup(app: tauri::AppHandle, backup_dir: String) -> Result<BackupResult, String> {
    use tauri::Manager;
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_path = app_data.join("salgados.db");

    if backup_dir.is_empty() {
        return Err("Caminho de backup nao configurado. Defina uma pasta em Configuracoes.".to_string());
    }

    let now = Local::now();
    let dest_path = Path::new(&backup_dir).join(format!("backup_salgados_{}_{}_{:02}_{:02}_{:02}.db", now.year(), now.month(), now.day(), now.hour(), now.minute()));

    if dest_path.exists() {
        return Ok(BackupResult {
            success: true,
            message: "Backup do mes ja existe.".to_string(),
        });
    }

    match fs::copy(&db_path, &dest_path) {
        Ok(_) => Ok(BackupResult {
            success: true,
            message: format!("Backup realizado: {:?}", dest_path),
        }),
        Err(e) => Err(format!("Erro ao copiar: {}", e)),
    }
}

#[tauri::command]
async fn import_backup(app: tauri::AppHandle, backup_path: String) -> Result<BackupResult, String> {
    use tauri::Manager;
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_path = app_data.join("salgados.db");

    if backup_path.is_empty() {
        return Err("Caminho do arquivo de backup nao informado.".to_string());
    }

    let src = Path::new(&backup_path);
    if !src.exists() {
        return Err("Arquivo de backup nao encontrado.".to_string());
    }

    match fs::copy(src, &db_path) {
        Ok(_) => Ok(BackupResult {
            success: true,
            message: "Backup importado com sucesso. Reinicie o aplicativo.".to_string(),
        }),
        Err(e) => Err(format!("Erro ao importar backup: {}", e)),
    }
}

#[tauri::command]
async fn log_debug(message: String) -> Result<String, String> {
    let log_file = Path::new("debug.log");

    let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let log_entry = format!("[{}] {}\n", timestamp, message);

    // Append to log file
    match fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_file)
    {
        Ok(mut file) => {
            use std::io::Write;
            let _ = file.write_all(log_entry.as_bytes());
            Ok(format!("Logged: {}", message))
        }
        Err(e) => Err(format!("Erro ao escrever log: {}", e)),
    }
}

#[tauri::command]
async fn copiar_arquivo_clipboard(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let script = format!("set the clipboard to (POSIX file \"{}\")", path);
        std::process::Command::new("osascript")
            .args(["-e", &script])
            .status()
            .map_err(|e| format!("Erro: {}", e))?;
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        let script = format!("Set-Clipboard -Path '{}'", path);
        std::process::Command::new("powershell")
            .args(["-Command", &script])
            .status()
            .map_err(|e| format!("Erro: {}", e))?;
        return Ok(());
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Err("Não suportado neste sistema.".to_string())
    }
}

#[tauri::command]
async fn salvar_txt_temp(nome: String, conteudo: String) -> Result<String, String> {
    use std::io::Write;
    let dir = std::env::temp_dir();
    let path = dir.join(&nome);
    let mut file = fs::OpenOptions::new()
        .create(true).write(true).truncate(true)
        .open(&path)
        .map_err(|e| format!("Erro ao criar temp: {}", e))?;
    file.write_all(conteudo.as_bytes())
        .map_err(|e| format!("Erro ao escrever: {}", e))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
async fn deletar_arquivo(path: String) -> Result<(), String> {
    let _ = fs::remove_file(&path);
    Ok(())
}

#[tauri::command]
async fn salvar_txt(path: String, conteudo: String) -> Result<(), String> {
    use std::io::Write;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&path)
        .map_err(|e| format!("Erro ao criar arquivo: {}", e))?;
    file.write_all(conteudo.as_bytes())
        .map_err(|e| format!("Erro ao escrever: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn open_whatsapp(phone: String) -> bool {
    // Tenta abrir WhatsApp nativo no macOS/Windows
    // macOS: /Applications/WhatsApp.app
    // Windows: WhatsApp.exe no PATH ou AppData
    #[cfg(target_os = "macos")]
    {
        let url = format!("whatsapp://send?phone={}", phone);
        let status = std::process::Command::new("open")
            .arg(&url)
            .status();
        return status.map(|s| s.success()).unwrap_or(false);
    }
    #[cfg(target_os = "windows")]
    {
        let url = format!("whatsapp://send?phone={}", phone);
        let status = std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .status();
        return status.map(|s| s.success()).unwrap_or(false);
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        false
    }
}

#[tauri::command]
async fn imprimir_html(app: tauri::AppHandle, conteudo: String) -> Result<(), String> {
    use std::io::Write;
    use tauri::Manager;

    // Save HTML to temp file
    let dir = std::env::temp_dir();
    let path = dir.join("impressao_eri.html");
    {
        let mut file = fs::OpenOptions::new()
            .create(true).write(true).truncate(true)
            .open(&path)
            .map_err(|e| format!("Erro ao criar temp: {}", e))?;
        file.write_all(conteudo.as_bytes())
            .map_err(|e| format!("Erro ao escrever: {}", e))?;
    }

    let file_url = format!("file://{}", path.to_string_lossy());

    // Close previous print window if exists
    if let Some(w) = app.get_webview_window("print") {
        let _ = w.close();
    }

    let win = tauri::WebviewWindowBuilder::new(&app, "print", tauri::WebviewUrl::External(file_url.parse().map_err(|e: url::ParseError| e.to_string())?))
        .title("Imprimir")
        .inner_size(820.0, 650.0)
        .build()
        .map_err(|e| e.to_string())?;

    // Give the page time to load, then ensure window.print() works via evaluate_script fallback
    // The button onclick="window.print()" is the primary path; this is the Rust fallback trigger
    let _ = win; // keep reference

    Ok(())
}

#[tauri::command]
async fn executar_impressao() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // Find the frontmost process (our Tauri app) and send Cmd+P to open print dialog
        let script = r#"
            tell application "System Events"
                tell (first application process whose frontmost is true)
                    keystroke "p" using {command down}
                end tell
            end tell
        "#;
        // Small delay so the invoke response returns first, then keystroke fires
        std::thread::sleep(std::time::Duration::from_millis(200));
        std::process::Command::new("osascript")
            .args(["-e", script])
            .status()
            .map_err(|e| format!("Erro: {}", e))?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        let dir = std::env::temp_dir();
        let path = dir.join("impressao_eri.html");
        let path_str = path.to_string_lossy().to_string();
        std::process::Command::new("cmd")
            .args(["/C", "rundll32.exe", "mshtml.dll,PrintHTML", &path_str])
            .status()
            .map_err(|e| format!("Erro: {}", e))?;
        return Ok(());
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Err("Impressão não suportada.".to_string())
    }
}

#[tauri::command]
async fn salvar_temp_html(conteudo: String) -> Result<(), String> {
    use std::io::Write;
    let dir = std::env::temp_dir();
    let path = dir.join("impressao_eri.html");
    let mut file = fs::OpenOptions::new()
        .create(true).write(true).truncate(true)
        .open(&path)
        .map_err(|e| format!("Erro ao criar temp: {}", e))?;
    file.write_all(conteudo.as_bytes())
        .map_err(|e| format!("Erro ao escrever: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn imprimir_padrao_direto(
    nome: String,
    conteudo: String,
    copias: Option<u32>,
    cortar: Option<bool>,
    largura_mm: Option<u32>,
) -> Result<(), String> {
    use std::io::Write;

    let dir = std::env::temp_dir();
    let safe_name = if nome.trim().is_empty() { "impressao_eri.txt".to_string() } else { nome };
    let path = dir.join(safe_name);
    let copies = copias.unwrap_or(1).max(1);
    let should_cut = cortar.unwrap_or(false);
    let _paper_width_mm = largura_mm.unwrap_or(48).max(1);

    let mut file = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&path)
        .map_err(|e| format!("Erro ao criar temp: {}", e))?;

    file.write_all(conteudo.as_bytes())
        .map_err(|e| format!("Erro ao escrever: {}", e))?;

    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("lp")
            .arg("-n")
            .arg(copies.to_string())
            .arg(&path)
            .status()
            .map_err(|e| format!("Erro ao enviar para impressora: {}", e))?;

        if !status.success() {
            return Err("Falha ao imprimir na impressora padrao.".to_string());
        }

        if should_cut {
            let _ = tentar_corte_macos(&dir);
        }

        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        let raw_path = dir.join("impressao_eri_windows.bin");
        let payload = build_windows_receipt_payload(&conteudo, should_cut);
        fs::write(&raw_path, payload)
            .map_err(|e| format!("Erro ao criar payload de impressão: {}", e))?;

        for _ in 0..copies {
            imprimir_raw_windows(&raw_path)
                .map_err(|e| format!("Erro ao enviar para a impressora padrão: {}", e))?;
        }

        return Ok(());
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Err("Impressão direta não suportada neste sistema.".to_string())
    }
}

#[cfg(any(target_os = "windows", test))]
fn build_windows_receipt_payload(conteudo: &str, should_cut: bool) -> Vec<u8> {
    let normalized = conteudo.replace("\r\n", "\n").replace('\r', "\n");
    let mut payload = normalized.replace('\n', "\r\n").into_bytes();

    if !payload.ends_with(b"\r\n") {
        payload.extend_from_slice(b"\r\n");
    }

    if should_cut {
        // ESC @ (init) + GS V 0 (full cut)
        payload.extend_from_slice(&[0x1B, 0x40, 0x1D, 0x56, 0x00]);
    }

    payload
}

#[cfg(target_os = "windows")]
fn imprimir_raw_windows(path: &std::path::Path) -> Result<(), String> {
    let raw_path = path.to_string_lossy().replace('\\', "\\\\").replace('\'', "''");
    let script = format!(
        r#"$printer = Get-CimInstance Win32_Printer | Where-Object {{ $_.Default -eq $true }} | Select-Object -First 1;
if (-not $printer) {{ throw 'Nenhuma impressora padrão configurada.' }}

$source = @"
using System;
using System.IO;
using System.Runtime.InteropServices;

public static class RawPrinterHelper {{
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public class DOCINFO {{
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }}

  [DllImport("winspool.Drv", EntryPoint="OpenPrinterW", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);

  [DllImport("winspool.Drv", SetLastError=true)]
  static extern bool ClosePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool StartDocPrinter(IntPtr hPrinter, int level, DOCINFO di);

  [DllImport("winspool.Drv", SetLastError=true)]
  static extern bool EndDocPrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", SetLastError=true)]
  static extern bool StartPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", SetLastError=true)]
  static extern bool EndPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", SetLastError=true)]
  static extern bool WritePrinter(IntPtr hPrinter, byte[] bytes, int count, out int written);

  public static void SendFile(string printerName, string filePath) {{
    var bytes = File.ReadAllBytes(filePath);
    IntPtr hPrinter;
    if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
      throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());

    try {{
      var doc = new DOCINFO {{ pDocName = "ERI Cupom", pDataType = "RAW" }};
      if (!StartDocPrinter(hPrinter, 1, doc))
        throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
      try {{
        if (!StartPagePrinter(hPrinter))
          throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        try {{
          int written;
          if (!WritePrinter(hPrinter, bytes, bytes.Length, out written) || written != bytes.Length)
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }} finally {{
          EndPagePrinter(hPrinter);
        }}
      }} finally {{
        EndDocPrinter(hPrinter);
      }}
    }} finally {{
      ClosePrinter(hPrinter);
    }}
  }}
}}
"@;

Add-Type -TypeDefinition $source;
[RawPrinterHelper]::SendFile($printer.Name, '{0}');"#,
        raw_path
    );

    let output = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        return Err("Falha ao imprimir na impressora padrão.".to_string());
    }

    Err(stderr)
}

#[cfg(target_os = "macos")]
fn tentar_corte_macos(dir: &std::path::Path) -> Result<(), String> {
    use std::io::Write;

    let output = std::process::Command::new("lpstat")
        .arg("-d")
        .output()
        .map_err(|e| format!("Erro ao consultar impressora padrão: {}", e))?;

    if !output.status.success() {
        return Ok(());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let printer_name = stdout
        .split(':')
        .nth(1)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let Some(printer_name) = printer_name else {
        return Ok(());
    };

    let cut_path = dir.join("eri_cut_command.bin");
    let mut cut_file = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&cut_path)
        .map_err(|e| format!("Erro ao criar comando de corte: {}", e))?;

    // ESC/POS: GS V 0
    cut_file
        .write_all(&[0x1D, 0x56, 0x00])
        .map_err(|e| format!("Erro ao escrever comando de corte: {}", e))?;

    let _ = std::process::Command::new("lp")
        .args(["-d", &printer_name, "-o", "raw"])
        .arg(&cut_path)
        .status();

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![check_and_run_backup, import_backup, log_debug, open_whatsapp, salvar_txt, salvar_txt_temp, deletar_arquivo, copiar_arquivo_clipboard, imprimir_html, executar_impressao, salvar_temp_html, imprimir_padrao_direto])
        .setup(|app| {
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(Some(monitor)) = window.current_monitor() {
                    let screen_w = monitor.size().width;
                    let screen_h = monitor.size().height;
                    let target_w = 1280u32;
                    let target_h = 800u32;

                    if screen_w < target_w || screen_h < target_h {
                        // Tela menor que 1280x720 - maximiza
                        let _ = window.maximize();
                    } else {
                        // Tela maior - usa 1280x720 centralizado
                        let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize {
                            width: target_w,
                            height: target_h,
                        }));
                        let _ = window.center();
                    }
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::build_windows_receipt_payload;

    #[test]
    fn windows_payload_normalizes_line_endings() {
        let payload = build_windows_receipt_payload("Linha 1\nLinha 2", false);
        assert_eq!(payload, b"Linha 1\r\nLinha 2\r\n");
    }

    #[test]
    fn windows_payload_appends_cut_sequence_when_enabled() {
        let payload = build_windows_receipt_payload("Linha unica", true);
        assert!(payload.ends_with(&[0x1B, 0x40, 0x1D, 0x56, 0x00]));
    }
}
