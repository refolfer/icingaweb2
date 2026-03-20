<?php
/* Icinga Web 2 | (c) 2026 Icinga Development Team | GPLv2+ */

namespace Icinga\Security\Csp\Loader;

use Icinga\Security\Csp\LoadedCsp;

/**
 * Base class for CSP loaders.
 * A loader is responsible for loading CSP directives from a specific source.
 */
abstract class CspLoader
{
    /**
     * Load the CSP directives from the source.
     *
     * @return LoadedCsp[]
     */
    public abstract function load(): array;
}
