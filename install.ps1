# ──────────────────────────────────────────────────────────────────
# Mach6 — One-Command Installer (Windows PowerShell)
#
# Usage:
#   irm https://raw.githubusercontent.com/Artifact-Virtual/mach6/master/install.ps1 | iex
#   # or locally:
#   .\install.ps1 [-Dir C:\mach6] [-SkipWizard]
#
# Built by Artifact Virtual. MIT License.
# ──────────────────────────────────────────────────────────────────
param(
    [string]$Dir = "",
    [switch]$SkipWizard
)

$ErrorActionPreference = "Stop"

function Write-Ok($msg)   { Write-Host "  ✓ $msg" -ForegroundColor Green }
function Write-Fail($msg) { Write-Host "  ✗ $msg" -ForegroundColor Red }
function Write-Info($msg)  { Write-Host "  → $msg" -ForegroundColor Cyan }
function Write-Warn($msg)  { Write-Host "  ! $msg" -ForegroundColor Yellow }

# ── Banner ──
Write-Host ""
Write-Host "╔══════════════════════════════════════════════╗" -ForegroundColor Magenta
Write-Host "║  Mach6 — AI Agent Framework Installer        ║" -ForegroundColor Magenta
Write-Host "║  Single process. Any machine. Your data.     ║" -ForegroundColor Magenta
Write-Host "╚══════════════════════════════════════════════╝" -ForegroundColor Magenta
Write-Host ""

# Default dir
if (-not $Dir) { $Dir = Join-Path (Get-Location) "mach6" }

# ── Step 1: Prerequisites ──
Write-Host "[1/5] Checking prerequisites" -NoNewline
Write-Host ""

# Node.js
try {
    $nodeVer = (node -v) -replace 'v',''
    $major = [int]($nodeVer.Split('.')[0])
    if ($major -ge 20) {
        Write-Ok "Node.js v$nodeVer"
    } else {
        Write-Fail "Node.js v$nodeVer — need v20+"
        Write-Host "  Download: https://nodejs.org/"
        exit 1
    }
} catch {
    Write-Fail "Node.js not found"
    Write-Host "  Download: https://nodejs.org/"
    exit 1
}

# npm
try { $npmVer = npm -v; Write-Ok "npm $npmVer" }
catch { Write-Fail "npm not found"; exit 1 }

# git
try { $gitVer = (git --version) -replace 'git version ',''; Write-Ok "git $gitVer" }
catch { Write-Fail "git not found — https://git-scm.com/"; exit 1 }

Write-Host ""

# ── Step 2: Clone or Update ──
Write-Host "[2/5] Getting Mach6 source"

$repoUrl = "https://github.com/Artifact-Virtual/mach6.git"

if (Test-Path (Join-Path $Dir ".git")) {
    Write-Info "Existing installation at $Dir"
    Set-Location $Dir
    
    # Preserve config
    $savedConfig = $false
    if (Test-Path "mach6.json") {
        Copy-Item "mach6.json" "mach6.json.bak" -Force
        $savedConfig = $true
    }
    if (Test-Path ".env") {
        Copy-Item ".env" ".env.bak" -Force
    }
    
    git pull --rebase origin master 2>$null
    if ($savedConfig) {
        Move-Item "mach6.json.bak" "mach6.json" -Force
        Write-Ok "Preserved existing mach6.json"
    }
    if (Test-Path ".env.bak") {
        Move-Item ".env.bak" ".env" -Force
        Write-Ok "Preserved existing .env"
    }
    
    $hash = (git log --oneline -1).Split(' ')[0]
    Write-Ok "Updated to latest ($hash)"
} else {
    Write-Info "Cloning Mach6..."
    git clone $repoUrl $Dir 2>$null
    Set-Location $Dir
    $hash = (git log --oneline -1).Split(' ')[0]
    Write-Ok "Cloned to $Dir ($hash)"
}

Write-Host ""

# ── Step 3: Install Dependencies ──
Write-Host "[3/5] Installing dependencies"

if (Test-Path "node_modules") {
    Write-Info "Cleaning previous node_modules..."
    Remove-Item -Recurse -Force "node_modules"
}

npm install --production=false 2>$null | Select-Object -Last 1
$pkgCount = (Get-ChildItem "node_modules" -Directory).Count
Write-Ok "Dependencies installed ($pkgCount packages)"

Write-Host ""

# ── Step 4: Compile TypeScript ──
Write-Host "[4/5] Compiling TypeScript"

npx tsc 2>$null
$jsCount = (Get-ChildItem "dist" -Recurse -Filter "*.js").Count
Write-Ok "Compiled to dist/ ($jsCount files)"

Write-Host ""

# ── Step 5: Setup ──
Write-Host "[5/5] Setup"

$runWizard = -not $SkipWizard

if ((Test-Path "mach6.json") -and (-not $SkipWizard)) {
    Write-Host ""
    Write-Warn "Existing configuration found."
    $reconfig = Read-Host "  Reconfigure? [y/N]"
    if ($reconfig -ne 'y' -and $reconfig -ne 'Y') {
        $runWizard = $false
    }
}

if ($runWizard) {
    Write-Host ""
    Write-Info "Launching setup wizard..."
    Write-Host ""
    node dist/cli/cli.js init
} elseif (Test-Path "mach6.json") {
    Write-Ok "Using existing configuration"
} else {
    Write-Warn "No mach6.json — run: node dist/cli/cli.js init"
}

# ── Done ──
Write-Host ""
Write-Host "╔══════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║  Mach6 installed successfully!               ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  Start the daemon:"
Write-Host "    cd $Dir"
Write-Host "    node dist/index.js --config=mach6.json"
Write-Host ""

if ((Test-Path "mach6.json") -and $runWizard) {
    $startNow = Read-Host "  Start Mach6 now? [Y/n]"
    if ($startNow -ne 'n' -and $startNow -ne 'N') {
        Write-Host ""
        Write-Info "Starting Mach6..."
        Write-Host ""
        node dist/index.js --config=mach6.json
    }
}
