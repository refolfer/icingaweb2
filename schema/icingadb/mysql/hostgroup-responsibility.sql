-- SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
-- SPDX-License-Identifier: GPL-3.0-or-later

CREATE TABLE IF NOT EXISTS `hostgroup_responsibility` (
  `hostgroup_id`     binary(20) NOT NULL,
  `responsible_user` varchar(254) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `responsible_note` varchar(1024) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `ctime`            timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `mtime`            timestamp NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`hostgroup_id`),
  CONSTRAINT `fk_hostgroup_responsibility_hostgroup`
    FOREIGN KEY (`hostgroup_id`) REFERENCES `hostgroup` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
