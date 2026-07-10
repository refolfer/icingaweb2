# Modern UI Package for Icinga Web 2

This directory defines the production deployment package for the NeoNOC/Modern UI changes.
It supports the Fedora/RHEL RPM layout, where the web application is installed below
`/usr/share/icingaweb2` and core PHP classes are installed below `/usr/share/php`.

## Contents

- `manifest.txt`: source-to-target file mappings
- `install.sh`: installer with file backup, restore and MySQL migration commands
- `build-package.sh`: distributable `.tar.gz` archive builder

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
systemctl reload httpd
```

The defaults are:

- Icinga Web target: `/usr/share/icingaweb2`
- PHP library target: `/usr/share/php`
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

The migration command creates database dumps before changing either database. It installs
the incident assignment schema in the Icinga Web database and the host group responsibility
table in the Icinga DB database. PostgreSQL schema files are included below
`schema/icingadb/pgsql`, but PostgreSQL migrations must currently be applied manually.

The file installer restores SELinux labels with `restorecon` when available. It does not
preserve archive UID/GID values, preventing build-workstation ownership from leaking into
the production installation.

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
