<?php

// SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

namespace Icinga\Web\Security;

use Icinga\Web\Session;

class CsrfToken
{
    const MAX_AGE = 7200;

    public static function generate(): string
    {
        $timestamp = time();
        $nonce = bin2hex(random_bytes(16));
        $payload = $timestamp . '|' . $nonce;

        return $payload . '|' . hash_hmac('sha256', $payload, self::getSessionSecret());
    }

    public static function isValid(mixed $token): bool
    {
        if (! is_string($token)) {
            return false;
        }

        $parts = explode('|', $token);
        if (count($parts) !== 3
            || ! ctype_digit($parts[0])
            || strlen($parts[1]) !== 32
            || ! ctype_xdigit($parts[1])
            || strlen($parts[2]) !== 64
            || ! ctype_xdigit($parts[2])
        ) {
            return false;
        }

        $timestamp = (int) $parts[0];
        if ($timestamp > time() + 60 || $timestamp < time() - self::MAX_AGE) {
            return false;
        }

        $payload = $parts[0] . '|' . $parts[1];
        $expected = hash_hmac('sha256', $payload, self::getSessionSecret());

        return hash_equals($expected, $parts[2]);
    }

    protected static function getSessionSecret(): string
    {
        return Session::getSession()->getId();
    }
}
