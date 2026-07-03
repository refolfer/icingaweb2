<?php

// SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

namespace Icinga\Module\Icingadb\Forms\Hostgroup;

use Icinga\Module\Icingadb\Common\Database;
use Icinga\Module\Icingadb\Model\Hostgroupsummary;
use Icinga\Web\Form;
use Icinga\Web\Notification;

class ResponsibilityForm extends Form
{
    use Database;

    /** @var Hostgroupsummary */
    protected $hostgroup;

    public function __construct(Hostgroupsummary $hostgroup)
    {
        parent::__construct();
        $this->hostgroup = $hostgroup;
        $this->setSubmitLabel($this->translate('Save'));
        $this->setProgressLabel($this->translate('Saving'));
    }

    public function setHostgroup(Hostgroupsummary $hostgroup): self
    {
        $this->hostgroup = $hostgroup;

        return $this;
    }

    public function translate($text, $context = null)
    {
        return parent::translate($text, $context);
    }

    public function createElements(array $formData)
    {
        $current = $this->loadResponsibility();

        $this->addElement(
            'text',
            'responsible_user',
            [
                'allowEmpty'    => true,
                'label'         => $this->translate('Responsible user'),
                'value'         => $formData['responsible_user'] ?? ($current['responsible_user'] ?? ''),
                'description'   => $this->translate(
                    'User who is responsible for this host group. Leave empty if none is assigned.'
                )
            ]
        );

        $this->addElement(
            'textarea',
            'responsible_note',
            [
                'allowEmpty'    => true,
                'label'         => $this->translate('Note'),
                'value'         => $formData['responsible_note'] ?? ($current['responsible_note'] ?? ''),
                'description'   => $this->translate('Optional short note shown together with the responsible user.')
            ]
        );
    }

    public function onSuccess()
    {
        $this->storeResponsibility(
            trim((string) $this->getValue('responsible_user', '')),
            trim((string) $this->getValue('responsible_note', ''))
        );

        Notification::success(sprintf(
            $this->translate('Responsibility information for host group "%s" updated successfully'),
            $this->hostgroup->display_name
        ));

        $this->getResponse()->setReloadWindow(true);

        return true;
    }

    protected function loadResponsibility(): array
    {
        $row = $this->getDb()->fetchRow(
            'SELECT responsible_user, responsible_note'
            . ' FROM hostgroup_responsibility r'
            . ' JOIN hostgroup h ON h.id = r.hostgroup_id'
            . ' WHERE h.name = ?',
            [$this->hostgroup->name]
        );

        if (is_array($row)) {
            return $row;
        }

        if (is_object($row)) {
            return get_object_vars($row);
        }

        return [];
    }

    protected function storeResponsibility(string $user, string $note): void
    {
        $db = $this->getDb();
        $hostgroupId = $this->hostgroup->id;
        $existing = $db->fetchRow(
            'SELECT hostgroup_id FROM hostgroup_responsibility WHERE hostgroup_id = ?',
            [$hostgroupId]
        );

        if ($user === '' && $note === '') {
            if ($existing !== false && $existing !== null) {
                $db->delete('hostgroup_responsibility', ['hostgroup_id = ?' => $hostgroupId]);
            }

            return;
        }

        $data = [
            'hostgroup_id'      => $hostgroupId,
            'responsible_user'  => $user,
            'responsible_note'  => $note
        ];

        if ($existing !== false && $existing !== null) {
            $db->update('hostgroup_responsibility', $data, ['hostgroup_id = ?' => $hostgroupId]);
        } else {
            $db->insert('hostgroup_responsibility', $data);
        }
    }
}
