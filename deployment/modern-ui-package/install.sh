#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAYLOAD_DIR="${SCRIPT_DIR}/payload"
MANIFEST_FILE="${SCRIPT_DIR}/manifest.txt"
DEFAULT_WEB_TARGET="/usr/share/icingaweb2"
DEFAULT_PHP_TARGET="/usr/share/php"
DEFAULT_BACKUP_SUBDIR=".modern-ui-backups"

usage() {
  cat <<'EOF'
Usage:
  install.sh install [--target PATH] [--php-target PATH] [--backup-root PATH]
  install.sh restore [--target PATH] [--php-target PATH] [--backup-root PATH] (--latest | --backup-id ID)
  install.sh list-backups [--target PATH] [--backup-root PATH]
  install.sh migrate-mysql [--target PATH] [--backup-root PATH]
      [--mysql-user USER] [--mysql-host HOST]
      [--icingaweb-db DATABASE] [--icingadb-db DATABASE]

Examples:
  bash install.sh install
  bash install.sh migrate-mysql
  bash install.sh restore --latest
  bash install.sh restore --backup-id 20260515-121500

Set MYSQL_PWD when the selected MySQL account requires a password.
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

ensure_parent_dir() {
  local path="$1"
  mkdir -p "$(dirname "$path")"
}

validate_relative_path() {
  local path="$1"
  [[ -n "$path" ]] || fail "Manifest contains an empty path"
  [[ "$path" != /* ]] || fail "Manifest path must be relative: $path"
  [[ "/$path/" != *"/../"* ]] || fail "Manifest path must not contain '..': $path"
}

parse_manifest_entry() {
  local entry="$1"
  SOURCE_REL="${entry%%|*}"

  if [[ "$entry" == *"|"* ]]; then
    DEST_SPEC="${entry#*|}"
  else
    DEST_SPEC="web:${SOURCE_REL}"
  fi

  validate_relative_path "$SOURCE_REL"

  case "$DEST_SPEC" in
    web:*)
      ROOT_ALIAS="web"
      TARGET_REL="${DEST_SPEC#web:}"
      ROOT_DIR="$WEB_TARGET_DIR"
      ;;
    php:*)
      ROOT_ALIAS="php"
      TARGET_REL="${DEST_SPEC#php:}"
      ROOT_DIR="$PHP_TARGET_DIR"
      ;;
    *)
      fail "Unknown manifest target in entry: $entry"
      ;;
  esac

  validate_relative_path "$TARGET_REL"
}

target_path() {
  printf '%s/%s' "$ROOT_DIR" "$TARGET_REL"
}

backup_path() {
  printf '%s/original/%s/%s' "$BACKUP_DIR" "$ROOT_ALIAS" "$TARGET_REL"
}

install_copy() {
  local src="$1"
  local dst="$2"
  cp --preserve=mode,timestamps "$src" "$dst"

  # Archive ownership reflects the build workstation and must not leak to production.
  if [[ "$EUID" -eq 0 ]]; then
    chown root:root "$dst"
  fi
}

backup_copy() {
  local src="$1"
  local dst="$2"
  cp --preserve=mode,ownership,timestamps "$src" "$dst"
}

restore_selinux_context() {
  local path="$1"

  if command -v restorecon >/dev/null 2>&1; then
    if ! restorecon "$path" >/dev/null 2>&1; then
      log "WARNING: restorecon failed for ${path}"
    fi
  fi
}

list_manifest() {
  grep -v '^[[:space:]]*$' "$MANIFEST_FILE"
}

install_files() {
  local backup_id entry src dst bkp
  backup_id="$(date +%Y%m%d-%H%M%S)"
  BACKUP_DIR="${BACKUP_ROOT}/${backup_id}"
  mkdir -p "${BACKUP_DIR}/original"

  local missing_file="${BACKUP_DIR}/missing-before-install.txt"
  : > "$missing_file"

  log "Backup ID: ${backup_id}"
  log "Icinga Web target: ${WEB_TARGET_DIR}"
  log "PHP library target: ${PHP_TARGET_DIR}"
  log "Backup directory: ${BACKUP_DIR}"

  while IFS= read -r entry; do
    [[ -n "$entry" ]] || continue
    parse_manifest_entry "$entry"
    src="${PAYLOAD_DIR}/${SOURCE_REL}"
    dst="$(target_path)"
    bkp="$(backup_path)"

    [[ -f "$src" ]] || fail "Payload file missing: ${src}"

    if [[ -e "$dst" ]]; then
      ensure_parent_dir "$bkp"
      backup_copy "$dst" "$bkp"
    else
      printf '%s:%s\n' "$ROOT_ALIAS" "$TARGET_REL" >> "$missing_file"
    fi

    ensure_parent_dir "$dst"
    install_copy "$src" "$dst"
    restore_selinux_context "$dst"
    log "Installed: ${ROOT_ALIAS}:${TARGET_REL}"
  done < <(list_manifest)

  backup_copy "$MANIFEST_FILE" "${BACKUP_DIR}/manifest.txt"
  cat > "${BACKUP_DIR}/meta.env" <<EOF
BACKUP_ID=${backup_id}
CREATED_AT=$(date -Is)
WEB_TARGET_DIR=${WEB_TARGET_DIR}
PHP_TARGET_DIR=${PHP_TARGET_DIR}
PACKAGE_DIR=${SCRIPT_DIR}
EOF

  tar -czf "${BACKUP_DIR}/original-files.tar.gz" -C "${BACKUP_DIR}/original" . 2>/dev/null || true
  log "Install finished."
  log "To restore: bash install.sh restore --backup-id ${backup_id}"
}

restore_files() {
  [[ -d "$BACKUP_DIR" ]] || fail "Backup not found: ${BACKUP_DIR}"

  local manifest="${BACKUP_DIR}/manifest.txt"
  local missing_file="${BACKUP_DIR}/missing-before-install.txt"
  local entry dst orig key
  [[ -f "$manifest" ]] || fail "Backup manifest not found: ${manifest}"

  log "Restoring backup: $(basename "$BACKUP_DIR")"
  log "Icinga Web target: ${WEB_TARGET_DIR}"
  log "PHP library target: ${PHP_TARGET_DIR}"

  while IFS= read -r entry; do
    [[ -n "$entry" ]] || continue
    parse_manifest_entry "$entry"
    dst="$(target_path)"
    orig="${BACKUP_DIR}/original/${ROOT_ALIAS}/${TARGET_REL}"
    key="${ROOT_ALIAS}:${TARGET_REL}"

    if [[ -f "$orig" ]]; then
      ensure_parent_dir "$dst"
      backup_copy "$orig" "$dst"
      restore_selinux_context "$dst"
      log "Restored original: ${key}"
      continue
    fi

    if [[ -f "$missing_file" ]] && grep -Fxq "$key" "$missing_file"; then
      rm -f "$dst"
      log "Removed newly added: ${key}"
    fi
  done < <(grep -v '^[[:space:]]*$' "$manifest")

  log "Restore finished."
}

pick_latest_backup_id() {
  [[ -d "$BACKUP_ROOT" ]] || fail "No backup root found: ${BACKUP_ROOT}"
  local candidate latest=""
  while IFS= read -r candidate; do
    if [[ -f "${BACKUP_ROOT}/${candidate}/manifest.txt" ]]; then
      latest="$candidate"
    fi
  done < <(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort)
  [[ -n "$latest" ]] || fail "No backup directories in: ${BACKUP_ROOT}"
  printf '%s' "$latest"
}

list_backups() {
  if [[ ! -d "$BACKUP_ROOT" ]]; then
    log "No backups found at ${BACKUP_ROOT}"
    return 0
  fi
  local candidate
  while IFS= read -r candidate; do
    if [[ -f "${BACKUP_ROOT}/${candidate}/manifest.txt" ]]; then
      printf '%s\n' "$candidate"
    fi
  done < <(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort)
}

mysql_scalar() {
  local database="$1"
  local query="$2"
  mysql "${MYSQL_ARGS[@]}" --batch --skip-column-names "$database" -e "$query"
}

apply_mysql_file() {
  local database="$1"
  local file="$2"
  log "Applying $(basename "$file") to ${database}"
  mysql "${MYSQL_ARGS[@]}" "$database" < "$file"
}

migrate_mysql() {
  command -v mysql >/dev/null 2>&1 || fail "mysql client is required"
  command -v mysqldump >/dev/null 2>&1 || fail "mysqldump is required"

  local migration_id migration_backup table_count column_count version_count
  local upgrade_2130="${PAYLOAD_DIR}/schema/mysql-upgrades/2.13.0.sql"
  local upgrade_2131="${PAYLOAD_DIR}/schema/mysql-upgrades/2.13.1.sql"
  local icingadb_schema="${PAYLOAD_DIR}/schema/icingadb/mysql/hostgroup-responsibility.sql"
  require_file "$upgrade_2130"
  require_file "$upgrade_2131"
  require_file "$icingadb_schema"

  MYSQL_ARGS=(--user="$MYSQL_USER")
  if [[ -n "$MYSQL_HOST" ]]; then
    MYSQL_ARGS+=(--host="$MYSQL_HOST")
  fi

  migration_id="db-$(date +%Y%m%d-%H%M%S)"
  migration_backup="${BACKUP_ROOT}/${migration_id}"
  mkdir -p "$migration_backup"
  log "Database backup directory: ${migration_backup}"
  mysqldump "${MYSQL_ARGS[@]}" "$ICINGAWEB_DB" > "${migration_backup}/${ICINGAWEB_DB}.sql"
  mysqldump "${MYSQL_ARGS[@]}" "$ICINGADB_DB" > "${migration_backup}/${ICINGADB_DB}.sql"

  table_count="$(mysql_scalar "$ICINGAWEB_DB" "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'icingaweb_incident_assignment'")"
  if [[ "$table_count" -eq 0 ]]; then
    version_count="$(mysql_scalar "$ICINGAWEB_DB" "SELECT COUNT(*) FROM icingaweb_schema WHERE version = '2.13.0'")"
    [[ "$version_count" -eq 0 ]] || fail "Schema says 2.13.0 is installed, but icingaweb_incident_assignment is missing"
    apply_mysql_file "$ICINGAWEB_DB" "$upgrade_2130"
  fi

  column_count="$(mysql_scalar "$ICINGAWEB_DB" "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'icingaweb_incident_assignment' AND column_name = 'note'")"
  if [[ "$column_count" -eq 0 ]]; then
    version_count="$(mysql_scalar "$ICINGAWEB_DB" "SELECT COUNT(*) FROM icingaweb_schema WHERE version = '2.13.1'")"
    [[ "$version_count" -eq 0 ]] || fail "Schema says 2.13.1 is installed, but the note column is missing"
    apply_mysql_file "$ICINGAWEB_DB" "$upgrade_2131"
  fi

  apply_mysql_file "$ICINGADB_DB" "$icingadb_schema"
  log "MySQL migrations finished."
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

COMMAND="${1:-}"
shift || true

WEB_TARGET_DIR="$DEFAULT_WEB_TARGET"
PHP_TARGET_DIR="$DEFAULT_PHP_TARGET"
BACKUP_ROOT=""
BACKUP_ID=""
USE_LATEST="0"
MYSQL_USER="root"
MYSQL_HOST="localhost"
ICINGAWEB_DB="icingaweb2"
ICINGADB_DB="icingadb"
declare -a MYSQL_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      WEB_TARGET_DIR="${2:-}"
      shift 2
      ;;
    --php-target)
      PHP_TARGET_DIR="${2:-}"
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
    --mysql-user)
      MYSQL_USER="${2:-}"
      shift 2
      ;;
    --mysql-host)
      MYSQL_HOST="${2:-}"
      shift 2
      ;;
    --icingaweb-db)
      ICINGAWEB_DB="${2:-}"
      shift 2
      ;;
    --icingadb-db)
      ICINGADB_DB="${2:-}"
      shift 2
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
  BACKUP_ROOT="${WEB_TARGET_DIR}/${DEFAULT_BACKUP_SUBDIR}"
fi

case "$COMMAND" in
  install)
    [[ -d "$WEB_TARGET_DIR" ]] || fail "Icinga Web target does not exist: ${WEB_TARGET_DIR}"
    [[ -d "$PHP_TARGET_DIR" ]] || fail "PHP library target does not exist: ${PHP_TARGET_DIR}"
    [[ -d "$PAYLOAD_DIR" ]] || fail "Payload directory missing: ${PAYLOAD_DIR}"
    mkdir -p "$BACKUP_ROOT"
    install_files
    ;;
  restore)
    [[ -d "$WEB_TARGET_DIR" ]] || fail "Icinga Web target does not exist: ${WEB_TARGET_DIR}"
    [[ -d "$PHP_TARGET_DIR" ]] || fail "PHP library target does not exist: ${PHP_TARGET_DIR}"
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
  migrate-mysql)
    mkdir -p "$BACKUP_ROOT"
    migrate_mysql
    ;;
  *)
    usage
    fail "Unknown command: ${COMMAND}"
    ;;
esac
