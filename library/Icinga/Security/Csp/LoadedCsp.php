<?php

// SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

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

    public static function fromCsp(Csp $csp, CspReason $reason): static
    {
        $instance = new static($reason);
        $instance->directives = $csp->directives;
        return $instance;
    }
}
