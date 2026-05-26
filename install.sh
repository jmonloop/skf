#!/usr/bin/env bash
# Symlink ./skf into a bin directory (default ~/.local/bin).
# Usage: ./install.sh [target-bin-dir]
set -euo pipefail

src="$(cd "$(dirname "$0")" && pwd)/skf"
dir="${1:-$HOME/.local/bin}"

chmod +x "$src"
mkdir -p "$dir"
ln -sf "$src" "$dir/skf"
echo "linked $dir/skf -> $src"

command -v fzf >/dev/null 2>&1 || \
  echo "warning: fzf not installed — interactive mode needs it (brew install fzf / apt install fzf)"

case ":$PATH:" in
  *":$dir:"*) ;;
  *) echo "warning: $dir is not in your PATH — add it in your shell rc" ;;
esac
