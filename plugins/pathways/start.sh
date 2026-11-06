#!/bin/sh
# Starts the Pathways tool, setting up what it needs on the first run, so nobody installs anything by hand.
#
#   sh start.sh <data folder> start|stop|status|check
#
# The data folder is the plugin's own (CLAUDE_PLUGIN_DATA), which survives plugin updates. In it, this
# downloads pinned builds of Node and cloudflared from their publishers, checks each against the SHA-256
# written below before using it, and keeps them for next time. Apple's developer tools (git, python3) come
# from macOS itself: if they're missing, this asks macOS to install them and stops.
# To move to newer versions, change a version and its two SHA-256s together: Node's from nodejs.org/dist/<version>/
# SHASUMS256.txt; cloudflared's from the digest GitHub shows for each release asset. (The checksums in cloudflared's
# release notes differ for the macOS files, as they have for every recent release, so they can't be used.)
# cloudflared is also checked for Cloudflare's Apple signature (its team ID below) when it's set up.
set -eu

# macOS's own tools, never whatever else is first on PATH.
CURL=/usr/bin/curl
SHASUM=/usr/bin/shasum
TAR=/usr/bin/tar

NODE_VERSION=v22.23.4
NODE_SHA256_ARM64=c9e1dbc748b33ed2d14f42445191ecaf14c56259c7a9a26d0042c49ec2b66428
NODE_SHA256_X64=efcc2b0db6f94bf53eddb038fe2b370277a042bd29e4f19b8f8e23598795b819
CLOUDFLARED_VERSION=2026.10.7
CLOUDFLARED_SHA256_ARM64=3586ccf397e98e5f437e60e7c307ca6ac463e110580503af8bb8e6f9ebf831bd
CLOUDFLARED_SHA256_AMD64=02f3edfd87684dd5b705607688e4eb4b323f6e777b81e7b3a85af556aa356848
# Developer ID Application: Cloudflare Inc.
CLOUDFLARED_TEAM_ID=68WVV388M8

ROOT=$(cd "$(dirname "$0")" && pwd)

if [ "$(uname -s)" != Darwin ]; then
  echo "✗ Pathways runs on a Mac only: documents are only kept on encrypted Macs."
  exit 1
fi

# The plugin's data folder; if Claude Code didn't fill it in, a folder of our own.
DATA=${1:-}
case "$DATA" in
  /*) case "$DATA" in *'${'*) DATA="$HOME/Library/Application Support/Pathways" ;; esac ;;
  *) DATA="$HOME/Library/Application Support/Pathways" ;;
esac
[ $# -gt 0 ] && shift
RUNTIME="$DATA/runtime"

# Apple's developer tools: git and python3. macOS installs them itself, after one click.
if ! xcode-select -p >/dev/null 2>&1; then
  xcode-select --install >/dev/null 2>&1 || true
  echo "✗ Pathways needs Apple's developer tools (git and Python)."
  echo "  A macOS window has opened: click Install, wait for it to finish (a few minutes), then type /pathways again."
  exit 3
fi

case "$(uname -m)" in
  arm64) NODE_ARCH=darwin-arm64; NODE_SHA256=$NODE_SHA256_ARM64; CF_ARCH=darwin-arm64; CF_SHA256=$CLOUDFLARED_SHA256_ARM64 ;;
  x86_64) NODE_ARCH=darwin-x64; NODE_SHA256=$NODE_SHA256_X64; CF_ARCH=darwin-amd64; CF_SHA256=$CLOUDFLARED_SHA256_AMD64 ;;
  *) echo "✗ This Mac's processor ($(uname -m)) isn't one Pathways knows."; exit 1 ;;
esac

# Downloads go in a folder of this run's own, so two /pathways starting at once can't swap each other's files.
WORK=
work() {
  if [ -z "$WORK" ]; then
    mkdir -p "$RUNTIME"
    WORK=$(/usr/bin/mktemp -d "$RUNTIME/.download.XXXXXX")
    trap '/bin/rm -rf "$WORK"' EXIT
  fi
}

# Download <url> to <file> and check its SHA-256; anything else is deleted and refused.
fetch() {
  if ! "$CURL" -fsSL --proto '=https' --tlsv1.2 --retry 2 -o "$2" "$1"; then
    rm -f "$2"
    echo "✗ Couldn't download $1. Check the internet connection, then type /pathways again."
    exit 1
  fi
  if ! echo "$3  $2" | "$SHASUM" -a 256 -c - >/dev/null 2>&1; then
    rm -f "$2"
    echo "✗ $1 didn't match its expected fingerprint, so it wasn't used. Tell your Pathways contact."
    exit 1
  fi
}

# Unpack <archive> into <folder>, whole or not at all: a half-finished download never counts as set up.
install_into() {
  partial="$WORK/unpacked"
  rm -rf "$partial"
  mkdir -p "$partial"
  "$TAR" -xzf "$1" -C "$partial"
  rm -f "$1"
  rm -rf "$2"
  mv "$partial" "$2"
}

NODE_HOME="$RUNTIME/node-$NODE_VERSION-$NODE_ARCH"
if [ ! -x "$NODE_HOME/node-$NODE_VERSION-$NODE_ARCH/bin/node" ]; then
  echo "Setting up Node $NODE_VERSION (first run only)…"
  work
  fetch "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-$NODE_ARCH.tar.gz" "$WORK/node.tar.gz" "$NODE_SHA256"
  install_into "$WORK/node.tar.gz" "$NODE_HOME"
fi
NODE="$NODE_HOME/node-$NODE_VERSION-$NODE_ARCH/bin/node"

CF_HOME="$RUNTIME/cloudflared-$CLOUDFLARED_VERSION-$CF_ARCH"
if [ ! -x "$CF_HOME/cloudflared" ]; then
  echo "Setting up cloudflared $CLOUDFLARED_VERSION (first run only)…"
  work
  fetch "https://github.com/cloudflare/cloudflared/releases/download/$CLOUDFLARED_VERSION/cloudflared-$CF_ARCH.tgz" "$WORK/cloudflared.tgz" "$CF_SHA256"
  install_into "$WORK/cloudflared.tgz" "$CF_HOME"
  chmod 755 "$CF_HOME/cloudflared"
  # Signed through Apple's chain by Cloudflare's own Developer ID, not merely signed by someone claiming its team.
  if ! /usr/bin/codesign --verify --strict -R="anchor apple generic and certificate leaf[subject.OU] = \"$CLOUDFLARED_TEAM_ID\"" "$CF_HOME/cloudflared" 2>/dev/null; then
    rm -rf "$CF_HOME"
    echo "✗ cloudflared isn't signed by Cloudflare, so it wasn't used. Tell your Pathways contact."
    exit 1
  fi
fi

# Ours first, then Claude Code's own command-line tool where its installer puts it, then the rest.
PATH="$(dirname "$NODE"):$CF_HOME:$HOME/.local/bin:$PATH"
export PATH
[ -n "$WORK" ] && /bin/rm -rf "$WORK"
exec "$NODE" "$ROOT/bin/pathways.mjs" "$@"
