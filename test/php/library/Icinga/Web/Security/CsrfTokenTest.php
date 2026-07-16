<?php

// SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

namespace Tests\Icinga\Web\Security;

use Icinga\Test\BaseTestCase;
use Icinga\Web\Security\CsrfToken;
use PHPUnit\Framework\Attributes\DataProvider;

class CsrfTokenTest extends BaseTestCase
{
    public function testGeneratedTokenIsValid()
    {
        $this->assertTrue(CsrfToken::isValid(CsrfToken::generate()));
    }

    public function testTamperedTokenIsRejected()
    {
        $token = CsrfToken::generate();
        $token[strlen($token) - 1] = $token[strlen($token) - 1] === 'a' ? 'b' : 'a';

        $this->assertFalse(CsrfToken::isValid($token));
    }

    #[DataProvider('invalidTokenProvider')]
    public function testMalformedTokenIsRejected($token)
    {
        $this->assertFalse(CsrfToken::isValid($token));
    }

    public static function invalidTokenProvider()
    {
        return [
            [''],
            ['123'],
            ['now|nonce|hash'],
            ['123|not-hex|hash'],
            ['123|aa|' . str_repeat('a', 64)],
            ['123|' . str_repeat('a', 32) . '|short']
        ];
    }
}
