param([string]$In, [string]$Out)
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chrome)) {
    $chrome = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
}
$abs = (Resolve-Path $In).Path
& $chrome --headless --disable-gpu --no-pdf-header-footer `
    --virtual-time-budget=8000 `
    "--print-to-pdf=$Out" "file:///$abs"
