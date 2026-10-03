#!/usr/bin/env bash
# dsh launcher for the npx-cached DSH CLI.
#
# Why this exists: the running Web GUI was started from npm's npx cache
# (/root/.npm/_npx/<hash>/), which is NOT an installed command. `dsh` is not in
# any PATH, the cache directory name contains a hash that changes on reinstall,
# and the whole tree lives under /root (mode 0700) so it is unreadable to any
# non-root user. This launcher finds the cached entry point at run time instead
# of hard-coding a hash, and picks root's HOME so DSH_HOME, the profile and the
# credentials resolve to /root/.dsh -- the same ones the GUI uses.
#
# Install (as root):
#   sudo install -m 0755 tools/scripts/dsh-launcher.sh /usr/local/bin/dsh
# Then:
#   sudo dsh --profile web --host <wsl-ip> --trusted-host <windows-lan-ip>
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "dsh: must run as root (the CLI and its profile live under /root, mode 0700)." >&2
  echo "     try:  sudo dsh $*" >&2
  exit 1
fi

# root's login PATH is not inherited under plain sudo; add a nvm node if needed.
if ! command -v node >/dev/null 2>&1; then
  for candidate in /root/.nvm/versions/node/*/bin; do
    if [ -x "$candidate/node" ]; then
      PATH="$candidate:$PATH"
      break
    fi
  done
  export PATH
fi
command -v node >/dev/null 2>&1 || { echo "dsh: node not found" >&2; exit 1; }

# Resolve this Harness home the way the CLI does, so profile and credentials match.
if [ -z "${DSH_HOME:-}" ]; then
  if [ -d "${HOME:-/root}/.dsh" ]; then
    export DSH_HOME="${HOME}/.dsh"
  elif [ -d /root/.dsh ]; then
    export DSH_HOME=/root/.dsh
  else
    echo "dsh: no Harness home found (looked at \$HOME/.dsh and /root/.dsh)" >&2
    exit 1
  fi
fi

# Newest cached CLI entry point wins; ls -t puts it last, so keep the last line.
entry=""
while IFS= read -r line; do entry="$line"; done < <(
  ls -t /root/.npm/_npx/*/node_modules/@deepseek-ai/dsh/lib/bin.js 2>/dev/null || true
)
if [ -z "$entry" ] || [ ! -f "$entry" ]; then
  echo "dsh: no cached @deepseek-ai/dsh found under /root/.npm/_npx/." >&2
  echo "     reinstall with:  sudo npm i -g @deepseek-ai/dsh" >&2
  exit 1
fi

exec node "$entry" "$@"
