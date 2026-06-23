<?php

// SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

namespace Icinga\Web\IncidentAssignment;

use Exception;
use Icinga\Application\Config;
use Icinga\Data\ResourceFactory;
use Icinga\Exception\ConfigurationError;
use Zend_Db_Expr;

class IncidentAssignmentStore
{
    const TABLE = 'icingaweb_incident_assignment';
    const COLUMN_OBJECT_TYPE = 'object_type';
    const COLUMN_HOST_NAME = 'host_name';
    const COLUMN_SERVICE_NAME = 'service_name';
    const COLUMN_ASSIGNEE = 'assignee';
    const COLUMN_ASSIGNED_BY = 'assigned_by';
    const COLUMN_NOTE = 'note';
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
            $row = $this->fetchObjectRow($objectType, $hostName, $serviceName);
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
            'note' => (string) ($row->{self::COLUMN_NOTE} ?? ''),
            'created_at' => $row->{self::COLUMN_CREATED_TIME} ?? null,
            'updated_at' => $row->{self::COLUMN_MODIFIED_TIME} ?? null
        ];
    }

    /**
     * Load incident assignments for a list of objects.
     *
     * @param array $objects
     *
     * @return array<string,array<string,mixed>>
     */
    public function loadMany(array $objects)
    {
        $rows = $this->fetchRowsForObjects($objects);
        $assignments = [];

        foreach ($rows as $row) {
            $objectType = (string) ($row[self::COLUMN_OBJECT_TYPE] ?? '');
            $hostName = (string) ($row[self::COLUMN_HOST_NAME] ?? '');
            $serviceName = (string) ($row[self::COLUMN_SERVICE_NAME] ?? '');
            $signature = $this->getObjectSignature($objectType, $hostName, $serviceName);

            if ($signature === null) {
                continue;
            }

            $assignments[$signature] = [
                'assignee' => (string) ($row[self::COLUMN_ASSIGNEE] ?? ''),
                'assigned_by' => (string) ($row[self::COLUMN_ASSIGNED_BY] ?? ''),
                'note' => (string) ($row[self::COLUMN_NOTE] ?? ''),
                'created_at' => $row[self::COLUMN_CREATED_TIME] ?? null,
                'updated_at' => $row[self::COLUMN_MODIFIED_TIME] ?? null
            ];
        }

        return $assignments;
    }

    /**
     * Count incident assignments grouped by assignee for a list of objects.
     *
     * @param array $objects
     *
     * @return array<string,int>
     */
    public function aggregateByAssignee(array $objects)
    {
        $descriptors = $this->normalizeObjects($objects);
        if (! count($descriptors)) {
            return [];
        }

        try {
            $select = $this->db->select()
                ->from(
                    self::TABLE,
                    [
                        self::COLUMN_ASSIGNEE,
                        'item_count' => new Zend_Db_Expr('COUNT(*)')
                    ]
                )
                ->group(self::COLUMN_ASSIGNEE);

            $this->applyObjectFilters($select, $descriptors);

            $rows = $select->query()->fetchAll();
        } catch (Exception $e) {
            throw new ConfigurationError(
                'Cannot aggregate incident assignments from database',
                $e
            );
        }

        $counts = [];
        foreach ($rows as $row) {
            $assignee = (string) ($row[self::COLUMN_ASSIGNEE] ?? '');
            $count = (int) ($row['item_count'] ?? 0);

            if ($assignee === '' || $count <= 0) {
                continue;
            }

            $counts[$assignee] = $count;
        }

        return $counts;
    }

    public function save($objectType, $hostName, $serviceName, $assignee, $assignedBy, $note = null)
    {
        $payload = [
            self::COLUMN_OBJECT_TYPE => $objectType,
            self::COLUMN_HOST_NAME => $hostName,
            self::COLUMN_SERVICE_NAME => $objectType === 'service' ? $serviceName : '',
            self::COLUMN_ASSIGNEE => $assignee,
            self::COLUMN_ASSIGNED_BY => $assignedBy,
            self::COLUMN_NOTE => $note === null ? '' : $note
        ];

        try {
            $existing = $this->load($objectType, $hostName, $serviceName);
            if ($existing === null) {
                $this->db->insert(self::TABLE, $payload);
            } else {
                $this->db->update(
                    self::TABLE,
                    array_filter(
                        [
                            self::COLUMN_ASSIGNEE => $assignee,
                            self::COLUMN_ASSIGNED_BY => $assignedBy,
                            self::COLUMN_NOTE => $note
                        ],
                        function ($value) {
                            return $value !== null;
                        }
                    ),
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

    /**
     * Fetch a single assignment row.
     *
     * @param string      $objectType
     * @param string      $hostName
     * @param string|null  $serviceName
     *
     * @return object|false
     */
    protected function fetchObjectRow($objectType, $hostName, $serviceName = null)
    {
        $select = $this->db->select()
            ->from(self::TABLE, [
                self::COLUMN_ASSIGNEE,
                self::COLUMN_ASSIGNED_BY,
                self::COLUMN_NOTE,
                self::COLUMN_CREATED_TIME,
                self::COLUMN_MODIFIED_TIME
            ]);

        $this->applyObjectFilter($select, $objectType, $hostName, $serviceName);

        return $select->query()->fetchObject();
    }

    /**
     * Fetch assignment rows for a list of objects.
     *
     * @param array $objects
     *
     * @return array<int,object>
     */
    protected function fetchRowsForObjects(array $objects)
    {
        $descriptors = $this->normalizeObjects($objects);
        if (! count($descriptors)) {
            return [];
        }

        try {
            $select = $this->db->select()->from(
                self::TABLE,
                [
                    self::COLUMN_OBJECT_TYPE,
                    self::COLUMN_HOST_NAME,
                    self::COLUMN_SERVICE_NAME,
                    self::COLUMN_ASSIGNEE,
                    self::COLUMN_ASSIGNED_BY,
                    self::COLUMN_NOTE,
                    self::COLUMN_CREATED_TIME,
                    self::COLUMN_MODIFIED_TIME
                ]
            );

            $this->applyObjectFilters($select, $descriptors);

            return $select->query()->fetchAll();
        } catch (Exception $e) {
            throw new ConfigurationError(
                'Cannot load incident assignments from database',
                $e
            );
        }
    }

    /**
     * @param object $select
     * @param array  $objects
     *
     * @return void
     */
    protected function applyObjectFilters($select, array $objects)
    {
        $where = [];

        foreach ($objects as $object) {
            $where[] = '(' . $this->buildObjectFilter($object['type'], $object['host_name'], $object['service_name']) . ')';
        }

        if (! count($where)) {
            $select->where('1 = 0');
            return;
        }

        $select->where(implode(' OR ', $where));
    }

    /**
     * @param object $select
     * @param string $objectType
     * @param string $hostName
     * @param string|null $serviceName
     *
     * @return void
     */
    protected function applyObjectFilter($select, $objectType, $hostName, $serviceName = null)
    {
        $select->where(
            $this->buildObjectFilter($objectType, $hostName, $serviceName)
        );
    }

    /**
     * @param string      $objectType
     * @param string      $hostName
     * @param string|null  $serviceName
     *
     * @return string
     */
    protected function buildObjectFilter($objectType, $hostName, $serviceName = null)
    {
        $where = $this->db->quoteInto(self::COLUMN_OBJECT_TYPE . ' = ?', $objectType)
            . ' AND ' . $this->db->quoteInto(self::COLUMN_HOST_NAME . ' = ?', $hostName);

        if ($objectType === 'service') {
            $where .= ' AND ' . $this->db->quoteInto(self::COLUMN_SERVICE_NAME . ' = ?', (string) $serviceName);
        } else {
            $where .= ' AND ' . $this->db->quoteInto(self::COLUMN_SERVICE_NAME . ' = ?', '');
        }

        return $where;
    }

    /**
     * Normalize object descriptors and drop invalid entries.
     *
     * @param array $objects
     *
     * @return array<int,array{type:string,host_name:string,service_name:string|null}>
     */
    protected function normalizeObjects(array $objects)
    {
        $normalized = [];
        $seen = [];

        foreach ($objects as $object) {
            $type = '';
            $hostName = '';
            $serviceName = null;

            if (is_array($object)) {
                $type = trim((string) ($object['type'] ?? $object['object_type'] ?? ''));
                $hostName = trim((string) ($object['host_name'] ?? $object['hostName'] ?? ''));
                $serviceName = trim((string) ($object['service_name'] ?? $object['serviceName'] ?? ''));
            }

            if (! in_array($type, ['host', 'service'], true) || $hostName === '') {
                continue;
            }

            if ($type === 'service') {
                if ($serviceName === '') {
                    continue;
                }
            } else {
                $serviceName = '';
            }

            $signature = $this->getObjectSignature($type, $hostName, $serviceName);
            if ($signature === null || isset($seen[$signature])) {
                continue;
            }

            $seen[$signature] = true;
            $normalized[] = [
                'type' => $type,
                'host_name' => $hostName,
                'service_name' => $type === 'service' ? $serviceName : null
            ];
        }

        return $normalized;
    }

    /**
     * Build a stable object signature.
     *
     * @param string      $objectType
     * @param string      $hostName
     * @param string|null  $serviceName
     *
     * @return string|null
     */
    protected function getObjectSignature($objectType, $hostName, $serviceName = null)
    {
        if (! in_array($objectType, ['host', 'service'], true) || $hostName === '') {
            return null;
        }

        if ($objectType === 'service') {
            $serviceName = trim((string) $serviceName);
            if ($serviceName === '') {
                return null;
            }
        } else {
            $serviceName = '';
        }

        return $objectType . '|' . $hostName . '|' . $serviceName;
    }
}
