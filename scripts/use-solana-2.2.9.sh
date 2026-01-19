#!/usr/bin/env bash
set -e
sh -c "$(curl -sSfL https://release.anza.xyz/v2.2.9/install)" >/dev/null
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
hash -r
solana --version
