-- SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
-- SPDX-License-Identifier: GPL-3.0-or-later

CREATE TABLE IF NOT EXISTS "icingaweb_incident_assignment" (
  "object_type"  character varying(16) NOT NULL,
  "host_name"    character varying(254) NOT NULL,
  "service_name" character varying(255) NOT NULL DEFAULT '',
  "assignee"     character varying(254) NOT NULL,
  "assigned_by"  character varying(254) NOT NULL,
  "ctime"        timestamp NULL DEFAULT NULL,
  "mtime"        timestamp NULL DEFAULT NULL,
  PRIMARY KEY (
    "object_type",
    "host_name",
    "service_name"
  )
);

INSERT INTO icingaweb_schema (version, timestamp, success)
  VALUES ('2.13.0', extract(epoch from now()) * 1000, 'y');
