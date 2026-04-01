<?php

// SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

namespace Icinga\Security\Csp\Loader;

use Icinga\Security\Csp\LoadedCsp;

/**
 * Interface for CSP loaders.
 * A loader is responsible for loading CSP directives from a specific source.
 */
interface CspLoader
{
    /**
     * Load the CSP directives from the source.
     *
     * @return LoadedCsp[]
     */
    public function load(): array;
}
