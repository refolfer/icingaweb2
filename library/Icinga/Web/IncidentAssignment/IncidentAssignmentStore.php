<?php

// SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

namespace Icinga\Web\IncidentAssignment;

use Exception;
use Icinga\Application\Config;
use Icinga\Data\ResourceFactory;
use Icinga\Exception\ConfigurationError;

class IncidentAssignmentStore
{
    const TABLE = 'icingaweb_incident_assignment';
    const COLUMN_OBJECT_TYPE = 'object_type';
    const COLUMN_HOST_NAME = 'host_name';
    const COLUMN_SERVICE_NAME = 'service_name';
    const COLUMN_ASSIGNEE = 'assignee';
    const COLUMN_ASSIGNED_BY = 'assigned_by';
    const COLUMN_CREATED_TIME = 'ctime';
    const COLUMN_MODIFIED_TIME = 'mtime';

    protected $resourceName;

    protected $db;

    public function __construct($resourceName, $db)
    {
        $this->resourceName = $resourceName;
        $this->db = $db;
    }

    public static function create()
    {
        try {
            $resourceName = Config::app()->get('global', 'config_resource');
        } catch (Exception $e) {
            throw new ConfigurationError('No configuration resource is configured', $e);
        }

        if (! $resourceName) {
            throw new ConfigurationError('No configuration resource is configured');
        }

        $resource = ResourceFactory::create($resourceName);
        return new self($resourceName, $resource->getDbAdapter());
    }

    public function load($objectType, $hostName, $serviceName = null)
    {
        try {
            $select = $this->db->select()
                ->from(self::TABLE, [
                    self::COLUMN_ASSIGNEE,
                    self::COLUMN_ASSIGNED_BY,
                    self::COLUMN_CREATED_TIME,
                    self::COLUMN_MODIFIED_TIME
                ])
                ->where(self::COLUMN_OBJECT_TYPE . ' = ?', $objectType)
                ->where(self::COLUMN_HOST_NAME . ' = ?', $hostName);

            if ($objectType === 'service') {
                $select->where(self::COLUMN_SERVICE_NAME . ' = ?', (string) $serviceName);
            } else {
                $select->where(self::COLUMN_SERVICE_NAME . ' = ?', '');
            }

            $row = $select->query()->fetchObject();
        } catch (Exception $e) {
            throw new ConfigurationError(
                'Cannot load incident assignment for %s/%s from database',
                $objectType,
                $hostName,
                $e
            );
        }

        if ($row === false) {
            return null;
        }

        return [
            'assignee' => (string) ($row->{self::COLUMN_ASSIGNEE} ?? ''),
            'assigned_by' => (string) ($row->{self::COLUMN_ASSIGNED_BY} ?? ''),
            'created_at' => $row->{self::COLUMN_CREATED_TIME} ?? null,
            'updated_at' => $row->{self::COLUMN_MODIFIED_TIME} ?? null
        ];
    }

    public function save($objectType, $hostName, $serviceName, $assignee, $assignedBy)
    {
        $payload = [
            self::COLUMN_OBJECT_TYPE => $objectType,
            self::COLUMN_HOST_NAME => $hostName,
            self::COLUMN_SERVICE_NAME => $objectType === 'service' ? $serviceName : '',
            self::COLUMN_ASSIGNEE => $assignee,
            self::COLUMN_ASSIGNED_BY => $assignedBy
        ];

        try {
            $existing = $this->load($objectType, $hostName, $serviceName);
            if ($existing === null) {
                $this->db->insert(self::TABLE, $payload);
            } else {
                $this->db->update(
                    self::TABLE,
                    [
                        self::COLUMN_ASSIGNEE => $assignee,
                        self::COLUMN_ASSIGNED_BY => $assignedBy
                    ],
                    $this->db->quoteInto(self::COLUMN_OBJECT_TYPE . ' = ?', $objectType)
                    . ' AND ' . $this->db->quoteInto(self::COLUMN_HOST_NAME . ' = ?', $hostName)
                    . ($objectType === 'service'
                        ? ' AND ' . $this->db->quoteInto(self::COLUMN_SERVICE_NAME . ' = ?', (string) $serviceName)
                        : ' AND ' . $this->db->quoteInto(self::COLUMN_SERVICE_NAME . ' = ?', ''))
                );
            }
        } catch (Exception $e) {
            throw new ConfigurationError(
                'Cannot save incident assignment for %s/%s into database',
                $objectType,
                $hostName,
                $e
            );
        }

        return $this->load($objectType, $hostName, $serviceName);
    }

    public function remove($objectType, $hostName, $serviceName = null)
    {
        try {
            $where = $this->db->quoteInto(self::COLUMN_OBJECT_TYPE . ' = ?', $objectType)
                . ' AND ' . $this->db->quoteInto(self::COLUMN_HOST_NAME . ' = ?', $hostName);

            if ($objectType === 'service') {
                $where .= ' AND ' . $this->db->quoteInto(self::COLUMN_SERVICE_NAME . ' = ?', (string) $serviceName);
            } else {
                $where .= ' AND ' . $this->db->quoteInto(self::COLUMN_SERVICE_NAME . ' = ?', '');
            }

            $this->db->delete(self::TABLE, $where);
        } catch (Exception $e) {
            throw new ConfigurationError(
                'Cannot delete incident assignment for %s/%s from database',
                $objectType,
                $hostName,
                $e
            );
        }
    }
}
