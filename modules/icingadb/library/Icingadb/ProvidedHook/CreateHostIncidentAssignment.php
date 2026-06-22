<?php

// SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

namespace Icinga\Module\Icingadb\ProvidedHook;

use Icinga\Authentication\Auth;
use Icinga\Module\Icingadb\Hook\HostActionsHook;
use Icinga\Module\Icingadb\Model\Host;
use ipl\I18n\Translation;
use ipl\Web\Widget\Link;

class CreateHostIncidentAssignment extends HostActionsHook
{
    use Translation;

    public function getActionsForObject(Host $host): array
    {
        if (! Auth::getInstance()->hasPermission('application/critical-assignments')) {
            return [];
        }

        if (! $this->isCriticalProblem($host)) {
            return [];
        }

        return [
            new Link(
                $this->translate('Assign'),
                '#',
                [
                    'data-object-assignment-action' => true,
                    'data-base-target' => '_main',
                    'title' => $this->translate('Open assignee selection')
                ]
            )
        ];
    }

    protected function isCriticalProblem(Host $host): bool
    {
        return $host->state->is_problem
            && (
                (int) $host->state->hard_state === 2
                || (int) $host->state->soft_state === 2
            );
    }
}
