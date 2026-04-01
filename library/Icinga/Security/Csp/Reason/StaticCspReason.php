<?php
/* Icinga Web 2 | (c) 2026 Icinga Development Team | GPLv2+ */

namespace Icinga\Security\Csp\Reason;

/**
 * A hardcoded CSP reason.
 * Useful for testing or providing a static CSP configuration.
 */
readonly class StaticCspReason implements CspReason
{
    /**
     * @param string $name the name to display for CSP reason
     */
    public function __construct(
        public string $name,
    ) {
    }
}
