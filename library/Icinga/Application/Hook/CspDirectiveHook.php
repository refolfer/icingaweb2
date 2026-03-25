<?php

/* Icinga Web 2 | (c) 2025 Icinga GmbH | GPLv2+ */

namespace Icinga\Application\Hook;

use Icinga\Application\Hook;
use ipl\Web\Common\Csp;

/**
 * Allow modules to provide custom CSP directives.
 * This hook is only used if the CSP header is enabled.
 */
abstract class CspDirectiveHook
{
    /**
     * Allow the module to provide custom directives for the CSP header. The return value should be an instance of Csp
     * with the requested directives.
     *
     * @return Csp a CSP instance, this instance will be merged with all other requested directives.
     */
    abstract public function getCspDirectives(): Csp;

    /**
     * Get all registered implementations
     *
     * @return static[]
     */
    public static function all(): array
    {
        return Hook::all('CspDirective');
    }

    /**
     * Register the class as a CspDirectiveHook implementation
     *
     * Call this method on your implementation during module initialization to make Icinga Web aware of your hook.
     */
    public static function register(): void
    {
        Hook::register('CspDirective', static::class, static::class, true);
    }
}
