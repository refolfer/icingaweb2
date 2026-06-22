<?php

// SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

namespace Icinga\Module\Icingadb\ProvidedHook;

use Icinga\Authentication\Auth;
use Icinga\Module\Icingadb\Hook\ServiceActionsHook;
use Icinga\Module\Icingadb\Model\Service;
use ipl\I18n\Translation;
use ipl\Web\Widget\Link;

class CreateServiceIncidentAssignment extends ServiceActionsHook
{
    use Translation;

    public function getActionsForObject(Service $service): array
    {
        if (! Auth::getInstance()->hasPermission('application/critical-assignments')) {
            return [];
        }

        if (! $this->isCriticalProblem($service)) {
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

    protected function isCriticalProblem(Service $service): bool
    {
        return $service->state->is_problem
            && (
                (int) $service->state->hard_state === 2
                || (int) $service->state->soft_state === 2
            );
    }
}
