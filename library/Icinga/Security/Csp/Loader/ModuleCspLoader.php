<?php
/* Icinga Web 2 | (c) 2026 Icinga Development Team | GPLv2+ */

namespace Icinga\Security\Csp\Loader;

use Icinga\Application\ClassLoader;
use Icinga\Application\Hook\CspDirectiveHook;
use Icinga\Application\Logger;
use Icinga\Security\Csp\LoadedCsp;
use Icinga\Security\Csp\Reason\ModuleCspReason;
use Throwable;

/**
 * Loads CSP directives from modules.
 * Modules can implement the {@see CspDirectiveHook} interface to provide custom CSP directives.
 * The hook is called for each request, allowing modules to dynamically add or modify CSP policies.
 */
class ModuleCspLoader extends CspLoader
{
    /**
     * List all CSP directives from modules.
     * See {@see CspDirectiveHook} for details.
     *
     * @return LoadedCsp[]
     */
    public function load(): array
    {
        $result = [];

        foreach (CspDirectiveHook::all() as $hook) {
            $reason = new ModuleCspReason(ClassLoader::extractModuleName(get_class($hook)));
            $csp = new LoadedCsp($reason);
            try {
                foreach ($hook->getCspDirectives() as $directive => $policies) {
                    if (count($policies) === 0) {
                        continue;
                    }

                    $csp->add($directive, $policies);

                    $result[] = $csp;
                }
            } catch (Throwable $e) {
                Logger::error('Failed to CSP hook on request: %s', $e);
            }
        }

        return $result;
    }
}
