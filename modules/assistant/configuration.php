<?php

// SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

/** @var $this \Icinga\Application\Modules\Module */

$section = $this->menuSection(N_('AI Assistant'), array(
    'title'    => 'AI Assistant',
    'icon'     => 'chat',
    'url'      => 'assistant',
    'priority' => 650
));

$section->add(N_('Natural language search'), array(
    'url' => 'assistant',
));

$this->provideSearchUrl($this->translate('AI search'), 'assistant', -10);
