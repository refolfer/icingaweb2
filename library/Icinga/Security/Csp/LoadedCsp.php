<?php
/* Icinga Web 2 | (c) 2026 Icinga Development Team | GPLv2+ */

namespace Icinga\Security\Csp;

use Icinga\Security\Csp\Reason\CspReason;
use ipl\Web\Common\Csp;

/**
 * A CSP that has been loaded from a source.
 * Contains the reason for the CSP directive/policy to exist.
 */
class LoadedCsp extends Csp
{
    /**
     * @param CspReason $loadReason the reason for the CSP directive/policy to exist
     */
    public function __construct(
        public readonly CspReason $loadReason,
    ) {
    }
}
