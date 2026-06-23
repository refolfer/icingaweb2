<?php

// SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

use Icinga\Application\Icinga;

if (Icinga::app()->isCli()) {
    return;
}

$assistantIndex = new Zend_Controller_Router_Route(
    'assistant',
    array(
        'controller' => 'assistant',
        'action'     => 'index',
        'module'     => 'assistant'
    )
);

$assistantRespond = new Zend_Controller_Router_Route(
    'assistant/respond',
    array(
        'controller' => 'assistant',
        'action'     => 'respond',
        'module'     => 'assistant'
    )
);

$assistantReport = new Zend_Controller_Router_Route(
    'assistant/report',
    array(
        'controller' => 'assistant',
        'action'     => 'report',
        'module'     => 'assistant'
    )
);

$this->addRoute('assistant/index', $assistantIndex);
$this->addRoute('assistant/respond', $assistantRespond);
$this->addRoute('assistant/report', $assistantReport);
