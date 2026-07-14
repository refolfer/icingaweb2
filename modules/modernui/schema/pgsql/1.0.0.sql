-- SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
-- SPDX-License-Identifier: GPL-3.0-or-later

CREATE TABLE IF NOT EXISTS "icingaweb_incident_assignment" (
  "object_type"  character varying(16) NOT NULL,
  "host_name"    character varying(254) NOT NULL,
  "service_name" character varying(255) NOT NULL DEFAULT '',
  "assignee"     character varying(254) NOT NULL,
  "assigned_by"  character varying(254) NOT NULL,
  "note"         character varying(1024) NOT NULL DEFAULT '',
  "ctime"        timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "mtime"        timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("object_type", "host_name", "service_name")
);

ALTER TABLE "icingaweb_incident_assignment"
  ADD COLUMN IF NOT EXISTS "note" character varying(1024) NOT NULL DEFAULT '';

ALTER TABLE "icingaweb_incident_assignment"
  ALTER COLUMN "ctime" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "mtime" SET DEFAULT CURRENT_TIMESTAMP;

UPDATE "icingaweb_incident_assignment"
SET "ctime" = COALESCE("ctime", CURRENT_TIMESTAMP),
    "mtime" = COALESCE("mtime", "ctime", CURRENT_TIMESTAMP);

ALTER TABLE "icingaweb_incident_assignment"
  ALTER COLUMN "ctime" SET NOT NULL,
  ALTER COLUMN "mtime" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_incident_assignment_assignee"
  ON "icingaweb_incident_assignment" ("assignee");

CREATE TABLE IF NOT EXISTS "modernui_schema" (
  "version" character varying(32) NOT NULL PRIMARY KEY,
  "timestamp" bigint NOT NULL,
  "success" character(1) NOT NULL DEFAULT 'n'
);

INSERT INTO "modernui_schema" ("version", "timestamp", "success")
VALUES ('1.0.0', extract(epoch from now()) * 1000, 'y')
ON CONFLICT ("version") DO UPDATE
SET "timestamp" = EXCLUDED."timestamp", "success" = 'y';
