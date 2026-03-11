#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────
# Mach6 — One-Command Installer
# 
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/Artifact-Virtual/mach6/master/install.sh | bash
#   # or locally:
#   bash install.sh [--dir /path/to/install]
#
# What it does:
#   1. Checks prerequisites (Node.js 20+, git)
#   2. Clones the repo (or updates if already cloned)
#   3. Installs dependencies
#   4. Compiles TypeScript
#   5. Launches the setup wizard → generates mach6.json + .env
#   6. Starts the daemon → WhatsApp QR or Discord ready
#
# Built by Artifact Virtual. MIT License.
# ──────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Colors ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; }
info() { echo -e "  ${CYAN}→${NC} $1"; }
warn() { echo -e "  ${YELLOW}!${NC} $1"; }

# ── Banner ──
echo ""
echo -e "${MAGENTA}╔══════════════════════════════════════════════╗${NC}"
echo -e "${MAGENTA}║${NC}  ${BOLD}Mach6${NC} — AI Agent Framework Installer        ${MAGENTA}║${NC}"
echo -e "${MAGENTA}║${NC}  ${DIM}Single process. Any machine. Your data.${NC}     ${MAGENTA}║${NC}"
echo -e "${MAGENTA}╚══════════════════════════════════════════════╝${NC}"
echo ""

# ── Parse args ──
INSTALL_DIR=""
SKIP_WIZARD=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir)    INSTALL_DIR="$2"; shift 2 ;;
    --skip-wizard) SKIP_WIZARD=true; shift ;;
    -h|--help)
      echo "Usage: bash install.sh [--dir /path] [--skip-wizard]"
      echo ""
      echo "  --dir PATH       Install location (default: ./mach6)"
      echo "  --skip-wizard    Skip interactive setup (use existing config)"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Default install dir
if [ -z "$INSTALL_DIR" ]; then
  INSTALL_DIR="$(pwd)/mach6"
fi

# ── Step 1: Prerequisites ──
echo -e "${BOLD}[1/5] Checking prerequisites${NC}"

# Node.js
if command -v node &>/dev/null; then
  NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_VERSION" -ge 20 ]; then
    ok "Node.js $(node -v)"
  else
    fail "Node.js $(node -v) — need v20 or later"
    echo ""
    echo "  Install Node.js 20+:"
    echo "    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
    echo "    sudo apt-get install -y nodejs"
    exit 1
  fi
else
  fail "Node.js not found"
  echo ""
  echo "  Install Node.js 20+:"
  echo "    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
  echo "    sudo apt-get install -y nodejs"
  exit 1
fi

# npm
if command -v npm &>/dev/null; then
  ok "npm $(npm -v)"
else
  fail "npm not found (should come with Node.js)"
  exit 1
fi

# git
if command -v git &>/dev/null; then
  ok "git $(git --version | awk '{print $3}')"
else
  fail "git not found"
  echo "  Install: sudo apt-get install git"
  exit 1
fi

echo ""

# ── Step 2: Clone or Update ──
echo -e "${BOLD}[2/5] Getting Mach6 source${NC}"

REPO_URL="https://github.com/Artifact-Virtual/mach6.git"

if [ -d "$INSTALL_DIR/.git" ]; then
  info "Existing installation found at $INSTALL_DIR"
  cd "$INSTALL_DIR"
  
  # Save user config before pull
  SAVED_CONFIG=false
  if [ -f mach6.json ]; then
    cp mach6.json mach6.json.bak
    SAVED_CONFIG=true
  fi
  if [ -f .env ]; then
    cp .env .env.bak
  fi
  
  git pull --rebase origin master 2>/dev/null || git pull origin master
  ok "Updated to latest ($(git log --oneline -1 | cut -d' ' -f1))"
  
  # Restore config
  if [ "$SAVED_CONFIG" = true ]; then
    mv mach6.json.bak mach6.json
    ok "Preserved existing mach6.json"
  fi
  if [ -f .env.bak ]; then
    mv .env.bak .env
    ok "Preserved existing .env"
  fi
else
  info "Cloning Mach6..."
  git clone "$REPO_URL" "$INSTALL_DIR" 2>/dev/null
  cd "$INSTALL_DIR"
  ok "Cloned to $INSTALL_DIR ($(git log --oneline -1 | cut -d' ' -f1))"
fi

echo ""

# ── Step 3: Install Dependencies ──
echo -e "${BOLD}[3/5] Installing dependencies${NC}"

# Clean install for reproducibility
if [ -d node_modules ]; then
  info "Cleaning previous node_modules..."
  rm -rf node_modules
fi

npm install --production=false 2>/dev/null | tail -1
ok "Dependencies installed ($(ls node_modules | wc -l) packages)"

echo ""

# ── Step 4: Compile TypeScript ──
echo -e "${BOLD}[4/5] Compiling TypeScript${NC}"

npx tsc 2>/dev/null
ok "Compiled to dist/ ($(find dist -name '*.js' | wc -l) files)"

echo ""

# ── Step 5: Setup ──
echo -e "${BOLD}[5/5] Setup${NC}"

if [ -f mach6.json ] && [ "$SKIP_WIZARD" = false ]; then
  echo ""
  echo -e "  ${YELLOW}Existing configuration found.${NC}"
  echo -e "  ${DIM}Run with --skip-wizard to keep it, or continue to reconfigure.${NC}"
  echo ""
  read -rp "  Reconfigure? [y/N] " RECONFIG
  if [[ ! "$RECONFIG" =~ ^[Yy]$ ]]; then
    SKIP_WIZARD=true
  fi
fi

if [ "$SKIP_WIZARD" = true ]; then
  if [ -f mach6.json ]; then
    ok "Using existing configuration"
  else
    warn "No mach6.json found — run 'node dist/index.js init' to configure"
  fi
else
  echo ""
  info "Launching setup wizard..."
  echo ""
  node dist/cli/cli.js init
fi

# ── Launch ──
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║${NC}  ${BOLD}Mach6 installed successfully!${NC}               ${GREEN}║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Start the daemon:${NC}"
echo -e "    cd $INSTALL_DIR"
echo -e "    node dist/index.js --config=mach6.json"
echo ""
echo -e "  ${BOLD}Or run as background service:${NC}"
echo -e "    node dist/index.js start --config=mach6.json"
echo ""
echo -e "  ${DIM}Docs: https://github.com/Artifact-Virtual/mach6${NC}"
echo ""

# Auto-start if wizard completed successfully
if [ -f mach6.json ] && [ "$SKIP_WIZARD" = false ]; then
  echo ""
  read -rp "  Start Mach6 now? [Y/n] " START_NOW
  if [[ ! "$START_NOW" =~ ^[Nn]$ ]]; then
    echo ""
    info "Starting Mach6..."
    echo ""
    exec node dist/index.js --config=mach6.json
  fi
fi
