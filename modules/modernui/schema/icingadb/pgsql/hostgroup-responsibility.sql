-- SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
-- SPDX-License-Identifier: GPL-3.0-or-later

CREATE TABLE IF NOT EXISTS "hostgroup_responsibility" (
  "hostgroup_id"     bytea NOT NULL,
  "responsible_user" character varying(254) NOT NULL DEFAULT '',
  "responsible_note" character varying(1024) NOT NULL DEFAULT '',
  "ctime"            timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  "mtime"            timestamp NULL DEFAULT NULL,
  CONSTRAINT "pk_hostgroup_responsibility" PRIMARY KEY ("hostgroup_id"),
  CONSTRAINT "fk_hostgroup_responsibility_hostgroup"
    FOREIGN KEY ("hostgroup_id") REFERENCES "hostgroup" ("id") ON DELETE CASCADE
);
