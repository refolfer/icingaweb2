-- SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
-- SPDX-License-Identifier: GPL-3.0-or-later

ALTER TABLE `icingaweb_incident_assignment`
  ADD COLUMN `note` varchar(1024) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' AFTER `assigned_by`;

INSERT INTO icingaweb_schema (version, timestamp, success)
  VALUES ('2.13.1', UNIX_TIMESTAMP() * 1000, 'y');
