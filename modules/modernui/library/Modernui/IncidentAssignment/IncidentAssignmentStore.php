<?php

// SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

namespace Icinga\Module\Modernui\IncidentAssignment;

use Exception;
use Icinga\Application\Config;
use Icinga\Data\Db\DbConnection;
use Icinga\Data\ResourceFactory;
use Icinga\Exception\ConfigurationError;
use Zend_Db_Expr;
use Zend_Db_Adapter_Abstract;
use Zend_Db_Select;

class IncidentAssignmentStore
{
    const QUERY_CHUNK_SIZE = 100;
    const TABLE = 'icingaweb_incident_assignment';
    const COLUMN_OBJECT_TYPE = 'object_type';
    const COLUMN_HOST_NAME = 'host_name';
    const COLUMN_SERVICE_NAME = 'service_name';
    const COLUMN_ASSIGNEE = 'assignee';
    const COLUMN_ASSIGNED_BY = 'assigned_by';
    const COLUMN_NOTE = 'note';
    const COLUMN_CREATED_TIME = 'ctime';
    const COLUMN_MODIFIED_TIME = 'mtime';

    protected string $resourceName;

    protected Zend_Db_Adapter_Abstract $db;

    public function __construct(string $resourceName, Zend_Db_Adapter_Abstract $db)
    {
        $this->resourceName = $resourceName;
        $this->db = $db;
    }

    public static function create(): self
    {
        try {
            $resourceName = Config::app()->get('global', 'config_resource');
        } catch (Exception $e) {
            throw new ConfigurationError('No configuration resource is configured', $e);
        }

        if (! $resourceName) {
            throw new ConfigurationError('No configuration resource is configured');
        }

        $resourceName = self::stringValue($resourceName);
        $resource = ResourceFactory::create($resourceName);
        if (! $resource instanceof DbConnection) {
            throw new ConfigurationError('The configured resource "%s" is not a database', $resourceName);
        }

        return new self($resourceName, $resource->getDbAdapter());
    }

    /** @return array{assignee:string,assigned_by:string,note:string,created_at:mixed,updated_at:mixed}|null */
    public function load(string $objectType, string $hostName, ?string $serviceName = null): ?array
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
     * @param array<int,mixed> $objects
     *
     * @return array<string,array<string,mixed>>
     */
    public function loadMany(array $objects): array
    {
        $rows = $this->fetchRowsForObjects($objects);
        $assignments = [];

        foreach ($rows as $row) {
            $objectType = self::stringValue($this->getRowValue($row, self::COLUMN_OBJECT_TYPE));
            $hostName = self::stringValue($this->getRowValue($row, self::COLUMN_HOST_NAME));
            $serviceName = self::stringValue($this->getRowValue($row, self::COLUMN_SERVICE_NAME));
            $signature = $this->getObjectSignature($objectType, $hostName, $serviceName);

            if ($signature === null) {
                continue;
            }

            $assignments[$signature] = [
                'assignee' => self::stringValue($this->getRowValue($row, self::COLUMN_ASSIGNEE)),
                'assigned_by' => self::stringValue($this->getRowValue($row, self::COLUMN_ASSIGNED_BY)),
                'note' => self::stringValue($this->getRowValue($row, self::COLUMN_NOTE)),
                'created_at' => $this->getRowValue($row, self::COLUMN_CREATED_TIME),
                'updated_at' => $this->getRowValue($row, self::COLUMN_MODIFIED_TIME)
            ];
        }

        return $assignments;
    }

    /**
     * Count incident assignments grouped by assignee for a list of objects.
     *
     * @param array<int,mixed> $objects
     *
     * @return array<string,int>
     */
    public function aggregateByAssignee(array $objects): array
    {
        $descriptors = $this->normalizeObjects($objects);
        if (! count($descriptors)) {
            return [];
        }

        try {
            $rows = [];
            foreach (array_chunk($descriptors, self::QUERY_CHUNK_SIZE) as $chunk) {
                $select = $this->db->select()
                    ->from(
                        self::TABLE,
                        [
                            self::COLUMN_ASSIGNEE,
                            'item_count' => new Zend_Db_Expr('COUNT(*)')
                        ]
                    )
                    ->group(self::COLUMN_ASSIGNEE);

                $this->applyObjectFilters($select, $chunk);
                $chunkRows = $select->query()->fetchAll();
                if (is_array($chunkRows)) {
                    $rows = array_merge($rows, $chunkRows);
                }
            }
        } catch (Exception $e) {
            throw new ConfigurationError(
                'Cannot aggregate incident assignments from database',
                $e
            );
        }

        $counts = [];
        foreach ($rows as $row) {
            $assignee = self::stringValue($this->getRowValue($row, self::COLUMN_ASSIGNEE));
            $count = self::intValue($this->getRowValue($row, 'item_count'));

            if ($assignee === '' || $count <= 0) {
                continue;
            }

            $counts[$assignee] = ($counts[$assignee] ?? 0) + $count;
        }

        return $counts;
    }

