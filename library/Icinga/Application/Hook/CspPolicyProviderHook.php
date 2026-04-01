<?php

// SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

namespace Icinga\Application\Hook;

use Icinga\Application\Hook;
use ipl\Web\Common\Csp;

/**
 * Allow modules to provide custom Content-Security-Policy policies.
 * This hook is only used if the CSP header is enabled.
 */
abstract class CspPolicyProviderHook
{
    /**
     * Allow the module to provide custom directives and policies for the CSP header.
     * The return value should be an instance of Csp with the requested policies.
     *
     * @return Csp a CSP instance, this instance will be merged with all other requested directives.
     */
    abstract public function getCsp(): Csp;

    /**
     * Get all registered implementations
     *
     * @return static[]
     */
    public static function all(): array
    {
        return Hook::all('CspPolicyProvider');
    }

    /**
     * Register the class as a CspPolicyProviderHook implementation
     *
     * Call this method on your implementation during module initialization to make Icinga Web aware of your hook.
     */
    public static function register(): void
    {
        Hook::register('CspPolicyProvider', static::class, static::class, true);
    }
}
