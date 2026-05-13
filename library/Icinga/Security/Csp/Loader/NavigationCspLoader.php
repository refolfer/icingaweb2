<?php

// SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

namespace Icinga\Security\Csp\Loader;

use DirectoryIterator;
use Generator;
use Icinga\Application\Config;
use Icinga\Authentication\Auth;
use Icinga\Security\Csp\LoadedCsp;
use Icinga\Security\Csp\Reason\NavigationCspReason;
use Icinga\Web\Navigation\Navigation;
use Icinga\Web\Navigation\NavigationItem;

/**
 * Loads CSP directives for navigation items that have an external URL.
 * The CSP directive allows the iframe to be embedded on the page.
 */
class NavigationCspLoader implements CspLoader
{
    function __construct(
        protected bool $allUsers = false,
    ) {
    }

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
        $auth = Auth::getInstance();
        if (! $auth->isAuthenticated()) {
            return [];
        }

        $result = [];
        $navigationTypes = Navigation::getItemTypeConfiguration();
        if ($this->allUsers) {
            foreach ($navigationTypes as $type => $typeConfig) {
                $sharedConfig = Config::navigation($type);
                if (! $sharedConfig->isEmpty()) {
                    $result = array_merge($result, $this->extractCSPs($sharedConfig, $type, $typeConfig, null));
                }

                foreach (new DirectoryIterator('/etc/icingaweb2/preferences') as $userDir) {
                    if ($userDir->isDot() || ! $userDir->isDir()) {
                        continue;
                    }

                    $config = Config::navigation($type, $userDir->getFilename());
                    if ($config->isEmpty()) {
                        continue;
                    }

                    $result = array_merge(
                        $result,
                        $this->extractCSPs($config, $type, $typeConfig, $userDir->getFilename()),
                    );
                }
            }
        } else {
            foreach ($navigationTypes as $type => $typeConfig) {
                $navigation = new Navigation();
                foreach ($navigation->load($type) as $rootItem) {
                    foreach (self::yieldNavigation($rootItem) as $item) {
                        $result[] = $this->navItemToCsp($item, $type, $typeConfig, $auth->getUser()->getUsername());
                    }
                }
            }
        }

        return $result;
    }

    protected function navItemToCsp(
        NavigationItem $item,
        string $type,
        array $typeConfig,
        ?string $user
    ): LoadedCsp {
        $url = $item->getUrl();
        $cspUrl = $url->getScheme() . '://' . $url->getHost();
        if (($port = $url->getPort()) !== null) {
            $cspUrl .= ':' . $port;
        }

        $csp = new LoadedCsp(new NavigationCspReason($type, $typeConfig, $item, $user));
        $csp->add('frame-src', $cspUrl);
        return $csp;
    }

    /**
     * @param Config $config
     * @param string $type
     * @param array $typeConfig
     * @param string|null $user
     *
     * @return LoadedCsp[]
     */
    protected function extractCSPs(Config $config, string $type, array $typeConfig, ?string $user): array
    {
        $nav = Navigation::fromConfig($config);

        $result = [];
        foreach ($nav as $rootItem) {
            foreach (self::yieldNavigation($rootItem) as $item) {
                $result[] = $this->navItemToCsp($item, $type, $typeConfig, $user);
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
