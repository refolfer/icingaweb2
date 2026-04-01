<?php

// SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

namespace Icinga\Security\Csp\Reason;

/**
 * Reason for loading a CSP directive for a module.
 * The CSP directive allows the module to be loaded.
 */
readonly class ModuleCspReason implements CspReason
{
    /**
     * @param string $module the module to load the CSP directive for
     */
    public function __construct(
        public string $module,
    ) {
    }
}
