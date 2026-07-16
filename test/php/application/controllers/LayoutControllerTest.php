<?php

// SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

namespace Tests\Icinga\Controllers;

use Icinga\Controllers\LayoutController;
use Icinga\Test\BaseTestCase;
use ReflectionClass;
use ReflectionMethod;

class LayoutControllerTest extends BaseTestCase
{
    protected $controller;

    public function setUp(): void
    {
        parent::setUp();
        $reflection = new ReflectionClass(LayoutController::class);
        $this->controller = $reflection->newInstanceWithoutConstructor();
    }

    /** @dataProvider quickMenuUrlProvider */
    public function testQuickMenuUrlSanitization($input, $expected)
    {
        $this->assertSame($expected, $this->invoke('normalizeQuickMenuUrl', [$input]));
    }

    public static function quickMenuUrlProvider()
    {
        return [
            ['/icingadb/hosts', '/icingadb/hosts'],
            ['icingadb/services', '/icingadb/services'],
            ['https://status.example.test/', 'https://status.example.test/'],
            ['javascript:alert(1)', ''],
            ['data:text/html,test', ''],
            ['mailto:operator@example.test', '']
        ];
    }

    public function testQuickMenuItemsAreSanitizedAndLimited()
    {
        $items = [];
        for ($index = 0; $index < 50; ++$index) {
            $items[] = ['label' => 'Host ' . $index, 'url' => '/icingadb/host/' . $index];
        }
        $items[] = ['label' => '<b>Unsafe</b>', 'url' => 'javascript:alert(1)'];

        $sanitized = $this->invoke('sanitizeQuickMenuItems', [$items]);

        $this->assertCount(LayoutController::QUICK_MENU_MAX_ITEMS, $sanitized);
        $this->assertSame('Host 0', $sanitized[0]['label']);
    }

    protected function invoke($method, array $arguments)
    {
        $reflection = new ReflectionMethod($this->controller, $method);
        $reflection->setAccessible(true);

        return $reflection->invokeArgs($this->controller, $arguments);
    }
}
