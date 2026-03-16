<?php

/* Icinga Web 2 | (c) 2025 Icinga GmbH | GPLv2+ */

namespace Icinga\Application\Hook;

use Icinga\Application\Hook;

/**
 * Allow modules to provide custom CSP directives.
 * This hook is only used if the CSP header is enabled.
 */
abstract class CspDirectiveHook
{
    /**
     * Allow the module to provide custom directives for the CSP header. The return value should be an array
     * with a directive as the key and the policies in an array as the value. The valid values can either be
     * a concrete host, allowlisting subdomains for hosts or custom nonce for that module.
     *
     * Example: [ 'img-src' => [ 'https://*.icinga.com', 'https://example.com/' ] ]
     *
     * @return array<string, string[]> The CSP directives are the keys and the policies the values.
     */
    abstract public function getCspDirectives(): array;

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
