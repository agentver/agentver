#!/bin/sh
set -e

# ---------------------------------------------------------------------------
# Agentver CLI installer
# Usage: curl -fsSL https://agentver.com/install.sh | sh
# ---------------------------------------------------------------------------

MINIMUM_NODE_VERSION=20

# Colours (only when outputting to a terminal)
if [ -t 1 ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  CYAN='\033[0;36m'
  RESET='\033[0m'
else
  RED=''
  GREEN=''
  CYAN=''
  RESET=''
fi

info()  { printf "${CYAN}%s${RESET}\n" "$1"; }
ok()    { printf "${GREEN}%s${RESET}\n" "$1"; }
error() { printf "${RED}Error: %s${RESET}\n" "$1" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------

# Check Node.js is installed
if ! command -v node >/dev/null 2>&1; then
  error "Node.js is not installed. Please install Node.js >= ${MINIMUM_NODE_VERSION} first: https://nodejs.org"
fi

# Check Node.js version
NODE_VERSION=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
if [ "$NODE_VERSION" -lt "$MINIMUM_NODE_VERSION" ]; then
  error "Node.js >= ${MINIMUM_NODE_VERSION} is required (found v${NODE_VERSION}). Please upgrade: https://nodejs.org"
fi

# Check npm is available
if ! command -v npm >/dev/null 2>&1; then
  error "npm is not installed. Please install npm first."
fi

# ---------------------------------------------------------------------------
# Install
# ---------------------------------------------------------------------------

info "Installing agentver CLI..."

npm install -g @agentver/cli

INSTALLED_VERSION=$(agentver --version 2>/dev/null || echo "unknown")

echo ""
ok "agentver v${INSTALLED_VERSION} installed successfully!"
echo ""
info "Get started:"
echo "  agentver login       Sign in to your account"
echo "  agentver init        Initialise a new skill"
echo "  agentver search      Search the registry"
echo "  agentver --help      Show all commands"
echo ""
