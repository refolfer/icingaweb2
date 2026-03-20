<?php
/* Icinga Web 2 | (c) 2026 Icinga Development Team | GPLv2+ */

namespace Icinga\Security\Csp\Reason;

/**
 * Reason for loading a CSP directive for a module.
 * The CSP directive allows the module to be loaded.
 */
class ModuleCspReason extends CspReason
{
    /**
     * @param string $module the module to load the CSP directive for
     */
    public function __construct(
        public readonly string $module,
    ) {
    }
}
