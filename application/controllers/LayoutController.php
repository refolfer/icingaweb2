<?php

// SPDX-FileCopyrightText: 2018 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

namespace Icinga\Controllers;

use Exception;
use Icinga\Application\Config;
use Icinga\Data\ConfigObject;
use Icinga\Exception\ProgrammingError;
use Icinga\User;
use Icinga\User\Preferences;
use Icinga\User\Preferences\PreferencesStore;
use Icinga\Util\Json;
use Icinga\Web\Controller\ActionController;
use Icinga\Web\Menu;
use Icinga\Web\Security\CsrfToken;

/**
 * Create complex layout parts
 */
class LayoutController extends ActionController
{
    const QUICK_MENU_PREF_ITEMS = 'quick_menu_items_json';
    const QUICK_MENU_PREF_ITEMS_CHUNK_PREFIX = 'quick_menu_items_json_';
    const QUICK_MENU_PREF_CHUNK_LENGTH = 200;
    const QUICK_MENU_PREF_NOTE = 'quick_menu_note';
    const QUICK_MENU_PREF_NOTE_CHUNK_PREFIX = 'quick_menu_note_';
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
    public function quickmenuAction(): void
    {
        // @phpstan-ignore-next-line Zend helper methods are resolved dynamically.
        $this->_helper->layout->disableLayout();
        // @phpstan-ignore-next-line Zend helper methods are resolved dynamically.
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
        if (! $this->assertValidCsrfToken()) {
            return;
        }

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
                $decoded = Json::decode($this->stringValue($itemsJson), true);
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
            'note' => $safeNote,
            'csrfToken' => CsrfToken::generate()
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
    /** @param list<array{label:string,url:string}> $items */
    protected function saveQuickMenu(array $items, string $note): void
    {
        $user = $this->getAuthenticatedUser();
        $store = $this->createPreferencesStore();
        $preferences = $store !== null
            ? new Preferences($store->load())
            : $user->getPreferences();
        $webPreferences = $preferences->get('icingaweb') ?: [];

        $this->setChunkedQuickMenuItems($webPreferences, $items);
        $this->setChunkedPreference(
            $webPreferences,
            static::QUICK_MENU_PREF_NOTE,
            static::QUICK_MENU_PREF_NOTE_CHUNK_PREFIX,
            $this->sanitizeQuickMenuNote($note)
        );
        $preferences->icingaweb = $webPreferences;

        $user->setPreferences($preferences);

        if ($store !== null) {
            $store->save($preferences);
        }
    }

    /**
     * Load quick menu state from user preferences
     *
     * @return array{items: array, note: string}
     */
    /** @return array{items:list<array{label:string,url:string}>,note:string,csrfToken:string} */
    protected function loadQuickMenu(): array
    {
        $user = $this->getAuthenticatedUser();
        $preferences = $user->getPreferences();
        $store = $this->createPreferencesStore();
        $items = [];

        if ($store !== null) {
            try {
                $preferences = new Preferences($store->load());
                $user->setPreferences($preferences);
            } catch (Exception $_) {
                $preferences = $user->getPreferences();
            }
        }

        $rawItems = $this->getChunkedQuickMenuItems($preferences->get('icingaweb') ?: []);
        $note = $this->getChunkedPreference(
            $preferences->get('icingaweb') ?: [],
            static::QUICK_MENU_PREF_NOTE,
            static::QUICK_MENU_PREF_NOTE_CHUNK_PREFIX,
            ''
        );

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
            'note' => $this->sanitizeQuickMenuNote($note),
            'csrfToken' => CsrfToken::generate()
        ];
    }

    protected function assertValidCsrfToken(): bool
    {
        $token = $this->getRequest()->getHeader('X-CSRF-Token');
        if ($token === null || $token === '') {
            $token = $this->getRequest()->getPost('CSRFToken', '');
        }

        if (! CsrfToken::isValid($token)) {
            $this->respondWithJson(['error' => 'Invalid or expired CSRF token'], 403);
            return false;
        }

        return true;
    }

