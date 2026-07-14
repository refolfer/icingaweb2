<?php

// SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

namespace Tests\Icinga\Module\Modernui;

require_once dirname(__DIR__, 2) . '/library/Modernui/IncidentAssignment/IncidentAssignmentStore.php';

use Icinga\Module\Modernui\IncidentAssignment\IncidentAssignmentStore;
use Icinga\Test\BaseTestCase;
use Mockery;
use Zend_Db_Adapter_Abstract;
use Zend_Db_Expr;

class IncidentAssignmentStoreTest extends BaseTestCase
{
    public function testInsertWritesCreationAndModificationTimestamps()
    {
        $db = Mockery::mock(Zend_Db_Adapter_Abstract::class);
        $db->shouldReceive('insert')
            ->once()
            ->with(IncidentAssignmentStore::TABLE, Mockery::on(function ($payload) {
                return $payload['ctime'] instanceof Zend_Db_Expr
                    && $payload['mtime'] instanceof Zend_Db_Expr;
            }));

        $store = new TestableIncidentAssignmentStore('test', $db);
        $assignment = $store->save('host', 'host-a', null, 'alice', 'operator', 'Investigating');

        $this->assertSame('alice', $assignment['assignee']);
    }

    public function testUpdatePreservesCreationTimeAndRefreshesModificationTime()
    {
        $db = Mockery::mock(Zend_Db_Adapter_Abstract::class);
        $db->shouldReceive('quoteInto')->andReturnUsing(function ($expression, $value) {
            return $expression . ':' . $value;
        });
        $db->shouldReceive('update')
            ->once()
            ->with(
                IncidentAssignmentStore::TABLE,
                Mockery::on(function ($payload) {
                    return ! array_key_exists('ctime', $payload)
                        && $payload['mtime'] instanceof Zend_Db_Expr;
                }),
                Mockery::type('string')
            );

        $store = new UpdatingIncidentAssignmentStore('test', $db);
        $assignment = $store->save('host', 'host-a', null, 'bob', 'operator', null);

        $this->assertSame('bob', $assignment['assignee']);
    }
}

class TestableIncidentAssignmentStore extends IncidentAssignmentStore
{
    protected $loads = 0;

    public function load(string $objectType, string $hostName, ?string $serviceName = null): ?array
    {
        if ($this->loads++ === 0) {
            return null;
        }

        return ['assignee' => 'alice'];
    }
}

class UpdatingIncidentAssignmentStore extends IncidentAssignmentStore
{
    public function load(string $objectType, string $hostName, ?string $serviceName = null): ?array
    {
        return ['assignee' => 'bob'];
    }
}
