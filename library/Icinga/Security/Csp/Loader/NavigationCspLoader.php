<?php
/* Icinga Web 2 | (c) 2026 Icinga Development Team | GPLv2+ */

namespace Icinga\Security\Csp\Loader;

use Generator;
use Icinga\Authentication\Auth;
use Icinga\Security\Csp\LoadedCsp;
use Icinga\Security\Csp\Reason\NavigationCspReason;
use Icinga\Web\Navigation\Navigation;
use Icinga\Web\Navigation\NavigationItem;
use RuntimeException;

/**
 * Loads CSP directives for navigation items that have an external URL.
 * The CSP directive allows the iframe to be embedded on the page.
 */
class NavigationCspLoader implements CspLoader
{
    /**
     * Fetches navigation items for the current user.
     *
     * Iterates through all registered navigation types, loads both user-specific
     * and shared configurations, and returns a list of menu items.
     *
     * @return LoadedCsp[] A list of CSP directives, one for each navigation-item that has an external URL.
     */
    public function load(): array
    {
        $result = [];

        $auth = Auth::getInstance();
        if (! $auth->isAuthenticated()) {
            throw new RuntimeException('No user logged in');
        }

        $navigationType = Navigation::getItemTypeConfiguration();
        foreach ($navigationType as $type => $_) {
            $navigation = new Navigation();
            foreach ($navigation->load($type) as $rootItem) {
                foreach (self::yieldNavigation($rootItem) as $item) {
                    $url = $item->getUrl();
                    $cspUrl = $url->getScheme() . '://' . $url->getHost();
                    if (($port = $url->getPort()) !== null) {
                        $cspUrl .= ':' . $port;
                    }

                    $csp = new LoadedCsp(new NavigationCspReason($type, $item));
                    $csp->add('frame-src', $cspUrl);
                    $result[] = $csp;
                }
            }
        }

        return $result;
    }

    /**
     * Recursively yield all navigation items that have an external URL.
     *
     * @param NavigationItem $item The top-level navigation item to start from.
     * @return Generator
     */
    protected static function yieldNavigation(NavigationItem $item): Generator
    {
        if ($item->hasChildren()) {
            foreach ($item as $child) {
                yield from self::yieldNavigation($child);
            }
        }

        $url = $item->getUrl();
        if ($url === null) {
            return;
        }
        if ($item->getTarget() !== '_blank' && $url->isExternal()) {
            yield $item;
        }
    }
}