    /** @return array{assignee:string,assigned_by?:string,note?:string,created_at?:mixed,updated_at?:mixed}|null */
    public function save(
        string $objectType,
        string $hostName,
        ?string $serviceName,
        string $assignee,
        string $assignedBy,
        ?string $note = null
    ): ?array {
        $now = new Zend_Db_Expr('CURRENT_TIMESTAMP');
        $payload = [
            self::COLUMN_OBJECT_TYPE => $objectType,
            self::COLUMN_HOST_NAME => $hostName,
            self::COLUMN_SERVICE_NAME => $objectType === 'service' ? $serviceName : '',
            self::COLUMN_ASSIGNEE => $assignee,
            self::COLUMN_ASSIGNED_BY => $assignedBy,
            self::COLUMN_NOTE => $note === null ? '' : $note,
            self::COLUMN_CREATED_TIME => $now,
            self::COLUMN_MODIFIED_TIME => $now
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
                            self::COLUMN_NOTE => $note,
                            self::COLUMN_MODIFIED_TIME => $now
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

    public function remove(string $objectType, string $hostName, ?string $serviceName = null): void
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
    protected function fetchObjectRow(string $objectType, string $hostName, ?string $serviceName = null)
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

        $row = $select->query()->fetchObject();

        return is_object($row) ? $row : false;
    }

    /**
     * Fetch assignment rows for a list of objects.
     *
     * @param array<int,mixed> $objects
     *
     * @return array<int,array<string,mixed>|object>
     */
    protected function fetchRowsForObjects(array $objects): array
    {
        $descriptors = $this->normalizeObjects($objects);
        if (! count($descriptors)) {
            return [];
        }

        try {
            $rows = [];
            foreach (array_chunk($descriptors, self::QUERY_CHUNK_SIZE) as $chunk) {
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

                $this->applyObjectFilters($select, $chunk);
                $fetchedRows = $select->query()->fetchAll();
                if (is_array($fetchedRows)) {
                    $rows = array_merge($rows, $fetchedRows);
                }
            }

            return $rows;
        } catch (Exception $e) {
            throw new ConfigurationError(
                'Cannot load incident assignments from database',
                $e
            );
        }
    }

    /**
     * @param array<int,array{type:string,host_name:string,service_name:?string}> $objects
     *
     * @return void
     */
    protected function applyObjectFilters(Zend_Db_Select $select, array $objects): void
    {
        $where = [];

        foreach ($objects as $object) {
            $filter = $this->buildObjectFilter($object['type'], $object['host_name'], $object['service_name']);
            $where[] = '(' . $filter . ')';
        }

        if (! count($where)) {
            $select->where('1 = 0');
            return;
        }

        $select->where(implode(' OR ', $where));
    }

    /**
     * @param string $objectType
     * @param string $hostName
     * @param string|null $serviceName
     *
     * @return void
     */
    protected function applyObjectFilter(
        Zend_Db_Select $select,
        string $objectType,
        string $hostName,
        ?string $serviceName = null
    ): void {
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
    protected function buildObjectFilter(
        string $objectType,
        string $hostName,
        ?string $serviceName = null
    ): string {
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
     * @param array<int,mixed> $objects
     *
     * @return array<int,array{type:string,host_name:string,service_name:string|null}>
     */
    protected function normalizeObjects(array $objects): array
    {
        $normalized = [];
        $seen = [];

        foreach ($objects as $object) {
            $type = '';
            $hostName = '';
            $serviceName = null;

            if (is_array($object)) {
                $type = trim(self::stringValue($object['type'] ?? $object['object_type'] ?? ''));
                $hostName = trim(self::stringValue($object['host_name'] ?? $object['hostName'] ?? ''));
                $serviceName = trim(self::stringValue($object['service_name'] ?? $object['serviceName'] ?? ''));
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
    protected function getObjectSignature(
        string $objectType,
        string $hostName,
        ?string $serviceName = null
    ): ?string {
        if (! in_array($objectType, ['host', 'service'], true) || $hostName === '') {
            return null;
        }

        if ($objectType === 'service') {
            $serviceName = trim($serviceName ?? '');
            if ($serviceName === '') {
                return null;
            }
        } else {
            $serviceName = '';
        }

        return $objectType . '|' . $hostName . '|' . $serviceName;
    }

    /**
     * Read a value from a row returned by Zend_Db in either array or object mode.
     *
     * @param array<string,mixed>|object $row
     * @param string       $column
     *
     * @return mixed
     */
    protected function getRowValue(mixed $row, string $column): mixed
    {
        if (is_array($row) && array_key_exists($column, $row)) {
            return $row[$column];
        }

        if (is_object($row) && isset($row->{$column})) {
            return $row->{$column};
        }

        return null;
    }

    protected static function stringValue(mixed $value): string
    {
        return is_scalar($value) || $value instanceof \Stringable ? (string) $value : '';
    }

    protected static function intValue(mixed $value): int
    {
        return is_int($value) || is_float($value) || is_string($value) ? (int) $value : 0;
    }
}
