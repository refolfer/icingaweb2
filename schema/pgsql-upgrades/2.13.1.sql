-- SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
-- SPDX-License-Identifier: GPL-3.0-or-later

ALTER TABLE ONLY "icingaweb_incident_assignment"
  ADD COLUMN "note" character varying(1024) NOT NULL DEFAULT '';

INSERT INTO icingaweb_schema (version, timestamp, success)
  VALUES ('2.13.1', extract(epoch from now()) * 1000, 'y');
