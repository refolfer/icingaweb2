<?php

// SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

namespace Icinga\Security\Csp\Reason;

use Icinga\Web\Widget\Dashboard;
use Icinga\Web\Widget\Dashboard\Dashlet;
use Icinga\Web\Widget\Dashboard\Pane;

/**
 * Reason for loading a CSP directive for a dashboard dashlet.
 * The CSP directive allows the iframe to be embedded on the page.
 */
readonly class DashboardCspReason implements CspReason
{
    /**
     * @param Dashboard $dashboard the dashboard to load the CSP directive for
     * @param Pane $pane the pane that contains the dashlet
     * @param Dashlet $dashlet the dashlet to load the CSP directive for
     */
    public function __construct(
        public Dashboard $dashboard,
        public Pane $pane,
        public Dashlet $dashlet,
    ) {
    }
}
