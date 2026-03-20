<?php
/* Icinga Web 2 | (c) 2026 Icinga Development Team | GPLv2+ */

namespace Icinga\Security\Csp\Reason;

use Icinga\Web\Navigation\NavigationItem;

/**
 * Reason for loading a CSP directive for a navigation item.
 * The CSP directive allows the iframe to be embedded on the page.
 */
class NavigationCspReason extends CspReason
{
    public function __construct(
        public readonly string $type,
        public readonly NavigationItem $item,
    ) {
    }
}
