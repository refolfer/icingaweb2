#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAYLOAD_DIR="${SCRIPT_DIR}/payload"
MANIFEST_FILE="${SCRIPT_DIR}/manifest.txt"
DEFAULT_TARGET="/usr/share/icingaweb2"
DEFAULT_BACKUP_SUBDIR=".modern-ui-backups"

usage() {
  cat <<'EOF'
Usage:
  install.sh install [--target PATH] [--backup-root PATH]
  install.sh restore [--target PATH] [--backup-root PATH] (--latest | --backup-id ID)
  install.sh list-backups [--target PATH] [--backup-root PATH]

Examples:
  bash install.sh install --target /usr/share/icingaweb2
  bash install.sh restore --target /usr/share/icingaweb2 --latest
  bash install.sh restore --target /usr/share/icingaweb2 --backup-id 20260515-121500
EOF
}

log() {
  printf '[modern-ui] %s\n' "$*"
}

fail() {
  printf '[modern-ui] ERROR: %s\n' "$*" >&2
  exit 1
}

require_file() {
  local path="$1"
  [[ -f "$path" ]] || fail "Required file not found: $path"
}

target_path() {
  local rel="$1"
  printf '%s/%s' "$TARGET_DIR" "$rel"
}

backup_path() {
  local rel="$1"
  printf '%s/original/%s' "$BACKUP_DIR" "$rel"
}

ensure_parent_dir() {
  local path="$1"
  mkdir -p "$(dirname "$path")"
}

list_manifest() {
  grep -v '^[[:space:]]*$' "$MANIFEST_FILE"
}

install_files() {
  local backup_id
  backup_id="$(date +%Y%m%d-%H%M%S)"
  BACKUP_DIR="${BACKUP_ROOT}/${backup_id}"
  mkdir -p "${BACKUP_DIR}/original"

  local missing_file="${BACKUP_DIR}/missing-before-install.txt"
  : > "$missing_file"

  log "Backup ID: ${backup_id}"
  log "Target directory: ${TARGET_DIR}"
  log "Backup directory: ${BACKUP_DIR}"

  while IFS= read -r rel; do
    [[ -n "$rel" ]] || continue
    local src="${PAYLOAD_DIR}/${rel}"
    local dst
    dst="$(target_path "$rel")"
    local bkp
    bkp="$(backup_path "$rel")"

    [[ -f "$src" ]] || fail "Payload file missing: ${src}"

    if [[ -e "$dst" ]]; then
      ensure_parent_dir "$bkp"
      cp -a "$dst" "$bkp"
    else
      printf '%s\n' "$rel" >> "$missing_file"
    fi

    ensure_parent_dir "$dst"
    cp -a "$src" "$dst"
    log "Installed: $rel"
  done < <(list_manifest)

  cp -a "$MANIFEST_FILE" "${BACKUP_DIR}/manifest.txt"
  cat > "${BACKUP_DIR}/meta.env" <<EOF
BACKUP_ID=${backup_id}
CREATED_AT=$(date -Is)
TARGET_DIR=${TARGET_DIR}
PACKAGE_DIR=${SCRIPT_DIR}
EOF

  tar -czf "${BACKUP_DIR}/original-files.tar.gz" -C "${BACKUP_DIR}/original" . 2>/dev/null || true
  log "Install finished."
  log "To restore: bash install.sh restore --target ${TARGET_DIR} --backup-id ${backup_id}"
}

restore_files() {
  [[ -d "$BACKUP_DIR" ]] || fail "Backup not found: ${BACKUP_DIR}"

  local manifest="${BACKUP_DIR}/manifest.txt"
  local missing_file="${BACKUP_DIR}/missing-before-install.txt"
  [[ -f "$manifest" ]] || fail "Backup manifest not found: ${manifest}"

  log "Restoring backup: $(basename "$BACKUP_DIR")"
  log "Target directory: ${TARGET_DIR}"

  while IFS= read -r rel; do
    [[ -n "$rel" ]] || continue
    local dst
    dst="$(target_path "$rel")"
    local orig="${BACKUP_DIR}/original/${rel}"

    if [[ -f "$orig" ]]; then
      ensure_parent_dir "$dst"
      cp -a "$orig" "$dst"
      log "Restored original: $rel"
      continue
    fi

    if [[ -f "$missing_file" ]] && grep -Fxq "$rel" "$missing_file"; then
      rm -f "$dst"
      log "Removed newly added: $rel"
    fi
  done < <(grep -v '^[[:space:]]*$' "$manifest")

  log "Restore finished."
}

pick_latest_backup_id() {
  [[ -d "$BACKUP_ROOT" ]] || fail "No backup root found: ${BACKUP_ROOT}"
  local latest
  latest="$(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort | tail -n1)"
  [[ -n "$latest" ]] || fail "No backup directories in: ${BACKUP_ROOT}"
  printf '%s' "$latest"
}

list_backups() {
  if [[ ! -d "$BACKUP_ROOT" ]]; then
    log "No backups found at ${BACKUP_ROOT}"
    return 0
  fi
  find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

COMMAND="${1:-}"
shift || true

TARGET_DIR="$DEFAULT_TARGET"
BACKUP_ROOT=""
BACKUP_ID=""
USE_LATEST="0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      TARGET_DIR="${2:-}"
      shift 2
      ;;
    --backup-root)
      BACKUP_ROOT="${2:-}"
      shift 2
      ;;
    --backup-id)
      BACKUP_ID="${2:-}"
      shift 2
      ;;
    --latest)
      USE_LATEST="1"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "Unknown argument: $1"
      ;;
  esac
done

[[ -n "$COMMAND" ]] || { usage; exit 1; }
require_file "$MANIFEST_FILE"

if [[ -z "$BACKUP_ROOT" ]]; then
  BACKUP_ROOT="${TARGET_DIR}/${DEFAULT_BACKUP_SUBDIR}"
fi

case "$COMMAND" in
  install)
    [[ -d "$TARGET_DIR" ]] || fail "Target directory does not exist: ${TARGET_DIR}"
    [[ -d "$PAYLOAD_DIR" ]] || fail "Payload directory missing: ${PAYLOAD_DIR}"
    mkdir -p "$BACKUP_ROOT"
    install_files
    ;;
  restore)
    [[ -d "$TARGET_DIR" ]] || fail "Target directory does not exist: ${TARGET_DIR}"
    if [[ "$USE_LATEST" == "1" ]]; then
      BACKUP_ID="$(pick_latest_backup_id)"
    fi
    [[ -n "$BACKUP_ID" ]] || fail "For restore, provide --backup-id ID or --latest"
    BACKUP_DIR="${BACKUP_ROOT}/${BACKUP_ID}"
    restore_files
    ;;
  list-backups)
    list_backups
    ;;
  *)
    usage
    fail "Unknown command: ${COMMAND}"
    ;;
esac
