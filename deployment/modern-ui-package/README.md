# Modern UI Package for Icinga Web 2

This directory defines the production deployment package for the NeoNOC/Modern UI changes.
It supports the Fedora/RHEL RPM layout, where the web application is installed below
`/usr/share/icingaweb2` and core PHP classes are installed below `/usr/share/php`.

## Contents

- `manifest.txt`: source-to-target file mappings
- `removed-paths.txt`: obsolete files removed with backup/restore support
- `install.sh`: installer with file backup, restore and MySQL migration commands
- `build-package.sh`: distributable `.tar.gz` archive builder
- `test-package.sh`: isolated install/restore smoke test

Manifest entries without a target are installed below the Icinga Web target. Explicit
targets use `web:relative/path` or `php:relative/path`:

```text
source/file.php|web:modules/icingadb/application/file.php
library/Icinga/Example.php|php:Icinga/Example.php
```

## Build

From the repository root:

```bash
bash deployment/modern-ui-package/build-package.sh
```

The archive and its SHA-256 checksum are created in `dist/`.

## Deploy on Fedora/RHEL

Copy and extract the generated archive, then run:

```bash
cd icingaweb2-modern-ui-package
bash install.sh install
bash install.sh migrate-mysql
systemctl reload php-fpm
cp examples/nginx/modern-ui-http.conf /etc/nginx/conf.d/00-modern-ui-http.conf
cp examples/nginx/modern-ui-server.conf /etc/nginx/snippets/modern-ui-server.conf
nginx -t && systemctl reload nginx
```

The defaults are:

- Icinga Web target: `/usr/share/icingaweb2`
- PHP library target: `/usr/share/php`
- Icinga Web configuration directory: `/etc/icingaweb2`
- Icinga Web configuration resource: `icingaweb2`
- Icinga Web database: `icingaweb2`
- Icinga DB database: `icingadb`
- MySQL account: `root@localhost`

Override them when required:

```bash
MYSQL_PWD='secret' bash install.sh migrate-mysql \
  --mysql-user admin \
  --mysql-host 127.0.0.1 \
  --icingaweb-db icingaweb2 \
  --icingadb-db icingadb
```

The file installer ensures that `[global] config_resource` is present in `config.ini`.
Existing values are preserved. If the installation uses a differently named database
resource, select it explicitly:

```bash
bash install.sh install --config-resource custom_config_db
```

Configuration changes are included in the installation backup and are reverted by the
`restore` command together with application files. Newly created configuration files use
the owner and group of the Icinga Web configuration directory, so the web server retains
read access when the directory is restricted to the `icingaweb2` group.

The migration command creates database dumps before changing either database. It installs
the incident assignment schema in the Icinga Web database and the host group responsibility
table in the Icinga DB database. Modern UI versions are tracked independently in
`modernui_schema`; the installer never writes custom versions to `icingaweb_schema`.
Upgrades also remove the obsolete custom `2.13.x` migration files deployed by older
packages, while keeping them in the file backup for rollback.

For PostgreSQL use:

```bash
PGPASSWORD='secret' bash install.sh migrate-pgsql \
  --pgsql-user icingaweb \
  --pgsql-host 127.0.0.1 \
  --icingaweb-db icingaweb2 \
  --icingadb-db icingadb
```

The file installer restores SELinux labels with `restorecon` when available. It does not
preserve archive UID/GID values, preventing build-workstation ownership from leaking into
the production installation.

Optional nginx snippets are included in `examples/nginx`. The HTTP-context snippet enables
gzip and keeps large FastCGI responses in memory. Include the server snippet before the
generic Icinga Web location to give versioned JS/CSS assets explicit immutable caching.
Background tactical and event polling pauses while the browser tab is hidden and refreshes
immediately when the tab becomes visible again.

## Restore Files

Restore files from the latest backup:

```bash
bash install.sh restore --latest
```

Or restore a specific backup:

```bash
bash install.sh restore --backup-id 20260515-120000
```

Database dumps are stored alongside file backups below
`/usr/share/icingaweb2/.modern-ui-backups`. Database restoration is intentionally manual.
