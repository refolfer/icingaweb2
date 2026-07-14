<?php

// SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

/** @var $this \Icinga\Application\Modules\Module */

$this->providePermission(
    'application/critical-assignments',
    $this->translate('Allow to assign critical hosts and services to registered users')
);
