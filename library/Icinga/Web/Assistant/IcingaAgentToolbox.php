<?php

// SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

namespace Icinga\Web\Assistant;

use Icinga\Application\Icinga;
use Icinga\Module\Icingadb\Common\Auth;
use Icinga\Module\Icingadb\Common\Database;
use Icinga\Module\Icingadb\Model\History;
use Icinga\Module\Icingadb\Model\Host;
use Icinga\Module\Icingadb\Model\HoststateSummary;
use Icinga\Module\Icingadb\Model\Service;
use Icinga\Module\Icingadb\Model\ServicestateSummary;
use Icinga\Web\Url;
use Icinga\Web\Widget\Dashboard;
use ipl\Stdlib\Filter;

class IcingaAgentToolbox
{
    use Auth;
    use Database;

    /** @var int */
    private $itemLimit = 8;

    public function isAvailable()
    {
        return Icinga::app()->getModuleManager()->hasEnabled('icingadb');
    }

    /**
     * Build a read-only, sanitized data snapshot for the assistant.
     *
     * @param array<string, mixed> $intent
     *
     * @return array<string, mixed>
     */
    public function inspect($message, array $intent, array $options = [])
    {
        if (! $this->isAvailable()) {
            return [
                'available' => false,
                'reason' => 'icingadb-disabled',
                'scope' => [],
                'summaries' => [],
                'items' => [],
            ];
        }

        $scope = $this->allowedScope();
        $summaries = [];
        $items = [];
        $dashboards = [];
        $history = [];

        $target = isset($intent['target']) ? (string) $intent['target'] : null;
        $state = isset($intent['state']) ? (string) $intent['state'] : null;
        $query = isset($intent['query']) ? (string) $intent['query'] : '';
        $routePath = isset($intent['routePath']) ? (string) $intent['routePath'] : '';
        $routeParams = isset($intent['routeParams']) && is_array($intent['routeParams'])
            ? $intent['routeParams']
            : [];
        $normalizedMessage = mb_strtolower(trim((string) $message), 'UTF-8');
        $wantsHistory = $this->isHistoryIntent($normalizedMessage) || $routePath === 'icingadb/history';
        $wantsDashboard = $this->isDashboardIntent($normalizedMessage) || $routePath === 'dashboard';
        $fetchSummaries = array_key_exists('fetchSummaries', $options) ? (bool) $options['fetchSummaries'] : true;
        $fetchItems = array_key_exists('fetchItems', $options) ? (bool) $options['fetchItems'] : true;
        $fetchHistory = array_key_exists('fetchHistory', $options) ? (bool) $options['fetchHistory'] : $wantsHistory;
        $fetchDashboards = array_key_exists('fetchDashboards', $options) ? (bool) $options['fetchDashboards'] : $wantsDashboard;
        $fetchDashboardDraft = array_key_exists('fetchDashboardDraft', $options) ? (bool) $options['fetchDashboardDraft'] : $wantsDashboard;

        if ($fetchSummaries) {
            try {
                $summaries = [
                    'hosts' => $this->fetchHostSummary(),
                    'services' => $this->fetchServiceSummary(),
                ];
            } catch (\Throwable $e) {
                $summaries = [];
            }
        }

        if ($fetchItems) {
            try {
                if ($wantsHistory) {
                    $items = [];
                } elseif ($target === 'host') {
                    $items['hosts'] = $this->fetchHosts($message, $query, $state, $routeParams);
                } elseif ($target === 'service') {
                    $items['services'] = $this->fetchServices($message, $query, $state, $routeParams);
                } elseif ($query !== '' || $state !== null) {
                    $items['hosts'] = $this->fetchHosts($message, $query, $state, $routeParams, 4);
                    $items['services'] = $this->fetchServices($message, $query, $state, $routeParams, 4);
                }
            } catch (\Throwable $e) {
                $items = [];
            }
        }

        if ($fetchHistory) {
            try {
                if ($wantsHistory) {
                    $history = $this->fetchHistory($target, $state);
                }
            } catch (\Throwable $e) {
                $history = [];
            }
        }

        if ($fetchDashboards) {
            try {
                if ($wantsDashboard) {
                    $dashboards = $this->listDashboards();
                }
            } catch (\Throwable $e) {
                $dashboards = [];
            }
        }

        $dashboardDraft = $fetchDashboardDraft && $wantsDashboard ? $this->buildDashboardDraft($message, $intent) : null;

        return [
            'available' => true,
            'scope' => $scope,
            'summaries' => $summaries,
            'items' => $items,
            'history' => $history,
            'dashboards' => $dashboards,
            'dashboardDraft' => $dashboardDraft,
        ];
    }

