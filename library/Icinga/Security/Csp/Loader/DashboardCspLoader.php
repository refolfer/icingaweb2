<?php

// SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

namespace Icinga\Security\Csp\Loader;

use DirectoryIterator;
use Icinga\Authentication\Auth;
use Icinga\Security\Csp\LoadedCsp;
use Icinga\Security\Csp\Reason\DashboardCspReason;
use Icinga\User;
use Icinga\Web\Url;
use Icinga\Web\Widget\Dashboard;

/**
 * This loader is responsible for loading CSP directives for external URLs in dashboard panes.
 * It iterates through all dashboard panes and checks if any dashlets have an external URL.
 * If an external URL is found, it adds a CSP directive for the URL's host and port.
 * The CSP directive allows the iframe to be embedded on the page.'
 */
class DashboardCspLoader implements CspLoader
{
    /**
     * @param bool $allUsers whether to load CSP directives for all users, or only the current user
     */
    public function __construct(
        protected bool $allUsers = false,
    ) {
    }

    /**
     * @param User $user
     *
     * @return LoadedCsp[]
     */
    protected function loadForUser(User $user): array
    {
        $dashboard = new Dashboard();
        $dashboard->setUser($user);
        $dashboard->load();

        $result = [];

        /** @var Dashboard\Pane $pane */
        foreach ($dashboard->getPanes() as $pane) {
            /** @var Dashboard\Dashlet $dashlet */
            foreach ($pane->getDashlets() as $dashlet) {
                $url = $dashlet->getUrl();
                if ($url === null) {
                    continue;
                }

                $absoluteUrl = $url->isExternal()
                    ? $url->getAbsoluteUrl()
                    : $url->getParam('url');
                if ($absoluteUrl === null || filter_var($absoluteUrl, FILTER_VALIDATE_URL) === false) {
                    continue;
                }

                $absoluteUrl = Url::fromPath($absoluteUrl);

                $cspUrl = $absoluteUrl->getScheme() . '://' . $absoluteUrl->getHost();
                if (($port = $absoluteUrl->getPort()) !== null) {
                    $cspUrl .= ':' . $port;
                }

                $csp = new LoadedCsp(new DashboardCspReason($dashboard, $pane, $dashlet));
                $csp->add('frame-src', $cspUrl);
                $result[] = $csp;
            }
        }

        return $result;
    }

    /**
     * Fetches all dashlets for the current user that have an external URL.
     *
     * @return LoadedCsp[] A list of CSP directives, one for each dashlet that has an external URL.
     */
    public function load(): array
    {
        $auth = Auth::getInstance();
        if (! $auth->isAuthenticated()) {
            return [];
        }

        if ($this->allUsers) {
            $csps = [];
            foreach (new DirectoryIterator('/etc/icingaweb2/dashboards') as $dir) {
                if ($dir->isDot() || ! $dir->isDir()) {
                    continue;
                }

                $user = new User($dir->getFilename());
                $csps = array_merge($csps, $this->loadForUser($user));
            }

            return $csps;
        } else {
            return $this->loadForUser($auth->getUser());
        }
    }
}
