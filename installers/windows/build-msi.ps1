# Tadaima Agent — Windows MSI build script
# Requires WiX Toolset v4+ (dotnet tool)

$ErrorActionPreference = "Stop"

# Ensure WiX is installed
if (-not (Get-Command wix -ErrorAction SilentlyContinue)) {
    Write-Host "Installing WiX Toolset..."
    dotnet tool install --global wix
}

# Ensure the WiX UI extension is available
wix extension add WixToolset.UI.wixext/4.0.0 2>$null

Set-Location $PSScriptRoot

# Create a placeholder file (the real binary is downloaded at install time)
if (-not (Test-Path "placeholder.txt")) {
    Set-Content "placeholder.txt" "Placeholder — binary downloaded during install"
}

# Create a minimal license.rtf if not present
if (-not (Test-Path "license.rtf")) {
    Set-Content "license.rtf" "{\rtf1 MIT License. See https://github.com/psychout98/tadaima/blob/main/LICENSE}"
}

Write-Host "Building MSI..."
wix build tadaima.wxs -o Tadaima-Setup.msi -ext WixToolset.UI.wixext

Write-Host "Built: Tadaima-Setup.msi"
