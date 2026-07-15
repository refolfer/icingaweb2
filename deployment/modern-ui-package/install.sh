#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAYLOAD_DIR="${SCRIPT_DIR}/payload"
MANIFEST_FILE="${SCRIPT_DIR}/manifest.txt"
REMOVED_PATHS_FILE="${SCRIPT_DIR}/removed-paths.txt"
DEFAULT_WEB_TARGET="/usr/share/icingaweb2"
DEFAULT_PHP_TARGET="/usr/share/php"
DEFAULT_CONFIG_DIR="/etc/icingaweb2"
DEFAULT_CONFIG_RESOURCE="icingaweb2"
DEFAULT_BACKUP_SUBDIR=".modern-ui-backups"

usage() {
  cat <<'EOF'
Usage:
  install.sh install [--target PATH] [--php-target PATH] [--config-dir PATH]
      [--config-resource RESOURCE] [--backup-root PATH]
  install.sh restore [--target PATH] [--php-target PATH] [--config-dir PATH]
      [--backup-root PATH] (--latest | --backup-id ID)
  install.sh list-backups [--target PATH] [--backup-root PATH]
  install.sh migrate-mysql [--target PATH] [--backup-root PATH]
      [--mysql-user USER] [--mysql-host HOST]
      [--icingaweb-db DATABASE] [--icingadb-db DATABASE]
  install.sh migrate-pgsql [--target PATH] [--backup-root PATH]
      [--pgsql-user USER] [--pgsql-host HOST]
      [--icingaweb-db DATABASE] [--icingadb-db DATABASE]

Examples:
  bash install.sh install
  bash install.sh migrate-mysql
  bash install.sh migrate-pgsql
  bash install.sh restore --latest
  bash install.sh restore --backup-id 20260515-121500

Set MYSQL_PWD when the selected MySQL account requires a password.
Set PGPASSWORD when the selected PostgreSQL account requires a password.
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

ensure_config_resource() {
  local config_file="${CONFIG_DIR}/config.ini"
  local config_backup="${BACKUP_DIR}/original/config/config.ini"

  mkdir -p "$CONFIG_DIR"
  if [[ -f "$config_file" ]]; then
    if awk '
      /^[[:space:]]*\[global\][[:space:]]*$/ { in_global = 1; next }
      /^[[:space:]]*\[/ { in_global = 0 }
      in_global && /^[[:space:]]*config_resource[[:space:]]*=/ { found = 1 }
      END { exit(found ? 0 : 1) }
    ' "$config_file"; then
      log "Configuration resource already set in: ${config_file}"
      return
    fi

    ensure_parent_dir "$config_backup"
    backup_copy "$config_file" "$config_backup"
  else
    : > "${BACKUP_DIR}/config-ini-missing-before-install"
  fi

  if grep -Eq '^[[:space:]]*\[global\][[:space:]]*$' "$config_file" 2>/dev/null; then
    local updated_file
    updated_file="$(mktemp "${CONFIG_DIR}/.config.ini.XXXXXX")"
    awk -v resource="$CONFIG_RESOURCE" '
      BEGIN { added = 0 }
      /^[[:space:]]*\[global\][[:space:]]*$/ && ! added {
        print
        print "config_resource = " resource
        added = 1
        next
      }
      { print }
    ' "$config_file" > "$updated_file"
    chmod --reference="$config_file" "$updated_file"
    if [[ "$EUID" -eq 0 ]]; then
      chown --reference="$config_file" "$updated_file"
    fi
    mv "$updated_file" "$config_file"
  else
    if [[ -s "$config_file" ]]; then
      printf '\n' >> "$config_file"
    fi
    printf '[global]\nconfig_resource = %s\n' "$CONFIG_RESOURCE" >> "$config_file"
  fi

  if [[ ! -f "$config_backup" ]]; then
    if [[ "$EUID" -eq 0 ]]; then
      chown --reference="$CONFIG_DIR" "$config_file"
    fi
    chmod 0640 "$config_file"
  fi
  restore_selinux_context "$config_file"
  log "Configured Icinga Web resource: ${CONFIG_RESOURCE}"
}

restore_config_resource() {
  local config_file="${CONFIG_DIR}/config.ini"
  local config_backup="${BACKUP_DIR}/original/config/config.ini"

  if [[ -f "$config_backup" ]]; then
    mkdir -p "$CONFIG_DIR"
    backup_copy "$config_backup" "$config_file"
    restore_selinux_context "$config_file"
    log "Restored original configuration: ${config_file}"
  elif [[ -f "${BACKUP_DIR}/config-ini-missing-before-install" ]]; then
    rm -f "$config_file"
    log "Removed configuration added by this installation: ${config_file}"
  fi
}

list_manifest() {
  grep -v '^[[:space:]]*$' "$MANIFEST_FILE"
}

list_removed_paths() {
  if [[ -f "$REMOVED_PATHS_FILE" ]]; then
    grep -v '^[[:space:]]*$' "$REMOVED_PATHS_FILE"
  fi
}

install_files() {
  local backup_id entry src dst bkp removed_spec
  backup_id="$(date +%Y%m%d-%H%M%S)"
  BACKUP_DIR="${BACKUP_ROOT}/${backup_id}"
  mkdir -p "${BACKUP_DIR}/original"

  local missing_file="${BACKUP_DIR}/missing-before-install.txt"
  : > "$missing_file"

  log "Backup ID: ${backup_id}"
  log "Icinga Web target: ${WEB_TARGET_DIR}"
  log "PHP library target: ${PHP_TARGET_DIR}"
  log "Icinga Web configuration: ${CONFIG_DIR}"
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

  while IFS= read -r removed_spec; do
    [[ -n "$removed_spec" ]] || continue
    parse_manifest_entry "removed|${removed_spec}"
    dst="$(target_path)"
    bkp="$(backup_path)"
    if [[ -e "$dst" ]]; then
      ensure_parent_dir "$bkp"
      backup_copy "$dst" "$bkp"
      rm -f "$dst"
      log "Removed obsolete file: ${removed_spec}"
    fi
  done < <(list_removed_paths)

  ensure_config_resource

  backup_copy "$MANIFEST_FILE" "${BACKUP_DIR}/manifest.txt"
  if [[ -f "$REMOVED_PATHS_FILE" ]]; then
    backup_copy "$REMOVED_PATHS_FILE" "${BACKUP_DIR}/removed-paths.txt"
  fi
  if [[ "$WEB_TARGET_DIR" == "$DEFAULT_WEB_TARGET" ]] && command -v icingacli >/dev/null 2>&1; then
    if icingacli module list 2>/dev/null | grep -Eq '^modernui[[:space:]]+enabled'; then
      : > "${BACKUP_DIR}/modernui-was-enabled"
    fi
    icingacli module enable modernui >/dev/null
    log "Enabled module: modernui"
  elif [[ "$WEB_TARGET_DIR" == "$DEFAULT_WEB_TARGET" ]]; then
    log "WARNING: icingacli is unavailable; enable the modernui module manually"
  fi
  cat > "${BACKUP_DIR}/meta.env" <<EOF
BACKUP_ID=${backup_id}
CREATED_AT=$(date -Is)
WEB_TARGET_DIR=${WEB_TARGET_DIR}
PHP_TARGET_DIR=${PHP_TARGET_DIR}
CONFIG_DIR=${CONFIG_DIR}
CONFIG_RESOURCE=${CONFIG_RESOURCE}
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
  local entry dst orig key removed_spec
  [[ -f "$manifest" ]] || fail "Backup manifest not found: ${manifest}"

  log "Restoring backup: $(basename "$BACKUP_DIR")"
  log "Icinga Web target: ${WEB_TARGET_DIR}"
  log "PHP library target: ${PHP_TARGET_DIR}"
  log "Icinga Web configuration: ${CONFIG_DIR}"

  if [[ "$WEB_TARGET_DIR" == "$DEFAULT_WEB_TARGET" ]] \
    && [[ ! -f "${BACKUP_DIR}/modernui-was-enabled" ]] \
    && command -v icingacli >/dev/null 2>&1; then
    icingacli module disable modernui >/dev/null 2>&1 || true
    log "Disabled module added by this installation: modernui"
  fi

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

  if [[ -f "${BACKUP_DIR}/removed-paths.txt" ]]; then
    while IFS= read -r removed_spec; do
      [[ -n "$removed_spec" ]] || continue
      parse_manifest_entry "removed|${removed_spec}"
      dst="$(target_path)"
      orig="${BACKUP_DIR}/original/${ROOT_ALIAS}/${TARGET_REL}"
      if [[ -f "$orig" ]]; then
        ensure_parent_dir "$dst"
        backup_copy "$orig" "$dst"
        restore_selinux_context "$dst"
        log "Restored obsolete file removed by install: ${removed_spec}"
      fi
    done < "${BACKUP_DIR}/removed-paths.txt"
  fi

  restore_config_resource

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

  local migration_id migration_backup
  local modernui_schema="${PAYLOAD_DIR}/modules/modernui/schema/mysql/1.0.0.sql"
  local icingadb_schema="${PAYLOAD_DIR}/modules/modernui/schema/icingadb/mysql/hostgroup-responsibility.sql"
  require_file "$modernui_schema"
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

  apply_mysql_file "$ICINGAWEB_DB" "$modernui_schema"
  apply_mysql_file "$ICINGADB_DB" "$icingadb_schema"
  log "MySQL migrations finished."
}

apply_pgsql_file() {
  local database="$1"
  local file="$2"
  log "Applying $(basename "$file") to ${database}"
  psql "${PGSQL_ARGS[@]}" --dbname="$database" --set=ON_ERROR_STOP=1 --file="$file"
}

migrate_pgsql() {
  command -v psql >/dev/null 2>&1 || fail "psql client is required"
  command -v pg_dump >/dev/null 2>&1 || fail "pg_dump is required"

  local migration_id migration_backup
  local modernui_schema="${PAYLOAD_DIR}/modules/modernui/schema/pgsql/1.0.0.sql"
  local icingadb_schema="${PAYLOAD_DIR}/modules/modernui/schema/icingadb/pgsql/hostgroup-responsibility.sql"
  require_file "$modernui_schema"
  require_file "$icingadb_schema"

  PGSQL_ARGS=(--username="$PGSQL_USER")
  if [[ -n "$PGSQL_HOST" ]]; then
    PGSQL_ARGS+=(--host="$PGSQL_HOST")
  fi

  migration_id="db-$(date +%Y%m%d-%H%M%S)"
  migration_backup="${BACKUP_ROOT}/${migration_id}"
  mkdir -p "$migration_backup"
  log "Database backup directory: ${migration_backup}"
  pg_dump "${PGSQL_ARGS[@]}" --dbname="$ICINGAWEB_DB" --file="${migration_backup}/${ICINGAWEB_DB}.sql"
  pg_dump "${PGSQL_ARGS[@]}" --dbname="$ICINGADB_DB" --file="${migration_backup}/${ICINGADB_DB}.sql"

  apply_pgsql_file "$ICINGAWEB_DB" "$modernui_schema"
  apply_pgsql_file "$ICINGADB_DB" "$icingadb_schema"
  log "PostgreSQL migrations finished."
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

COMMAND="${1:-}"
shift || true

WEB_TARGET_DIR="$DEFAULT_WEB_TARGET"
PHP_TARGET_DIR="$DEFAULT_PHP_TARGET"
CONFIG_DIR="$DEFAULT_CONFIG_DIR"
CONFIG_RESOURCE="$DEFAULT_CONFIG_RESOURCE"
BACKUP_ROOT=""
BACKUP_ID=""
USE_LATEST="0"
MYSQL_USER="root"
MYSQL_HOST="localhost"
PGSQL_USER="postgres"
PGSQL_HOST=""
ICINGAWEB_DB="icingaweb2"
ICINGADB_DB="icingadb"
declare -a MYSQL_ARGS=()
declare -a PGSQL_ARGS=()

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
    --config-dir)
      CONFIG_DIR="${2:-}"
      shift 2
      ;;
    --config-resource)
      CONFIG_RESOURCE="${2:-}"
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
    --pgsql-user)
      PGSQL_USER="${2:-}"
      shift 2
      ;;
    --pgsql-host)
      PGSQL_HOST="${2:-}"
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
[[ -n "$CONFIG_DIR" ]] || fail "Configuration directory must not be empty"
[[ -n "$CONFIG_RESOURCE" ]] || fail "Configuration resource must not be empty"
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
  migrate-pgsql)
    mkdir -p "$BACKUP_ROOT"
    migrate_pgsql
    ;;
  *)
    usage
    fail "Unknown command: ${COMMAND}"
    ;;
esac
