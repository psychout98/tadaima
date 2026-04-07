# Tadaima Agent — Windows installer pairing and configuration script
# Called as a WiX custom action after the binary is downloaded.
# Receives properties from the MSI UI: RelayUrl, PairingCode, MoviesDir, TvDir

param(
    [Parameter(Mandatory)][string]$RelayUrl,
    [Parameter(Mandatory)][string]$PairingCode,
    [Parameter(Mandatory)][string]$MoviesDir,
    [Parameter(Mandatory)][string]$TvDir
)

$ErrorActionPreference = "Stop"

$deviceName = $env:COMPUTERNAME.ToLower()
$body = @{
    code     = $PairingCode.ToUpper()
    name     = $deviceName
    platform = "windows"
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri "$RelayUrl/api/devices/pair/claim" `
    -Method POST -ContentType "application/json" -Body $body -ErrorAction Stop

$config = @{
    relay                  = $RelayUrl
    deviceToken            = $response.deviceToken
    deviceId               = $response.deviceId
    deviceName             = $deviceName
    profileName            = ""
    directories            = @{
        movies  = $MoviesDir
        tv      = $TvDir
        staging = "$env:TEMP\tadaima\staging"
    }
    realDebrid             = @{
        apiKey = if ($response.rdApiKey) { $response.rdApiKey } else { "" }
    }
    maxConcurrentDownloads = 2
    rdPollInterval         = 30
    lastUpdateCheck        = ""
    updateChannel          = "stable"
    previousBinaryPath     = ""
} | ConvertTo-Json -Depth 3

$configDir = "$env:APPDATA\tadaima"
New-Item -ItemType Directory -Force -Path $configDir | Out-Null
$config | Out-File -Encoding utf8 "$configDir\config.json"

Write-Host "Configuration written to $configDir\config.json"