    /**
     * @return array<int, string>
     */
    public function allowedScope()
    {
        return [
            'host names and display names',
            'service names and display names',
            'service to host mapping',
            'current host and service states',
            'recent event history without raw outputs',
            'problem, acknowledgement, handled and downtime flags',
            'last state change timestamps',
            'aggregated host and service state counts',
            'current dashboard pane names and dashlet titles',
            'dashboard draft links that point to internal Icinga views',
            'enabled module names and reporting builder options',
        ];
    }

    /**
     * @return array<string, int>
     */
    private function fetchHostSummary()
    {
        $query = HoststateSummary::on($this->getDb());
        $this->applyRestrictions($query);
        $summary = $query->first();

        return [
            'total' => (int) ($summary->hosts_total ?? 0),
            'up' => (int) ($summary->hosts_up ?? 0),
            'down_unhandled' => (int) ($summary->hosts_down_unhandled ?? 0),
            'down_handled' => (int) ($summary->hosts_down_handled ?? 0),
            'pending' => (int) ($summary->hosts_pending ?? 0),
            'problems_unacknowledged' => (int) ($summary->hosts_problems_unacknowledged ?? 0),
            'acknowledged' => (int) ($summary->hosts_acknowledged ?? 0),
        ];
    }

    /**
     * @return array<string, int>
     */
    private function fetchServiceSummary()
    {
        $query = ServicestateSummary::on($this->getDb());
        $this->applyRestrictions($query);
        $summary = $query->first();

        return [
            'total' => (int) ($summary->services_total ?? 0),
            'ok' => (int) ($summary->services_ok ?? 0),
            'warning_unhandled' => (int) ($summary->services_warning_unhandled ?? 0),
            'warning_handled' => (int) ($summary->services_warning_handled ?? 0),
            'critical_unhandled' => (int) ($summary->services_critical_unhandled ?? 0),
            'critical_handled' => (int) ($summary->services_critical_handled ?? 0),
            'unknown_unhandled' => (int) ($summary->services_unknown_unhandled ?? 0),
            'unknown_handled' => (int) ($summary->services_unknown_handled ?? 0),
            'pending' => (int) ($summary->services_pending ?? 0),
            'problems_unacknowledged' => (int) ($summary->services_problems_unacknowledged ?? 0),
            'acknowledged' => (int) ($summary->services_acknowledged ?? 0),
        ];
    }

    /**
     * @param array<string, mixed> $routeParams
     *
     * @return array<int, array<string, mixed>>
     */
    private function fetchHosts($message, $query, $state, array $routeParams, $limit = null)
    {
        $hosts = Host::on($this->getDb())->with(['state']);
        $hosts->getWith()['host.state']->setJoinType('INNER');
        $this->applyRestrictions($hosts);
        $this->applyHostFilters($hosts, $message, $query, $state, $routeParams);
        $hosts->orderBy('host.state.severity', SORT_DESC);
        $hosts->orderBy('host.state.last_state_change', SORT_DESC);
        $hosts->orderBy('host.display_name', SORT_ASC);
        $hosts->limit((int) ($limit ?: $this->itemLimit));

        $items = [];
        foreach ($hosts->execute() as $host) {
            $items[] = [
                'name' => (string) $host->name,
                'display_name' => (string) ($host->display_name ?: $host->name),
                'state' => strtolower((string) $host->state->getStateText()),
                'is_problem' => (bool) $host->state->is_problem,
                'is_acknowledged' => (bool) $host->state->is_acknowledged,
                'in_downtime' => (bool) $host->state->in_downtime,
                'is_handled' => (bool) $host->state->is_handled,
                'last_state_change' => $this->stringifyDate($host->state->last_state_change),
            ];
        }

        return $items;
    }

