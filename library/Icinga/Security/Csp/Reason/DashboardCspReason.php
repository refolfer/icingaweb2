<?php
/* Icinga Web 2 | (c) 2026 Icinga Development Team | GPLv2+ */

namespace Icinga\Security\Csp\Reason;

use Icinga\Web\Widget\Dashboard\Dashlet;
use Icinga\Web\Widget\Dashboard\Pane;

/**
 * Reason for loading a CSP directive for a dashboard dashlet.
 * The CSP directive allows the iframe to be embedded on the page.
 */
class DashboardCspReason extends CspReason
{
    /**
     * @param Pane $pane the pane that contains the dashlet
     * @param Dashlet $dashlet the dashlet to load the CSP directive for
     */
    public function __construct(
        public readonly Pane $pane,
        public readonly Dashlet $dashlet,
    ) {
    }
}