    /**
     * Store quick menu items across multiple preference values to avoid DB varchar limits
     *
     * @param array $webPreferences
     * @param array $items
     */
    /**
     * @param array<string,mixed> $webPreferences
     * @param list<array{label:string,url:string}> $items
     */
    protected function setChunkedQuickMenuItems(array &$webPreferences, array $items): void
    {
        $this->setChunkedPreference(
            $webPreferences,
            static::QUICK_MENU_PREF_ITEMS,
            static::QUICK_MENU_PREF_ITEMS_CHUNK_PREFIX,
            Json::sanitize($items)
        );
    }

    /**
     * Store long preference values across multiple DB-safe chunks
     *
     * @param array  $webPreferences
     * @param string $legacyKey
     * @param string $chunkPrefix
     * @param string $value
     */
    /** @param array<string,mixed> $webPreferences */
    protected function setChunkedPreference(
        array &$webPreferences,
        string $legacyKey,
        string $chunkPrefix,
        string $value
    ): void {
        $chunks = str_split((string) $value, static::QUICK_MENU_PREF_CHUNK_LENGTH);
        $index = 0;

        unset($webPreferences[$legacyKey]);

        foreach (array_keys($webPreferences) as $key) {
            if (strpos($key, $chunkPrefix) === 0) {
                unset($webPreferences[$key]);
            }
        }

        foreach ($chunks as $chunk) {
            $webPreferences[$chunkPrefix . sprintf('%03d', $index)] = $chunk;
            ++$index;
        }
    }

    /**
     * Read quick menu item JSON from chunked preferences with legacy single-value fallback
     *
     * @param array $webPreferences
     *
     * @return string
     */
    /** @param array<string,mixed> $webPreferences */
    protected function getChunkedQuickMenuItems(array $webPreferences): string
    {
        return $this->getChunkedPreference(
            $webPreferences,
            static::QUICK_MENU_PREF_ITEMS,
            static::QUICK_MENU_PREF_ITEMS_CHUNK_PREFIX,
            '[]'
        );
    }

    /**
     * Read a long preference value from chunks with legacy single-value fallback
     *
     * @param array  $webPreferences
     * @param string $legacyKey
     * @param string $chunkPrefix
     * @param string $default
     *
     * @return string
     */
    /** @param array<string,mixed> $webPreferences */
    protected function getChunkedPreference(
        array $webPreferences,
        string $legacyKey,
        string $chunkPrefix,
        string $default
    ): string {
        $chunks = [];

        foreach ($webPreferences as $key => $value) {
            if (strpos($key, $chunkPrefix) === 0) {
                $chunks[$key] = $this->stringValue($value);
            }
        }

        if (! empty($chunks)) {
            ksort($chunks);
            return implode('', $chunks);
        }

        return $this->stringValue($webPreferences[$legacyKey] ?? $default);
    }

    /**
     * Create the current user's preference store when a persistent resource is configured
     *
     * @return PreferencesStore|null
     */
    protected function createPreferencesStore(): ?PreferencesStore
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
        ]), $this->getAuthenticatedUser());
    }

    /**
     * Normalize quick menu link list
     *
     * @param array $items
     *
     * @return array
     */
    /**
     * @param array<int,mixed> $items
     * @return list<array{label:string,url:string}>
     */
    protected function sanitizeQuickMenuItems(array $items): array
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
    protected function sanitizeQuickMenuNote(mixed $note): string
    {
        return mb_substr(trim($this->stringValue($note)), 0, static::QUICK_MENU_MAX_NOTE_LENGTH);
    }

    /**
     * Normalize and validate a quick menu URL
     *
     * @param string $url
     *
     * @return string
     */
    protected function normalizeQuickMenuUrl(string $url): string
    {
        $url = preg_replace('/\s+/', '', trim($url)) ?? '';
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
    /** @param array<string,mixed> $payload */
    protected function respondWithJson(array $payload, int $statusCode = 200): void
    {
        $this->getResponse()
            ->setHttpResponseCode((int) $statusCode)
            ->setHeader('Content-Type', 'application/json; charset=utf-8', true)
            ->setBody(Json::sanitize($payload));
    }

    protected function getAuthenticatedUser(): User
    {
        $user = $this->Auth()->getUser();
        if ($user === null) {
            throw new ProgrammingError('This operation requires an authenticated user');
        }

        return $user;
    }

    protected function stringValue(mixed $value): string
    {
        return is_scalar($value) || $value instanceof \Stringable ? (string) $value : '';
    }
}
