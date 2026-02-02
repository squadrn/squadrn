#!/bin/sh
# uninstall.sh — Squadrn uninstaller
# Usage: curl -fsSL https://squadrn.dev/uninstall.sh | sh

set -e

INSTALL_DIR="${SQUADRN_INSTALL_DIR:-$HOME/.squadrn}"
BIN_DIR="${SQUADRN_BIN_DIR:-$HOME/.local/bin}"
BIN_PATH="$BIN_DIR/squadrn"

# Colors (disabled if not a terminal)
if [ -t 1 ]; then
  BOLD="\033[1m"
  GREEN="\033[32m"
  RED="\033[31m"
  YELLOW="\033[33m"
  RESET="\033[0m"
else
  BOLD="" GREEN="" RED="" YELLOW="" RESET=""
fi

info()  { printf "${BOLD}${GREEN}info${RESET}  %s\n" "$1"; }
warn()  { printf "${BOLD}${YELLOW}warn${RESET}  %s\n" "$1"; }
error() { printf "${BOLD}${RED}error${RESET} %s\n" "$1" >&2; exit 1; }

# Stop the gateway if it's running
if [ -f "$INSTALL_DIR/gateway.pid" ]; then
  PID=$(cat "$INSTALL_DIR/gateway.pid" 2>/dev/null)
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    info "Stopping running gateway (PID $PID)..."
    kill "$PID" 2>/dev/null || true
    sleep 1
    # Force kill if still running
    if kill -0 "$PID" 2>/dev/null; then
      warn "Gateway did not stop gracefully, forcing..."
      kill -9 "$PID" 2>/dev/null || true
    fi
    info "Gateway stopped"
  fi
fi

# Remove binary
if [ -f "$BIN_PATH" ]; then
  rm -f "$BIN_PATH"
  info "Removed binary: $BIN_PATH"
else
  warn "Binary not found at $BIN_PATH (already removed?)"
fi

# Ask about data directory
if [ -d "$INSTALL_DIR" ]; then
  if [ -t 0 ]; then
    printf "\n  Remove all Squadrn data at ${BOLD}%s${RESET}?\n" "$INSTALL_DIR"
    printf "  This includes config, database, sessions, and plugins.\n"
    printf "  [y/N] "
    read -r CONFIRM
    case "$CONFIRM" in
      y|Y|yes|YES)
        rm -rf "$INSTALL_DIR"
        info "Removed data directory: $INSTALL_DIR"
        ;;
      *)
        warn "Kept data directory: $INSTALL_DIR"
        warn "Remove it manually with: rm -rf $INSTALL_DIR"
        ;;
    esac
  else
    # Non-interactive: keep data, warn the user
    warn "Data directory kept: $INSTALL_DIR"
    warn "Remove it manually with: rm -rf $INSTALL_DIR"
  fi
else
  info "No data directory found at $INSTALL_DIR"
fi

echo ""
info "Squadrn has been uninstalled."
echo ""
