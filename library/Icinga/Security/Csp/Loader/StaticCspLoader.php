<?php

// SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

namespace Icinga\Security\Csp\Loader;

use Icinga\Security\Csp\LoadedCsp;
use Icinga\Security\Csp\Reason\StaticCspReason;

/**
 * Loads CSP directives from a static array.
 * Useful for testing or providing a static CSP configuration.
 */
class StaticCspLoader implements CspLoader
{
    /**
     * @param string $name the name to display for CSP reason
     * @param array $directives the CSP directives to load.
     * Each key is a directive name, and each value is an array of values for that directive.
     */
    public function __construct(
        protected string $name,
        protected array $directives,
    ) {
    }

    public function load(): array
    {
        $csp = new LoadedCsp(new StaticCspReason($this->name));
        foreach ($this->directives as $directive => $values) {
            $csp->add($directive, $values);
        }

        return [$csp];
    }
}
