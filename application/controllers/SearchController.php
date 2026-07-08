<?php

// SPDX-FileCopyrightText: 2018 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

namespace Icinga\Controllers;

use Icinga\Web\Controller\ActionController;
use Icinga\Web\Url;
use Icinga\Web\Widget\Dashboard;
use Icinga\Web\Widget\SearchDashboard;

/**
 * Search controller
 */
class SearchController extends ActionController
{
    public function indexAction()
    {
        $assigned = $this->normalizeAssignedFilter($this->params->get('assigned', ''));

        if ($assigned !== '') {
            $this->view->dashboard = $this->createAssignedDashboard($assigned);
            $this->view->dashboard->render();
            return;
        }

        $searchDashboard = new SearchDashboard();
        $searchDashboard->setUser($this->Auth()->getUser());
        $this->view->dashboard = $searchDashboard->search($this->params->get('q'));

        // NOTE: This renders the dashboard twice. Remove this once we can catch exceptions thrown in view scripts.
        $this->view->dashboard->render();
    }

    public function hintAction()
    {
    }

    protected function createAssignedDashboard($assigned)
    {
        $assigned = trim((string) $assigned);
        $dashboard = new Dashboard();
        $dashboard->setUser($this->Auth()->getUser());
        $paneTitle = $this->getAssignedDashboardTitle($assigned);
        $dashboard->createPane('assigned');
        $pane = $dashboard->getPane('assigned')->setTitle($paneTitle);
        $pane->createDashlet(
            $paneTitle,
            Url::fromPath('incident-assignment/assigned', ['assigned' => $assigned])
        );
        $dashboard->activate('assigned');

        return $dashboard;
    }

    protected function normalizeAssignedFilter($assigned)
    {
        $assigned = trim((string) $assigned);

        if ($assigned === '') {
            return '';
        }

        return strtolower($assigned) === 'me' ? (string) $this->Auth()->getUser()->getUsername() : $assigned;
    }

    protected function getAssignedDashboardTitle($assigned)
    {
        if ($assigned === 'true') {
            return $this->translate('Assigned incidents');
        }

        if ($assigned === 'false') {
            return $this->translate('Unassigned incidents');
        }

        return sprintf($this->translate('Assigned to %s'), $assigned);
    }
}
