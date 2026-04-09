<#
.SYNOPSIS
  Build Tadaima-Setup.msi (beta, unsigned).

.DESCRIPTION
  Stages the bundled Node runtime, the agent tarball, the first-run
  config GUI, the tray app, and the native MSI custom actions into a
  single directory, then invokes `wix build` to produce the MSI.

  PowerShell is used *only* as the build script — never as an MSI
  runtime custom action. Runtime custom actions are signed .NET 8
  console apps under msi/CustomActions/. This distinction matters for
  SmartScreen reputation; see INSTALLER_V2_SPEC.md Component 3 and 6.

.PARAMETER Configuration
  dotnet build configuration (Debug|Release). Default: Release.

.PARAMETER OutputDir
  Where the final MSI is written. Default: installers\v2\windows\dist.
#>

[CmdletBinding()]
param(
    [string]$Configuration = "Release",
    [string]$OutputDir = "$PSScriptRoot\dist"
)

$ErrorActionPreference = "Stop"

$Root      = $PSScriptRoot
$RepoRoot  = Resolve-Path (Join-Path $Root "..\..\..")
$Shared    = Join-Path $RepoRoot "installers\v2\shared"
$Staging   = Join-Path $Root ".staging"

Write-Host "[build.ps1] cleaning $Staging and $OutputDir"
if (Test-Path $Staging)   { Remove-Item $Staging   -Recurse -Force }
if (Test-Path $OutputDir) { Remove-Item $OutputDir -Recurse -Force }
New-Item -ItemType Directory -Path $Staging, $OutputDir | Out-Null

# 1. Node runtime
Write-Host "[build.ps1] fetching bundled Node runtime"
$nodePath = & node "$Shared\fetch-node-runtime.mjs" win-x64 --out "$Staging\node-win-x64"
if ($LASTEXITCODE -ne 0) { throw "fetch-node-runtime.mjs failed" }
# `fetch-node-runtime.mjs` prints the extracted path as the final line.
$nodePath = ($nodePath -split "`n")[-1].Trim()
# WiX expects Contents/Resources/runtime/, so we rename the extracted
# node-vX.Y.Z-win-x64 directory to just `runtime`.
$runtimeDir = Join-Path $Staging "runtime"
Copy-Item -Recurse -Path $nodePath -Destination $runtimeDir

# 2. Agent tarball
Write-Host "[build.ps1] packing agent tarball"
$tarballPath = & node "$Shared\pack-agent.mjs" --out "$Staging\agent-tarball"
if ($LASTEXITCODE -ne 0) { throw "pack-agent.mjs failed" }
$tarballPath = ($tarballPath -split "`n")[-1].Trim()
Copy-Item -Path $tarballPath -Destination (Join-Path $Staging "agent-tarball.tgz")

# 3. tray-config.json — heartbeat interval, read from the agent source
Write-Host "[build.ps1] emitting tray-config.json"
$statusFileTs = Join-Path $RepoRoot "packages\agent\src\status-file.ts"
$heartbeatMatch = Select-String -Path $statusFileTs -Pattern "STATUS_HEARTBEAT_INTERVAL_MS = ([0-9_]+)"
if (-not $heartbeatMatch) { throw "could not read STATUS_HEARTBEAT_INTERVAL_MS from $statusFileTs" }
$heartbeat = ($heartbeatMatch.Matches[0].Groups[1].Value -replace "_", "")
@{ statusHeartbeatIntervalMs = [int]$heartbeat } |
    ConvertTo-Json |
    Out-File -Encoding utf8 (Join-Path $Staging "tray-config.json")

# 4. Build the config GUI and tray app
Write-Host "[build.ps1] publishing TadaimaConfig"
& dotnet publish "$Root\config-gui\TadaimaConfig.csproj" `
    -c $Configuration `
    -r win-x64 `
    --self-contained true `
    -o "$Staging\config"
if ($LASTEXITCODE -ne 0) { throw "dotnet publish config-gui failed" }

Write-Host "[build.ps1] publishing TadaimaTray"
& dotnet publish "$Root\tray-app\TadaimaTray.csproj" `
    -c $Configuration `
    -r win-x64 `
    --self-contained true `
    -o "$Staging\tray"
if ($LASTEXITCODE -ne 0) { throw "dotnet publish tray-app failed" }

# 5. Build the four MSI custom actions
$caDir = Join-Path $Staging "CustomActions"
New-Item -ItemType Directory -Path $caDir | Out-Null
$customActions = @(
    @{ Name = "InstallAgent";        Proj = "$Root\msi\CustomActions\InstallAgent\InstallAgent.csproj" },
    @{ Name = "RunUserConfigGui";    Proj = "$Root\msi\CustomActions\RunUserConfigGui\RunUserConfigGui.csproj" },
    @{ Name = "RegisterTask";        Proj = "$Root\msi\CustomActions\RegisterTask\RegisterTask.csproj" },
    @{ Name = "RegisterTrayStartup"; Proj = "$Root\msi\CustomActions\RegisterTrayStartup\RegisterTrayStartup.csproj" }
)
foreach ($ca in $customActions) {
    Write-Host "[build.ps1] publishing $($ca.Name)"
    $publishDir = Join-Path $Staging "ca-$($ca.Name)"
    & dotnet publish $ca.Proj `
        -c $Configuration `
        -r win-x64 `
        --self-contained true `
        /p:PublishSingleFile=true `
        -o $publishDir
    if ($LASTEXITCODE -ne 0) { throw "dotnet publish $($ca.Name) failed" }
    Copy-Item -Path (Join-Path $publishDir "$($ca.Name).exe") -Destination $caDir
}

# 6. Run WiX
Write-Host "[build.ps1] running wix build"
$wxs = Join-Path $Root "msi\Tadaima.wxs"
$msi = Join-Path $OutputDir "Tadaima-Setup.msi"
& wix build $wxs `
    -define "StagingDir=$Staging" `
    -arch x64 `
    -out $msi
if ($LASTEXITCODE -ne 0) { throw "wix build failed" }

# 7. (Beta) no signtool step. Signing is added later by
# CODE_SIGNING_INSTRUCTIONS.md as a pipeline-only change.

Write-Host "[build.ps1] done"
Write-Host "  msi: $msi"