    /**
     * @param array<string, mixed> $routeParams
     *
     * @return array<int, array<string, mixed>>
     */
    private function fetchServices($message, $query, $state, array $routeParams, $limit = null)
    {
        $services = Service::on($this->getDb())->with(['state', 'host']);
        $services->getWith()['service.state']->setJoinType('INNER');
        $this->applyRestrictions($services);
        $this->applyServiceFilters($services, $message, $query, $state, $routeParams);
        $services->orderBy('service.state.severity', SORT_DESC);
        $services->orderBy('service.state.last_state_change', SORT_DESC);
        $services->orderBy('host.display_name', SORT_ASC);
        $services->orderBy('service.display_name', SORT_ASC);
        $services->limit((int) ($limit ?: $this->itemLimit));

        $items = [];
        foreach ($services->execute() as $service) {
            $items[] = [
                'name' => (string) $service->name,
                'display_name' => (string) ($service->display_name ?: $service->name),
                'host_name' => $service->host ? (string) ($service->host->display_name ?: $service->host->name) : null,
                'state' => strtolower((string) $service->state->getStateText()),
                'is_problem' => (bool) $service->state->is_problem,
                'is_acknowledged' => (bool) $service->state->is_acknowledged,
                'in_downtime' => (bool) $service->state->in_downtime,
                'is_handled' => (bool) $service->state->is_handled,
                'last_state_change' => $this->stringifyDate($service->state->last_state_change),
            ];
        }

        return $items;
    }

