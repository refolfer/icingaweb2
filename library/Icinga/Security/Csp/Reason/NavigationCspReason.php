<?php

// SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

namespace Icinga\Security\Csp\Reason;

use Icinga\Web\Navigation\NavigationItem;

/**
 * Reason for loading a CSP directive for a navigation item.
 * The CSP directive allows the iframe to be embedded on the page.
 */
readonly class NavigationCspReason implements CspReason
{
    /**
     * @param string $type the type of the navigation item
     * @param array $typeConfiguration the configuration of the navigation item type
     * @param NavigationItem $item the navigation item to load the CSP directive for
     */
    public function __construct(
        public string $type,
        public array $typeConfiguration,
        public NavigationItem $item,
    ) {
    }
}
