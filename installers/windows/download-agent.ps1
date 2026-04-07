# Tadaima Agent — Windows installer bootstrap script
# Downloads the latest agent binary from GitHub Releases and verifies its checksum.
# Called as a WiX custom action during MSI install.

param(
    [string]$InstallDir = "$env:ProgramFiles\Tadaima"
)

$ErrorActionPreference = "Stop"
$repo = "psychout98/tadaima"

Write-Host "Fetching latest release info..."
$release = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest"

$asset = $release.assets | Where-Object { $_.name -eq "tadaima-agent-win-x64.exe" }
$checksumAsset = $release.assets | Where-Object { $_.name -eq "checksums.sha256" }

if (-not $asset) {
    throw "Could not find tadaima-agent-win-x64.exe in latest release."
}
if (-not $checksumAsset) {
    throw "Could not find checksums.sha256 in latest release."
}

# Create install directory
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

$binaryPath = Join-Path $InstallDir "tadaima-agent.exe"
$checksumPath = Join-Path $env:TEMP "checksums.sha256"

# Download binary
Write-Host "Downloading $($asset.name)..."
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $binaryPath -UseBasicParsing

# Download and verify checksum
Write-Host "Verifying checksum..."
Invoke-WebRequest -Uri $checksumAsset.browser_download_url -OutFile $checksumPath -UseBasicParsing

$expectedLine = Get-Content $checksumPath | Select-String "tadaima-agent-win-x64.exe"
if (-not $expectedLine) {
    throw "No checksum found for tadaima-agent-win-x64.exe"
}
$expected = $expectedLine.ToString().Split(" ")[0].ToLower()
$actual = (Get-FileHash $binaryPath -Algorithm SHA256).Hash.ToLower()

if ($expected -ne $actual) {
    Remove-Item $binaryPath -Force
    throw "Checksum mismatch! Expected: $expected, Got: $actual"
}

Write-Host "Checksum verified."
Remove-Item $checksumPath -Force

Write-Host "Agent installed to $binaryPath"
