-- SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
-- SPDX-License-Identifier: GPL-3.0-or-later

CREATE TABLE `icingaweb_incident_assignment`(
  `object_type`  varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `host_name`    varchar(254) COLLATE utf8mb4_unicode_ci NOT NULL,
  `service_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `assignee`     varchar(254) COLLATE utf8mb4_unicode_ci NOT NULL,
  `assigned_by`  varchar(254) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ctime`        timestamp NULL DEFAULT NULL,
  `mtime`        timestamp NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`object_type`, `host_name`, `service_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 ROW_FORMAT=DYNAMIC;

INSERT INTO icingaweb_schema (version, timestamp, success)
  VALUES ('2.13.0', UNIX_TIMESTAMP() * 1000, 'y');
