#!/bin/sh
# install.sh — Squadrn installer
# Usage: curl -fsSL https://squadrn.dev/install.sh | sh

set -e

REPO="squadrn/squadrn"
INSTALL_DIR="${SQUADRN_INSTALL_DIR:-$HOME/.squadrn}"
BIN_DIR="${SQUADRN_BIN_DIR:-$HOME/.local/bin}"

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

# Check required commands
for cmd in curl uname mkdir chmod; do
  command -v "$cmd" >/dev/null 2>&1 || error "Required command not found: $cmd"
done

# Detect OS
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
case $OS in
  linux)  OS="linux" ;;
  darwin) OS="darwin" ;;
  *)      error "Unsupported OS: $OS (only Linux and macOS are supported)" ;;
esac

# Detect architecture
ARCH=$(uname -m)
case $ARCH in
  x86_64)         ARCH="x86_64" ;;
  arm64|aarch64)  ARCH="aarch64" ;;
  *)              error "Unsupported architecture: $ARCH" ;;
esac

info "Detected platform: ${OS}-${ARCH}"

# Create directories
mkdir -p "$INSTALL_DIR" || error "Cannot create directory: $INSTALL_DIR (try: sudo mkdir -p $INSTALL_DIR)"
mkdir -p "$BIN_DIR"     || error "Cannot create directory: $BIN_DIR (try: sudo mkdir -p $BIN_DIR)"

# Check write permissions
[ -w "$INSTALL_DIR" ] || error "No write permission to $INSTALL_DIR"
[ -w "$BIN_DIR" ]     || error "No write permission to $BIN_DIR"

# Get latest version
info "Fetching latest version..."
VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | cut -d'"' -f4)
[ -z "$VERSION" ] && error "Could not determine latest version. Check your network connection."

info "Installing Squadrn $VERSION..."

# Download binary
URL="https://github.com/$REPO/releases/download/$VERSION/squadrn-$OS-$ARCH"
curl -fsSL "$URL" -o "$BIN_DIR/squadrn" || error "Download failed. Binary may not exist for $OS-$ARCH."
chmod +x "$BIN_DIR/squadrn"

# Verify binary works
if ! "$BIN_DIR/squadrn" --version >/dev/null 2>&1; then
  warn "Binary downloaded but could not run. You may need to check your system compatibility."
fi

# Check if BIN_DIR is in PATH
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    warn "$BIN_DIR is not in your PATH."
    warn "Add it with:  export PATH=\"$BIN_DIR:\$PATH\""
    ;;
esac

echo ""
info "Squadrn $VERSION installed successfully!"
echo ""
echo "  Next steps:"
echo ""
echo "    squadrn init      # Interactive setup wizard"
echo "    squadrn start     # Start the gateway daemon"
echo "    squadrn status    # Check running state"
echo ""
echo "  Documentation: https://github.com/squadrn/squadrn/tree/main/docs"
echo ""
