#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

LIB_RS="$ROOT_DIR/programs/moat_registry/programs/moat_registry/src/lib.rs"
ANCHOR_TOML="$ROOT_DIR/programs/moat_registry/Anchor.toml"
CONSTANTS_TS="$ROOT_DIR/apps/moat-demo/src/lib/solana/constants.ts"
IDL_JSON="$ROOT_DIR/apps/moat-demo/src/lib/solana/moat_registry.idl.json"
KEYPAIR_JSON="$ROOT_DIR/programs/moat_registry/target/deploy/moat_registry-keypair.json"

if [[ ! -f "$LIB_RS" || ! -f "$ANCHOR_TOML" ]]; then
  echo "error: missing program files; expected lib.rs and Anchor.toml" >&2
  exit 1
fi

extract_id() {
  local pattern="$1"
  local file="$2"
  local value
  value=$(rg -n "$pattern" "$file" | sed -E 's/.*"([A-Za-z0-9]+)".*/\1/' | head -n1)
  if [[ -z "$value" ]]; then
    echo "error: failed to extract program id from $file" >&2
    exit 1
  fi
  echo "$value"
}

ID_LIB=$(extract_id "declare_id!" "$LIB_RS")
ID_TOML=$(extract_id "^moat_registry\s*=\s*\"" "$ANCHOR_TOML")

if [[ "$ID_LIB" != "$ID_TOML" ]]; then
  echo "error: program id mismatch between lib.rs and Anchor.toml" >&2
  echo "lib.rs:   $ID_LIB" >&2
  echo "Anchor:   $ID_TOML" >&2
  exit 1
fi

EXPECTED="$ID_LIB"

if [[ -f "$CONSTANTS_TS" ]]; then
  ID_CONST=$(extract_id "MOAT_PROGRAM_ID" "$CONSTANTS_TS")
  if [[ "$ID_CONST" != "$EXPECTED" ]]; then
    echo "error: constants.ts program id mismatch" >&2
    echo "expected: $EXPECTED" >&2
    echo "actual:   $ID_CONST" >&2
    exit 1
  fi
fi

if [[ -f "$IDL_JSON" ]]; then
  ID_IDL=$(extract_id "\"address\"" "$IDL_JSON")
  if [[ "$ID_IDL" != "$EXPECTED" ]]; then
    echo "error: IDL program id mismatch" >&2
    echo "expected: $EXPECTED" >&2
    echo "actual:   $ID_IDL" >&2
    exit 1
  fi
fi

if [[ -f "$KEYPAIR_JSON" ]]; then
  if ! command -v solana-keygen >/dev/null 2>&1; then
    echo "error: solana-keygen not found; cannot verify keypair" >&2
    exit 1
  fi
  KEYPAIR_PUBKEY=$(solana-keygen pubkey "$KEYPAIR_JSON")
  if [[ "$KEYPAIR_PUBKEY" != "$EXPECTED" ]]; then
    echo "error: keypair does not match program id" >&2
    echo "expected: $EXPECTED" >&2
    echo "keypair:  $KEYPAIR_PUBKEY" >&2
    echo "hint: do not run anchor build/deploy until keypair matches" >&2
    exit 1
  fi
fi

echo "ok: program id is consistent ($EXPECTED)"
