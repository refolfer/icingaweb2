<?php

// SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

namespace Tests\Icinga\Controllers;

use Icinga\Controllers\IncidentAssignmentController;
use Icinga\Test\BaseTestCase;
use Icinga\Module\Modernui\IncidentAssignment\IncidentAssignmentStore;
use PHPUnit\Framework\Attributes\DataProvider;
use ReflectionClass;
use ReflectionMethod;

class IncidentAssignmentControllerTest extends BaseTestCase
{
    protected $controller;

    public function setUp(): void
    {
        parent::setUp();
        $reflection = new ReflectionClass(IncidentAssignmentController::class);
        $this->controller = $reflection->newInstanceWithoutConstructor();
    }

    #[DataProvider('assignedFilterProvider')]
    public function testAssignedFilter($assignee, $filter, $expected)
    {
        $this->assertSame($expected, $this->invoke('matchesAssignedFilter', [$assignee, $filter]));
    }

    public static function assignedFilterProvider()
    {
        return [
            ['', 'false', true],
            ['alice@example.test', 'true', true],
            ['alice@example.test', 'alice', true],
            ['alice', 'alice@example.test', true],
            ['bob', 'alice', false]
        ];
    }

    public function testServiceSignatureContainsBothObjectNames()
    {
        $this->assertSame('service|host-a|disk', $this->invoke('buildObjectSignature', [[
            'type' => 'service',
            'host_name' => 'host-a',
            'service_name' => 'disk'
        ]]));
    }

    public function testAssignmentNoteIsTrimmedAndLimited()
    {
        $note = $this->invoke('sanitizeAssignmentNote', ['  ' . str_repeat('x', 1100) . '  ']);

        $this->assertSame(1024, mb_strlen($note));
    }

    public function testLocalGroupMembersAreAddedToActiveDirectoryUsers()
    {
        $users = $this->invoke('mergeLocalGroupMembersIntoActiveDirectory', [
            ['admin', 'local-user'],
            ['existing@company.test'],
            ['ADMIN', 'new-user@company.test', 'EXISTING@COMPANY.TEST']
        ]);

        $this->assertSame(['existing@company.test', 'new-user@company.test'], $users);
    }

    public function testRecoveryCleanupRemovesOnlyAssignmentsForRecoveredObjects()
    {
        $recovered = [
            ['type' => 'host', 'host_name' => 'host-a', 'service_name' => null],
            ['type' => 'service', 'host_name' => 'host-a', 'service_name' => 'disk'],
            ['type' => 'service', 'host_name' => 'host-a', 'service_name' => 'unassigned']
        ];
        $controller = $this->getMockBuilder(IncidentAssignmentController::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['loadObjectsInStates'])
            ->getMock();
        $controller->expects($this->once())->method('loadObjectsInStates')
            ->with([0], [0, 1])->willReturn($recovered);
        $store = $this->getMockBuilder(IncidentAssignmentStore::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['loadMany', 'remove'])
            ->getMock();
        $store->expects($this->once())->method('loadMany')->with($recovered)->willReturn([
            'host|host-a|' => ['assignee' => 'alice'],
            'service|host-a|disk' => ['assignee' => 'bob']
        ]);
        $removed = [];
        $store->expects($this->exactly(2))->method('remove')->willReturnCallback(
            function ($type, $host, $service) use (&$removed) {
                $removed[] = [$type, $host, $service];
            }
        );
        $this->controller = $controller;
        $this->invoke('clearRecoveredAssignments', [$store]);
        $this->assertSame([
            ['host', 'host-a', null],
            ['service', 'host-a', 'disk']
        ], $removed);
    }

    protected function invoke($method, array $arguments)
    {
        $reflection = new ReflectionMethod($this->controller, $method);
        $reflection->setAccessible(true);

        return $reflection->invokeArgs($this->controller, $arguments);
    }
}
