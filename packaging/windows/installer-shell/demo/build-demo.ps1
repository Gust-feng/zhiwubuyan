param(
  [string]$OutputDirectory = "installer-demo-portable"
)

$ErrorActionPreference = "Stop"

$demoDirectory = $PSScriptRoot
$projectDirectory = [IO.Path]::GetFullPath((Join-Path $demoDirectory "..\..\..\.."))
$stageName = "installer-demo-stage-$PID"
$stageDirectory = Join-Path $projectDirectory "output\$stageName"
$rendererDirectory = Join-Path $projectDirectory "dist\installer"
$rootPackage = Get-Content -Raw (Join-Path $projectDirectory "package.json") | ConvertFrom-Json
$electronVersion = [string]$rootPackage.devDependencies.electron
$electronArchiveName = "electron-v$electronVersion-win32-x64.zip"
$electronCache = Join-Path $env:LOCALAPPDATA "electron\Cache"
$electronArchive = Get-ChildItem -LiteralPath $electronCache -Recurse -File -Filter $electronArchiveName |
  Select-Object -First 1 -ExpandProperty FullName

if (-not $electronArchive) {
  throw "未找到 Electron $electronVersion 的本地缓存，请先运行一次 electron-builder。"
}

New-Item -ItemType Directory -Path $stageDirectory | Out-Null
Expand-Archive -LiteralPath $electronArchive -DestinationPath $stageDirectory
Rename-Item -LiteralPath (Join-Path $stageDirectory "electron.exe") -NewName "知无不言安装器演示.exe"

$appDirectory = Join-Path $stageDirectory "resources\app"
$installerDirectory = Join-Path $stageDirectory "resources\installer"
New-Item -ItemType Directory -Force -Path $appDirectory, $installerDirectory | Out-Null
Copy-Item -LiteralPath (Join-Path $demoDirectory "main.cjs") -Destination $appDirectory
Copy-Item -LiteralPath (Join-Path $demoDirectory "preload.cjs") -Destination $appDirectory
Copy-Item -LiteralPath (Join-Path $demoDirectory "package.json") -Destination $appDirectory
Copy-Item -Path (Join-Path $rendererDirectory "*") -Destination $installerDirectory -Recurse -Force

Push-Location $projectDirectory
try {
  pnpm exec electron-builder `
    --projectDir packaging/windows/installer-shell/demo `
    --config electron-builder.yml `
    --config.directories.output "../../../../output/$OutputDirectory" `
    --prepackaged "../../../../output/$stageName" `
    --win portable `
    --x64
  if ($LASTEXITCODE -ne 0) {
    throw "electron-builder 退出码：$LASTEXITCODE"
  }
} finally {
  Pop-Location
  if (Test-Path -LiteralPath $stageDirectory) {
    Remove-Item -LiteralPath $stageDirectory -Recurse -Force -ErrorAction SilentlyContinue
  }
}
