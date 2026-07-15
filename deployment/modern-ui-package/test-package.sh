#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

bash "${SCRIPT_DIR}/build-package.sh"
ARCHIVE="$(find "${REPO_ROOT}/dist" -maxdepth 1 -name 'icingaweb2-modern-ui-package-*.tar.gz' \
  -printf '%T@ %p\n' | sort -n | tail -1 | cut -d' ' -f2-)"
[[ -n "$ARCHIVE" ]]
cp "$ARCHIVE" "${WORK_DIR}/"
cp "${ARCHIVE}.sha256" "${WORK_DIR}/"
(
  cd "$WORK_DIR"
  sha256sum --check "$(basename "$ARCHIVE").sha256"
)

tar -xzf "${WORK_DIR}/$(basename "$ARCHIVE")" -C "$WORK_DIR"
PACKAGE_DIR="${WORK_DIR}/icingaweb2-modern-ui-package"
WEB_TARGET="${WORK_DIR}/web"
PHP_TARGET="${WORK_DIR}/php"
BACKUP_ROOT="${WORK_DIR}/backups"
CONFIG_DIR="${WORK_DIR}/config"
mkdir -p "${WEB_TARGET}/application/layouts/scripts" "$PHP_TARGET"
printf '%s\n' 'original-layout' > "${WEB_TARGET}/application/layouts/scripts/layout.phtml"
mkdir -p "${PHP_TARGET}/Icinga/Web/IncidentAssignment"
printf '%s\n' 'obsolete-store' > "${PHP_TARGET}/Icinga/Web/IncidentAssignment/IncidentAssignmentStore.php"
mkdir -p "${WEB_TARGET}/schema/mysql-upgrades"
printf '%s\n' 'obsolete-migration' > "${WEB_TARGET}/schema/mysql-upgrades/2.13.0.sql"

bash "${PACKAGE_DIR}/install.sh" install \
  --target "$WEB_TARGET" \
  --php-target "$PHP_TARGET" \
  --config-dir "$CONFIG_DIR" \
  --backup-root "$BACKUP_ROOT"

[[ -f "${WEB_TARGET}/modules/modernui/module.info" ]]
[[ -f "${WEB_TARGET}/modules/icingadb/application/views/scripts/simple-form.phtml" ]]
[[ -f "${PHP_TARGET}/Icinga/Web/Security/CsrfToken.php" ]]
[[ ! -e "${PHP_TARGET}/Icinga/Web/IncidentAssignment/IncidentAssignmentStore.php" ]]
[[ ! -e "${WEB_TARGET}/schema/mysql-upgrades/2.13.0.sql" ]]
grep -q 'modernui' "${WEB_TARGET}/modules/modernui/module.info"
grep -q '^\[global\]$' "${CONFIG_DIR}/config.ini"
grep -q '^config_resource = icingaweb2$' "${CONFIG_DIR}/config.ini"
[[ "$(stat -c '%G' "${CONFIG_DIR}/config.ini")" == "$(stat -c '%G' "$CONFIG_DIR")" ]]
while IFS= read -r installed_file; do
  mode="$(stat -c '%a' "$installed_file")"
  (( (8#$mode & 4) == 4 )) || {
    printf 'Installed file is not world-readable: %s (%s)\n' "$installed_file" "$mode" >&2
    exit 1
  }
done < <(find "$WEB_TARGET" "$PHP_TARGET" -type f)

bash "${PACKAGE_DIR}/install.sh" restore \
  --target "$WEB_TARGET" \
  --php-target "$PHP_TARGET" \
  --config-dir "$CONFIG_DIR" \
  --backup-root "$BACKUP_ROOT" \
  --latest

grep -qx 'original-layout' "${WEB_TARGET}/application/layouts/scripts/layout.phtml"
[[ ! -e "${WEB_TARGET}/modules/modernui/module.info" ]]
[[ ! -e "${WEB_TARGET}/modules/icingadb/application/views/scripts/simple-form.phtml" ]]
[[ ! -e "${PHP_TARGET}/Icinga/Web/Security/CsrfToken.php" ]]
grep -qx 'obsolete-store' "${PHP_TARGET}/Icinga/Web/IncidentAssignment/IncidentAssignmentStore.php"
grep -qx 'obsolete-migration' "${WEB_TARGET}/schema/mysql-upgrades/2.13.0.sql"
[[ ! -e "${CONFIG_DIR}/config.ini" ]]

EXISTING_CONFIG_DIR="${WORK_DIR}/existing-config"
EXISTING_BACKUP_ROOT="${WORK_DIR}/existing-config-backups"
mkdir -p "$EXISTING_CONFIG_DIR"
printf '[logging]\nlog = syslog\n' > "${EXISTING_CONFIG_DIR}/config.ini"
cp "${EXISTING_CONFIG_DIR}/config.ini" "${WORK_DIR}/config.ini.original"

bash "${PACKAGE_DIR}/install.sh" install \
  --target "$WEB_TARGET" \
  --php-target "$PHP_TARGET" \
  --config-dir "$EXISTING_CONFIG_DIR" \
  --config-resource custom_config_db \
  --backup-root "$EXISTING_BACKUP_ROOT"

grep -q '^config_resource = custom_config_db$' "${EXISTING_CONFIG_DIR}/config.ini"

bash "${PACKAGE_DIR}/install.sh" restore \
  --target "$WEB_TARGET" \
  --php-target "$PHP_TARGET" \
  --config-dir "$EXISTING_CONFIG_DIR" \
  --backup-root "$EXISTING_BACKUP_ROOT" \
  --latest

cmp "${WORK_DIR}/config.ini.original" "${EXISTING_CONFIG_DIR}/config.ini"