    /**
     * @param ?string $target
     * @param ?string $state
     *
     * @return array<int, array<string, mixed>>
     */
    private function fetchHistory($target = null, $state = null)
    {
        $history = History::on($this->getDb())->with([
            'host',
            'service',
            'state'
        ]);

        $this->applyRestrictions($history);
        $history->getWith()['history.host']->setJoinType('LEFT');
        $history->filter(Filter::any(
            Filter::like('host.id', '*'),
            Filter::like('service.id', '*')
        ));

        if ($target === 'host') {
            $history->filter(Filter::equal('history.object_type', 'host'));
        } elseif ($target === 'service') {
            $history->filter(Filter::equal('history.object_type', 'service'));
        }

        if ($state !== null && in_array($state, ['critical', 'warning', 'unknown', 'up', 'down'], true)) {
            $stateMap = [
                'up' => 0,
                'down' => 1,
                'warning' => 1,
                'critical' => 2,
                'unknown' => 3,
            ];
            if (isset($stateMap[$state])) {
                $history->filter(Filter::equal('state.soft_state', $stateMap[$state]));
            }
        }

        $history->orderBy('history.event_time', SORT_DESC);
        $history->orderBy('history.event_type', SORT_DESC);
        $history->limit(10);

        $items = [];
        foreach ($history->execute() as $entry) {
            $items[] = [
                'event_time' => $this->stringifyDate($entry->event_time),
                'event_type' => (string) $entry->event_type,
                'object_type' => (string) $entry->object_type,
                'host_name' => $entry->host ? (string) ($entry->host->display_name ?: $entry->host->name) : null,
                'service_name' => $entry->service ? (string) ($entry->service->display_name ?: $entry->service->name) : null,
                'state' => $entry->state ? (int) $entry->state->soft_state : null,
            ];
        }

        return $items;
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function listDashboards()
    {
        $dashboard = new Dashboard();
        $dashboard->setUser($this->getAuth()->getUser());
        $dashboard->load();

        $items = [];
        foreach ($dashboard->getPanes() as $pane) {
            $dashlets = [];
            foreach ($pane->getDashlets() as $dashlet) {
                if ($dashlet->getDisabled()) {
                    continue;
                }

                $dashlets[] = [
                    'title' => (string) $dashlet->getTitle(),
                    'url' => $dashlet->getUrl() ? $dashlet->getUrl()->getRelativeUrl() : null,
                ];
            }

            $items[] = [
                'name' => (string) $pane->getName(),
                'title' => (string) $pane->getTitle(),
                'dashlet_count' => count($dashlets),
                'dashlets' => $dashlets,
            ];
        }

        return $items;
    }

    /**
     * @param string $message
     * @param array<string, mixed> $intent
     *
     * @return ?array<string, string>
     */
    private function buildDashboardDraft($message, array $intent)
    {
        $draftRoute = $this->resolveDashboardSourceRoute($intent, $message);
        if ($draftRoute === null) {
            return null;
        }

        $routePath = $draftRoute['path'];
        $routeParams = $draftRoute['params'];
        $target = isset($intent['target']) ? (string) $intent['target'] : '';
        $state = isset($intent['state']) ? (string) $intent['state'] : '';

        $paneTitle = $this->buildDashboardPaneTitle($message, $target, $state);
        $dashletTitle = $this->buildDashboardDashletTitle($message, $target, $state);
        $dashletUrl = Url::fromPath($routePath, $routeParams)->getRelativeUrl();

        $draftParams = [
            'create_new_pane' => 1,
            'pane' => $paneTitle,
            'dashlet' => $dashletTitle,
            'url' => rawurlencode($dashletUrl),
        ];

        return [
            'pane' => $paneTitle,
            'dashlet' => $dashletTitle,
            'sourceUrl' => $dashletUrl,
            'draftPath' => 'dashboard/new-dashlet',
            'draftParams' => $draftParams,
        ];
    }

    /**
     * @param array<string, mixed> $intent
     * @param string $message
     *
     * @return ?array{path:string,params:array<string,mixed>}
     */
    private function resolveDashboardSourceRoute(array $intent, $message = '')
    {
        $routePath = isset($intent['routePath']) ? (string) $intent['routePath'] : '';
        $routeParams = isset($intent['routeParams']) && is_array($intent['routeParams'])
            ? $intent['routeParams']
            : [];
        $target = isset($intent['target']) ? (string) $intent['target'] : '';
        $state = isset($intent['state']) ? (string) $intent['state'] : '';
        $normalizedMessage = mb_strtolower(trim((string) $message), 'UTF-8');
        $hasProblemIntent = $this->containsProblemIntent($normalizedMessage);

        if ($routePath !== '' && $routePath !== 'dashboard') {
            return [
                'path' => $routePath,
                'params' => $routeParams,
            ];
        }

        if ($target === 'host') {
            if (in_array($state, ['down', 'problem', 'critical'], true) || $hasProblemIntent) {
                return [
                    'path' => 'icingadb/hosts',
                    'params' => ['host.state.is_problem' => 'y'],
                ];
            }

            return [
                'path' => 'icingadb/hosts',
                'params' => [],
            ];
        }

        if ($target === 'service' || in_array($state, ['critical', 'warning', 'unknown', 'problem'], true)) {
            $params = [];
            if (in_array($state, ['critical', 'warning', 'unknown', 'problem'], true)) {
                $params['service.state.is_problem'] = 'y';
            }

            return [
                'path' => 'icingadb/services',
                'params' => $params,
            ];
        }

        if ($routePath === 'dashboard') {
            return [
                'path' => 'icingadb/services',
                'params' => [],
            ];
        }

        return null;
    }

    /**
     * @param \ipl\Orm\Query $query
     * @param array<string, mixed> $routeParams
     *
     * @return void
     */
    private function applyHostFilters($query, $message, $search, $state, array $routeParams)
    {
        if (isset($routeParams['host.state.is_problem']) && $routeParams['host.state.is_problem'] === 'y') {
            $query->filter(Filter::equal('host.state.is_problem', 'y'));
        }

        switch ($state) {
            case 'up':
                $query->filter(Filter::equal('host.state.soft_state', 0));
                break;
            case 'down':
            case 'critical':
            case 'problem':
                $query->filter(Filter::equal('host.state.is_problem', 'y'));
                break;
            case 'pending':
                $query->filter(Filter::equal('host.state.soft_state', 99));
                break;
        }

        $this->applyTextTokens($query, $this->extractSearchTokens($search !== '' ? $search : $message), [
            'host.name',
            'host.display_name',
        ]);
    }

    /**
     * @param \ipl\Orm\Query $query
     * @param array<string, mixed> $routeParams
     *
     * @return void
     */
    private function applyServiceFilters($query, $message, $search, $state, array $routeParams)
    {
        if (
            (isset($routeParams['problems']) && $routeParams['problems'])
            || (isset($routeParams['service.state.is_problem']) && $routeParams['service.state.is_problem'] === 'y')
        ) {
            $query->filter(Filter::equal('service.state.is_problem', 'y'));
        }

        switch ($state) {
            case 'up':
                $query->filter(Filter::equal('service.state.soft_state', 0));
                break;
            case 'warning':
                $query->filter(Filter::equal('service.state.soft_state', 1));
                break;
            case 'critical':
                $query->filter(Filter::equal('service.state.soft_state', 2));
                break;
            case 'unknown':
                $query->filter(Filter::equal('service.state.soft_state', 3));
                break;
            case 'problem':
            case 'down':
                $query->filter(Filter::equal('service.state.is_problem', 'y'));
                break;
            case 'pending':
                $query->filter(Filter::equal('service.state.soft_state', 99));
                break;
        }

        $this->applyTextTokens($query, $this->extractSearchTokens($search !== '' ? $search : $message), [
            'service.name',
            'service.display_name',
            'host.name',
            'host.display_name',
        ]);
    }

    /**
     * @param \ipl\Orm\Query $query
     * @param array<int, string> $tokens
     * @param array<int, string> $columns
     *
     * @return void
     */
    private function applyTextTokens($query, array $tokens, array $columns)
    {
        if (empty($tokens)) {
            return;
        }

        foreach ($tokens as $token) {
            $matchAnyColumn = Filter::any();
            foreach ($columns as $column) {
                $matchAnyColumn->add(Filter::like($column, '*' . $token . '*')->ignoreCase());
            }

            $query->filter($matchAnyColumn);
        }
    }

    /**
     * @param string $text
     *
     * @return array<int, string>
     */
    private function extractSearchTokens($text)
    {
        $text = strtolower(trim((string) $text));
        if ($text === '') {
            return [];
        }

        $text = preg_replace('/[^\p{L}\p{N}\s_-]+/u', ' ', $text);
        $parts = preg_split('/\s+/', (string) $text, -1, PREG_SPLIT_NO_EMPTY);
        $stopWords = [
            'czy', 'dla', 'host', 'hosty', 'hostow', 'hostów', 'serwis', 'serwisy', 'serwisow', 'serwisów',
            'problem', 'problemy', 'status', 'stanie', 'jakis', 'jakiś', 'pokaz', 'pokaż', 'raport',
            'report', 'ustaw', 'open', 'result', 'results', 'critical', 'warning', 'unknown', 'up', 'down'
        ];

        $tokens = [];
        foreach ($parts as $part) {
            if (mb_strlen($part) < 2 || in_array($part, $stopWords, true)) {
                continue;
            }

            $tokens[] = $part;
        }

        return array_values(array_unique($tokens));
    }

    /**
     * @param string $normalizedMessage
     *
     * @return bool
     */
    private function isHistoryIntent($normalizedMessage)
    {
        foreach (['historia', 'historie', 'history', 'zdarzen', 'zdarzenia', 'event', 'events'] as $token) {
            if (mb_strpos($normalizedMessage, $token) !== false) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param string $normalizedMessage
     *
     * @return bool
     */
    private function isDashboardIntent($normalizedMessage)
    {
        foreach (['dashboard', 'dashlet', 'pulpit', 'panel'] as $token) {
            if (mb_strpos($normalizedMessage, $token) !== false) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param string $message
     * @param string $target
     * @param string $state
     *
     * @return string
     */
    private function buildDashboardPaneTitle($message, $target, $state)
    {
        $base = $this->buildDashboardNameFromPrompt($message, $target, $state);
        if ($base === '') {
            return 'AI Dashboard - ' . date('Y-m-d');
        }

        return $base . ' - ' . date('Y-m-d');
    }

    /**
     * @param string $message
     * @param string $target
     * @param string $state
     *
     * @return string
     */
    private function buildDashboardDashletTitle($message, $target, $state)
    {
        $base = $this->buildDashboardNameFromPrompt($message, $target, $state);

        if ($base !== '') {
            return $base;
        }

        if ($target !== '' && $state !== '') {
            return ucfirst($target) . ' - ' . ucfirst($state);
        }

        if ($target !== '') {
            return ucfirst($target) . ' overview';
        }

        $message = trim($message);
        if ($message === '') {
            return 'AI Dashlet';
        }

        return mb_strlen($message) > 48
            ? trim(mb_substr($message, 0, 48)) . '...'
            : $message;
    }

    /**
     * @param string $message
     * @param string $target
     * @param string $state
     *
     * @return string
     */
    private function buildDashboardNameFromPrompt($message, $target, $state)
    {
        $normalized = mb_strtolower(trim((string) $message), 'UTF-8');
        if ($normalized === '') {
            return '';
        }

        $patterns = [
            '/\bzrob\b/u',
            '/\bstworz\b/u',
            '/\bstwórz\b/u',
            '/\butworz\b/u',
            '/\butwórz\b/u',
            '/\bdodaj\b/u',
            '/\bprzygotuj\b/u',
            '/\bpokaz\b/u',
            '/\bpokaż\b/u',
            '/\bwyswietl\b/u',
            '/\bwyświetl\b/u',
            '/\botworz\b/u',
            '/\botwórz\b/u',
            '/\bdashboard\b/u',
            '/\bdashlet\b/u',
            '/\bpanel\b/u',
            '/\bkokpit\b/u',
            '/\bdla\b/u',
            '/\bze?\b/u',
            '/\bna\b/u',
        ];

        $clean = preg_replace($patterns, ' ', $normalized);
        $clean = preg_replace('/[^\p{L}\p{N}\s_-]+/u', ' ', (string) $clean);
        $clean = preg_replace('/\s+/u', ' ', (string) $clean);
        $clean = trim((string) $clean);

        $replacements = [
            'krytycznymi serwisami' => 'Krytyczne serwisy',
            'krytyczne serwisy' => 'Krytyczne serwisy',
            'serwisy krytyczne' => 'Krytyczne serwisy',
            'hosty z problemami' => 'Hosty z problemami',
            'problemy hostow' => 'Problemy hostów',
            'problemy hostów' => 'Problemy hostów',
            'historia zdarzen' => 'Historia zdarzeń',
            'historia zdarzeń' => 'Historia zdarzeń',
            'zdarzenia krytyczne' => 'Krytyczne zdarzenia',
        ];

        if (isset($replacements[$clean])) {
            return $replacements[$clean];
        }

        $baseTitle = $this->buildDashboardBaseTitle($clean, $target, $state);
        $contextSuffix = $this->buildDashboardContextSuffix($clean);

        if ($baseTitle !== '') {
            if ($contextSuffix !== '') {
                $title = $baseTitle . ' ' . $contextSuffix;
            } else {
                $title = $baseTitle;
            }

            return mb_strlen($title) > 42
                ? trim(mb_substr($title, 0, 42)) . '...'
                : $title;
        }

        if ($clean === '') {
            if ($target === 'service' && $state === 'critical') {
                return 'Krytyczne serwisy';
            }

            if ($target === 'host' && ($state === 'down' || $state === 'problem' || $state === 'critical')) {
                return 'Hosty z problemami';
            }

            if ($target === 'service') {
                return 'Serwisy';
            }

            if ($target === 'host') {
                return 'Hosty';
            }

            return '';
        }

        $words = preg_split('/\s+/u', $clean, -1, PREG_SPLIT_NO_EMPTY);
        $stopWords = [
            'i', 'oraz', 'w', 'we', 'z', 'ze', 'na', 'dla', 'do', 'po', 'od', 'czy',
            'ostatnich', 'ostatnie', 'ostatni', 'jakis', 'jakiś'
        ];

        $filtered = [];
        foreach ($words as $word) {
            if (in_array($word, $stopWords, true)) {
                continue;
            }

            $filtered[] = $word;
        }

        if (empty($filtered)) {
            $filtered = $words ?: [];
        }

        $title = implode(' ', array_slice($filtered, 0, 5));
        $title = mb_convert_case($title, MB_CASE_TITLE, 'UTF-8');

        if ($title === '') {
            return '';
        }

        return mb_strlen($title) > 42
            ? trim(mb_substr($title, 0, 42)) . '...'
            : $title;
    }

    /**
     * @param string $clean
     * @param string $target
     * @param string $state
     *
     * @return string
     */
    private function buildDashboardBaseTitle($clean, $target, $state)
    {
        if ($target === 'service' && $state === 'critical') {
            return 'Krytyczne serwisy';
        }

        if ($target === 'service' && $state === 'warning') {
            return 'Serwisy w warning';
        }

        if ($target === 'service' && ($state === 'problem' || strpos($clean, 'problem') !== false)) {
            return 'Serwisy z problemami';
        }

        if ($target === 'host' && ($state === 'down' || $state === 'problem' || $state === 'critical' || strpos($clean, 'problem') !== false)) {
            return 'Hosty z problemami';
        }

        if (strpos($clean, 'historia zdarzen') !== false || strpos($clean, 'historia zdarzeń') !== false) {
            return 'Historia zdarzeń';
        }

        if (strpos($clean, 'zdarzenia') !== false && $state === 'critical') {
            return 'Krytyczne zdarzenia';
        }

        if ($target === 'service') {
            return 'Serwisy';
        }

        if ($target === 'host') {
            return 'Hosty';
        }

        return '';
    }

    /**
     * @param string $clean
     *
     * @return string
     */
    private function buildDashboardContextSuffix($clean)
    {
        if ($clean === '') {
            return '';
        }

        $parts = preg_split('/\s+/u', $clean, -1, PREG_SPLIT_NO_EMPTY);
        $stopWords = [
            'i', 'oraz', 'w', 'we', 'z', 'ze', 'na', 'dla', 'do', 'po', 'od', 'czy',
            'ostatnich', 'ostatnie', 'ostatni', 'jakis', 'jakiś',
            'host', 'hosty', 'hostow', 'hostów', 'hostami',
            'serwis', 'serwisy', 'serwisow', 'serwisów', 'serwisami',
            'problem', 'problemy', 'problemami', 'problemach',
            'krytyczne', 'krytyczny', 'krytycznymi',
            'warning', 'unknown', 'down', 'up',
            'historia', 'zdarzen', 'zdarzeń', 'zdarzenia',
            'dashboard', 'dashlet', 'panel', 'kokpit'
        ];

        $suffixTokens = [];
        foreach ($parts as $part) {
            if (in_array($part, $stopWords, true)) {
                continue;
            }

            if (mb_strlen($part) < 2) {
                continue;
            }

            $suffixTokens[] = $part;
        }

        $suffixTokens = array_values(array_unique($suffixTokens));
        if (empty($suffixTokens)) {
            return '';
        }

        $normalized = [];
        foreach (array_slice($suffixTokens, 0, 3) as $token) {
            $normalized[] = $this->normalizeDashboardContextToken($token);
        }

        $suffix = trim(implode(' ', array_filter($normalized)));

        return $suffix;
    }

    /**
     * @param string $token
     *
     * @return string
     */
    private function normalizeDashboardContextToken($token)
    {
        $token = trim((string) $token);
        if ($token === '') {
            return '';
        }

        $map = [
            'db' => 'DB',
            'database' => 'DB',
            'sql' => 'SQL',
            'mysql' => 'MySQL',
            'postgres' => 'Postgres',
            'postgresql' => 'PostgreSQL',
            'api' => 'API',
            'prod' => 'PROD',
            'prd' => 'PROD',
            'dev' => 'DEV',
            'test' => 'TEST',
            'qa' => 'QA',
            'uat' => 'UAT',
            'k8s' => 'K8s',
            'kubernetes' => 'Kubernetes',
            'linux' => 'Linux',
            'windows' => 'Windows',
            'vm' => 'VM',
            'smtp' => 'SMTP',
            'http' => 'HTTP',
            'https' => 'HTTPS',
            'ssh' => 'SSH',
            'dns' => 'DNS',
            'vpn' => 'VPN',
            'cpu' => 'CPU',
            'ram' => 'RAM',
            'disk' => 'Disk',
        ];

        $folded = mb_strtolower($token, 'UTF-8');

        if (isset($map[$folded])) {
            return $map[$folded];
        }

        return mb_convert_case($token, MB_CASE_TITLE, 'UTF-8');
    }

    /**
     * @param string $normalizedMessage
     *
     * @return bool
     */
    private function containsProblemIntent($normalizedMessage)
    {
        if ($normalizedMessage === '') {
            return false;
        }

        foreach ([
            'problem',
            'problemy',
            'problemami',
            'problemach',
            'awaria',
            'awarie',
            'krytyczne',
            'krytyczny',
            'krytycznymi',
            'down',
            'blad',
            'błąd'
        ] as $token) {
            if (mb_strpos($normalizedMessage, $token) !== false) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param mixed $value
     *
     * @return ?string
     */
    private function stringifyDate($value)
    {
        if ($value instanceof \DateTimeInterface) {
            return $value->format(DATE_ATOM);
        }

        if ($value === null || $value === '') {
            return null;
        }

        return (string) $value;
    }
}
