-- SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
-- SPDX-License-Identifier: GPL-3.0-or-later

CREATE TABLE IF NOT EXISTS `icingaweb_incident_assignment` (
  `object_type`  varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `host_name`    varchar(254) COLLATE utf8mb4_unicode_ci NOT NULL,
  `service_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `assignee`     varchar(254) COLLATE utf8mb4_unicode_ci NOT NULL,
  `assigned_by`  varchar(254) COLLATE utf8mb4_unicode_ci NOT NULL,
  `note`         varchar(1024) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `ctime`        timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `mtime`        timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`object_type`, `host_name`, `service_name`),
  KEY `idx_incident_assignment_assignee` (`assignee`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 ROW_FORMAT=DYNAMIC;

DROP PROCEDURE IF EXISTS `modernui_upgrade_100`;
DELIMITER //
CREATE PROCEDURE `modernui_upgrade_100`()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'icingaweb_incident_assignment'
      AND column_name = 'note'
  ) THEN
    ALTER TABLE `icingaweb_incident_assignment`
      ADD COLUMN `note` varchar(1024) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' AFTER `assigned_by`;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'icingaweb_incident_assignment'
      AND index_name = 'idx_incident_assignment_assignee'
  ) THEN
    ALTER TABLE `icingaweb_incident_assignment`
      ADD INDEX `idx_incident_assignment_assignee` (`assignee`);
  END IF;
END//
DELIMITER ;
CALL `modernui_upgrade_100`();
DROP PROCEDURE `modernui_upgrade_100`;

UPDATE `icingaweb_incident_assignment`
SET `ctime` = COALESCE(`ctime`, CURRENT_TIMESTAMP),
    `mtime` = COALESCE(`mtime`, `ctime`, CURRENT_TIMESTAMP);

ALTER TABLE `icingaweb_incident_assignment`
  MODIFY `ctime` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  MODIFY `mtime` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS `modernui_schema` (
  `version` varchar(32) NOT NULL,
  `timestamp` bigint unsigned NOT NULL,
  `success` enum('n', 'y') NOT NULL DEFAULT 'n',
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 ROW_FORMAT=DYNAMIC;

INSERT INTO `modernui_schema` (`version`, `timestamp`, `success`)
VALUES ('1.0.0', UNIX_TIMESTAMP() * 1000, 'y')
ON DUPLICATE KEY UPDATE `timestamp` = VALUES(`timestamp`), `success` = 'y';
