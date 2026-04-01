<?php
/* Icinga Web 2 | (c) 2026 Icinga Development Team | GPLv2+ */

namespace Icinga\Security\Csp\Loader;

use Icinga\Security\Csp\LoadedCsp;

/**
 * Interface for CSP loaders.
 * A loader is responsible for loading CSP directives from a specific source.
 */
interface CspLoader
{
    /**
     * Load the CSP directives from the source.
     *
     * @return LoadedCsp[]
     */
    public function load(): array;
}
