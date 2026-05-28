<?php

// SPDX-FileCopyrightText: 2018 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

namespace Icinga\Controllers;

use Exception;
use Icinga\Application\Config;
use Icinga\Data\ConfigObject;
use Icinga\User\Preferences\PreferencesStore;
use Icinga\Util\Json;
use Icinga\Web\Controller\ActionController;
use Icinga\Web\Menu;
use Icinga\Web\Session;

/**
 * Create complex layout parts
 */
class LayoutController extends ActionController
{
    const QUICK_MENU_PREF_ITEMS = 'quick_menu_items_json';
    const QUICK_MENU_PREF_NOTE = 'quick_menu_note';
    const QUICK_MENU_MAX_ITEMS = 40;
    const QUICK_MENU_MAX_LABEL_LENGTH = 120;
    const QUICK_MENU_MAX_URL_LENGTH = 2048;
    const QUICK_MENU_MAX_NOTE_LENGTH = 10000;

    /**
     * Render the menu
     */
    public function menuAction()
    {
        $this->setAutorefreshInterval(15);
        $this->_helper->layout()->disableLayout();
        $this->view->menuRenderer = (new Menu())->getRenderer();
        $this->view->quickMenu = $this->loadQuickMenu();
    }

    public function announcementsAction()
    {
        $this->_helper->layout()->disableLayout();
    }

    /**
     * Load or update the authenticated user's quick menu state
     */
    public function quickmenuAction()
    {
        $this->_helper->layout()->disableLayout();
        $this->_helper->viewRenderer->setNoRender(true);

        if (! $this->Auth()->isAuthenticated()) {
            $this->respondWithJson(['error' => 'Unauthorized'], 401);
            return;
        }

        if ($this->getRequest()->isGet()) {
            $this->respondWithJson($this->loadQuickMenu());
            return;
        }

        $this->assertHttpMethod('POST');

        $itemsJson = $this->getRequest()->getPost('items');
        $note = $this->getRequest()->getPost('note');
        if ($itemsJson === null && $note === null) {
            $this->respondWithJson(['error' => 'Missing payload'], 400);
            return;
        }

        $current = $this->loadQuickMenu();
        $items = $current['items'];
        $safeNote = $current['note'];

        if ($itemsJson !== null) {
            try {
                $decoded = Json::decode((string) $itemsJson, true);
            } catch (Exception $_) {
                $this->respondWithJson(['error' => 'Invalid items payload'], 400);
                return;
            }

            if (! is_array($decoded)) {
                $this->respondWithJson(['error' => 'Invalid items payload'], 400);
                return;
            }

            $items = $this->sanitizeQuickMenuItems($decoded);
        }

        if ($note !== null) {
            $safeNote = $this->sanitizeQuickMenuNote($note);
        }

        try {
            $this->saveQuickMenu($items, $safeNote);
        } catch (Exception $e) {
            $this->respondWithJson(['error' => $e->getMessage()], 500);
            return;
        }

        $this->respondWithJson([
            'ok' => true,
            'items' => $items,
            'note' => $safeNote
        ]);
    }

    /**
     * Persist quick menu state to user preferences
     *
     * @param array  $items
     * @param string $note
     *
     * @throws Exception
     */
    protected function saveQuickMenu(array $items, $note)
    {
        $user = $this->Auth()->getUser();
        $preferences = $user->getPreferences();
        $webPreferences = $preferences->get('icingaweb') ?: [];

        $webPreferences[static::QUICK_MENU_PREF_ITEMS] = Json::sanitize($items);
        $webPreferences[static::QUICK_MENU_PREF_NOTE] = $this->sanitizeQuickMenuNote($note);
        $preferences->icingaweb = $webPreferences;

        Session::getSession()->user->setPreferences($preferences);

        if (($store = $this->createPreferencesStore()) !== null) {
            $store->save($preferences);
        }
    }

    /**
     * Load quick menu state from user preferences
     *
     * @return array{items: array, note: string}
     */
    protected function loadQuickMenu()
    {
        $user = $this->Auth()->getUser();
        $preferences = $user->getPreferences();
        $items = [];
        $rawItems = $preferences->getValue('icingaweb', static::QUICK_MENU_PREF_ITEMS, '[]');
        $note = $preferences->getValue('icingaweb', static::QUICK_MENU_PREF_NOTE, '');

        try {
            $decoded = Json::decode((string) $rawItems, true);
            if (is_array($decoded)) {
                $items = $decoded;
            }
        } catch (Exception $_) {
            $items = [];
        }

        return [
            'items' => $this->sanitizeQuickMenuItems($items),
            'note' => $this->sanitizeQuickMenuNote($note)
        ];
    }

    /**
     * Create the current user's preference store when a persistent resource is configured
     *
     * @return PreferencesStore|null
     */
    protected function createPreferencesStore()
    {
        try {
            $config = Config::app()->getSection('global');
        } catch (Exception $_) {
            return null;
        }

        if (! isset($config->config_resource)) {
            return null;
        }

        return PreferencesStore::create(new ConfigObject([
            'resource' => $config->config_resource
        ]), $this->Auth()->getUser());
    }

    /**
     * Normalize quick menu link list
     *
     * @param array $items
     *
     * @return array
     */
    protected function sanitizeQuickMenuItems(array $items)
    {
        $sanitized = [];
        foreach ($items as $item) {
            if (! is_array($item)) {
                continue;
            }

            $label = trim(strip_tags((string) ($item['label'] ?? '')));
            $url = trim((string) ($item['url'] ?? ''));

            if ($label === '' || $url === '') {
                continue;
            }

            $label = mb_substr($label, 0, static::QUICK_MENU_MAX_LABEL_LENGTH);
            $url = $this->normalizeQuickMenuUrl($url);
            if ($url === '') {
                continue;
            }

            $sanitized[] = [
                'label' => $label,
                'url' => $url
            ];

            if (count($sanitized) >= static::QUICK_MENU_MAX_ITEMS) {
                break;
            }
        }

        return $sanitized;
    }

    /**
     * Normalize note text
     *
     * @param mixed $note
     *
     * @return string
     */
    protected function sanitizeQuickMenuNote($note)
    {
        return mb_substr(trim((string) $note), 0, static::QUICK_MENU_MAX_NOTE_LENGTH);
    }

    /**
     * Normalize and validate a quick menu URL
     *
     * @param string $url
     *
     * @return string
     */
    protected function normalizeQuickMenuUrl($url)
    {
        $url = preg_replace('/\s+/', '', trim($url));
        if ($url === '' || strlen($url) > static::QUICK_MENU_MAX_URL_LENGTH) {
            return '';
        }

        if (preg_match('/^(javascript|data|vbscript):/i', $url)) {
            return '';
        }

        if (preg_match('/^[a-z][a-z0-9+.-]*:/i', $url)) {
            if (! preg_match('/^https?:/i', $url)) {
                return '';
            }
        } elseif ($url[0] !== '/' && $url[0] !== '#') {
            $url = '/' . ltrim($url, '/');
        }

        return $url;
    }

    /**
     * Emit JSON response and status code
     *
     * @param array $payload
     * @param int   $statusCode
     */
    protected function respondWithJson(array $payload, $statusCode = 200)
    {
        $this->getResponse()
            ->setHttpResponseCode((int) $statusCode)
            ->setHeader('Content-Type', 'application/json; charset=utf-8', true)
            ->setBody(Json::sanitize($payload));
    }
}
