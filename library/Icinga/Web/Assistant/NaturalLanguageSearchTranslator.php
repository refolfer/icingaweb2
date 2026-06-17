<?php

// SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

namespace Icinga\Web\Assistant;

use Icinga\Exception\IcingaException;

/**
 * Translate natural language into a search intent that the existing search UI can handle.
 *
 * This prefers a real LLM when configured and falls back to deterministic parsing otherwise.
 */
class NaturalLanguageSearchTranslator
{
    /**
     * @var OpenAiCompatibleClient
     */
    private $client;

    /**
     * @var array<string, string>
     */
    private $targetWords = [
        'host' => 'host',
        'hosts' => 'host',
        'hosty' => 'host',
        'serwer' => 'host',
        'serwery' => 'host',
        'hostgroup' => 'hostgroup',
        'hostgroupy' => 'hostgroup',
        'hostgrupa' => 'hostgroup',
        'hostgrupy' => 'hostgroup',
        'hostow' => 'host',
        'service' => 'service',
        'services' => 'service',
        'serwis' => 'service',
        'serwisy' => 'service',
        'servicegroup' => 'servicegroup',
        'servicegroupy' => 'servicegroup',
        'servicegrupa' => 'servicegroup',
        'servicegrupy' => 'servicegroup',
        'serwisow' => 'service',
    ];

    /**
     * @var array<string, string>
     */
    private $stateWords = [
        'up' => 'up',
        'online' => 'up',
        'ok' => 'up',
        'dziala' => 'up',
        'działa' => 'up',
        'alive' => 'up',
        'running' => 'up',
        'down' => 'down',
        'offline' => 'down',
        'awaria' => 'down',
        'blad' => 'down',
        'błąd' => 'down',
        'critical' => 'critical',
        'crit' => 'critical',
        'krytyczne' => 'critical',
        'krytyczny' => 'critical',
        'krytyczna' => 'critical',
        'krytycznym' => 'critical',
        'warning' => 'warning',
        'warn' => 'warning',
        'ostrzezenie' => 'warning',
        'ostrzeżenie' => 'warning',
        'unknown' => 'unknown',
        'nieznane' => 'unknown',
        'pending' => 'pending',
        'oczekujace' => 'pending',
        'oczekujące' => 'pending',
        'problem' => 'problem',
        'problemy' => 'problem',
    ];

    /**
     * @var array<int, string>
     */
    private $problemWords = [
        'problem',
        'problemy',
        'problemach',
        'problemami',
        'problemem',
        'problemow',
        'awaria',
        'awarie',
        'krytyczne',
        'krytyczny',
        'critical',
        'crit',
        'down',
        'offline',
        'błąd',
        'blad',
        'zawieszone',
        'niedostępne',
        'niedostepne',
    ];

    /**
     * @var array<int, string>
     */
    private $stopWords = [
        'czy', 'daj', 'dla', 'do', 'gdzie', 'go', 'jak', 'jaki', 'jakie', 'jakich',
        'mi', 'na', 'o', 'od', 'oraz', 'pod', 'po', 'pokaz', 'pokaż', 'proszę',
        'prosze', 'przez', 'sie', 'się', 'ten', 'tego', 'tej', 'to', 'w', 'we',
        'z', 'za', 'znajdz', 'znajdź', 'wyszukaj', 'jak', 'and', 'or', 'the',
        'a', 'an', 'in', 'on', 'of', 'for', 'with', 'show', 'find', 'search',
        'look', 'please', 'all', 'every'
    ];

    /**
     * @param ?OpenAiCompatibleClient $client
     */
    public function __construct(?OpenAiCompatibleClient $client = null)
    {
        $this->client = $client ?: new OpenAiCompatibleClient();
    }

    /**
     * Translate a free-form message into a compact search intent.
     *
     * @param string $message
     *
     * @return array{
     *     reply: string,
     *     query: ?string,
     *     routePath: ?string,
     *     routeParams: array<string, mixed>,
     *     mode: string,
     *     actions: array<int, array<string, mixed>>,
     *     reportUrl: ?string,
     *     chart: ?array<string, mixed>,
     *     followUps: array<int, mixed>,
     *     target: ?string,
     *     state: ?string,
     *     confidence: string,
     *     tokens: array<int, string>,
     *     source: string
     * }
     */
    public function translate($message, array $context = [])
    {
        $message = trim((string) $message);
        if ($message === '') {
            return $this->emptyResult();
        }

        try {
            if ($this->client->isConfigured()) {
                $result = $this->fromLlm($message, $context);
                if ($result !== null) {
                    return $result;
                }
            }
        } catch (IcingaException $e) {
            // Fall back to deterministic parsing.
        }

        return $this->fromRules($message, $context);
    }

    /**
     * @return array<string, mixed>
     */
    private function emptyResult()
    {
        return [
            'reply'      => 'Napisz, czego szukasz, na przykład: hosty prod, serwisy krytyczne albo hosty z awarią.',
            'query'      => null,
            'routePath'  => null,
            'routeParams'=> [],
            'mode'       => 'answer',
            'actions'    => [],
            'reportUrl'  => null,
            'chart'      => null,
            'followUps'  => [],
            'target'     => null,
            'state'      => null,
            'confidence' => 'low',
            'tokens'     => [],
            'source'     => 'local',
        ];
    }

    /**
     * @param string $message
     *
     * @return array<string, mixed>|null
     */
    private function fromLlm($message, array $context = [])
    {
        $result = $this->client->interpret($message, $this->buildContext($message, $context));
        $normalized = $this->normalizeResult($result, $message, $context);
        if ($normalized !== null) {
            $normalized['source'] = 'llm';
        }

        return $normalized;
    }

    /**
     * @param string $message
     *
     * @return array<string, mixed>
     */
    private function fromRules($message, array $context = [])
    {
        $normalized = $this->normalize($message);
        $target = $this->detectTarget($normalized);
        $state = $this->detectState($normalized);
        $route = $this->buildRouteIntent($normalized, $target, $state);
        $tokens = $route !== null
            ? []
            : $this->extractTokens($message, $normalized, $target, $state);
        $query = $route !== null ? null : $this->buildQuery($tokens, $target, $state);
        $confidence = $this->confidence($target, $state, $tokens, $query);
        $mode = $this->detectMode($normalized, $route !== null, $query !== null);
        if ($mode !== 'chart' && $this->isReportConversation($normalized, $context)) {
            $mode = 'report';
        }
        $reportUrl = $this->buildReportUrl($mode, $route, $context, $message, $target, $state);
        $reply = $this->buildReply($message, $query, $target, $state, $tokens, $route, $mode);

        return [
            'reply'      => $reply,
            'query'      => $query ?: null,
            'routePath'  => $route !== null ? $route['path'] : null,
            'routeParams'=> $route !== null ? $route['params'] : [],
            'mode'       => $mode,
            'actions'    => $this->buildActions($route, $query, $reportUrl),
            'reportUrl'  => $reportUrl,
            'chart'      => null,
            'followUps'  => $this->buildFollowUps($normalized, $target, $state, $query, $route, $context),
            'target'     => $target,
            'state'      => $state,
            'confidence' => $confidence,
            'tokens'     => $tokens,
            'source'     => 'local',
        ];
    }

    /**
     * @param string $message
     *
     * @return array<string, string>
     */
    private function buildContext($message, array $context = [])
    {
        $result = [];
        $normalized = $this->normalize($message);

        if (($target = $this->detectTarget($normalized)) !== null) {
            $result['target_hint'] = $target;
        }
        if (($state = $this->detectState($normalized)) !== null) {
            $result['state_hint'] = $state;
        }

        if (! empty($context['capabilities'])) {
            $result['capabilities'] = $context['capabilities'];
        }

        if (! empty($context['history']) && is_array($context['history'])) {
            $result['history'] = $context['history'];
        }

        return $result;
    }

    /**
     * @param array<string, mixed> $result
     * @param string $message
     *
     * @return array<string, mixed>|null
     */
    private function normalizeResult(array $result, $message, array $context = [])
    {
        $normalizedMessage = $this->normalize($message);
        $reply = isset($result['reply']) ? trim((string) $result['reply']) : '';
        $query = isset($result['query']) ? trim((string) $result['query']) : '';
        $routePath = isset($result['routePath']) ? trim((string) $result['routePath']) : '';
        $routeParams = isset($result['routeParams']) && is_array($result['routeParams']) ? $result['routeParams'] : [];
        $target = isset($result['target']) ? $this->normalizeNullableWord((string) $result['target'], $this->targetWords) : null;
        $state = isset($result['state']) ? $this->normalizeNullableWord((string) $result['state'], $this->stateWords) : null;
        $confidence = isset($result['confidence']) ? strtolower(trim((string) $result['confidence'])) : 'medium';
        $tokens = isset($result['tokens']) && is_array($result['tokens']) ? $this->normalizeTokens($result['tokens']) : [];
        $mode = isset($result['mode']) ? strtolower(trim((string) $result['mode'])) : 'answer';
        $reportUrl = isset($result['reportUrl']) ? trim((string) $result['reportUrl']) : '';
        $chart = isset($result['chart']) && is_array($result['chart']) ? $result['chart'] : null;
        $actions = isset($result['actions']) && is_array($result['actions']) ? $result['actions'] : [];
        $followUps = isset($result['followUps']) && is_array($result['followUps']) ? $this->normalizeFollowUps($result['followUps']) : [];

        if ($mode === '' || ! in_array($mode, ['answer', 'open', 'search', 'report', 'chart', 'mixed'], true)) {
            $mode = 'answer';
        }

        if ($reply === '' && $query === '' && $routePath === '') {
            return null;
        }

        if ($query === '' && ! empty($tokens)) {
            $query = implode(' ', $tokens);
        }
        if ($reply === '') {
            $reply = $this->buildReply(
                $message,
                $query,
                $target,
                $state,
                $tokens,
                $routePath !== '' ? ['path' => $routePath, 'params' => $routeParams] : null
            );
        }
        if (! in_array($confidence, ['low', 'medium', 'high'], true)) {
            $confidence = 'medium';
        }
        if (empty($tokens) && $query !== '') {
            $tokens = $this->extractTokens($query, $this->normalize($query), $target, $state);
        }

        $reportContext = $this->isReportConversation($normalizedMessage, $context);
        if ($mode !== 'chart' && $mode !== 'report' && $reportContext) {
            $mode = 'report';
        }

        $route = $this->buildRouteIntent($normalizedMessage, $target, $state);
        if ($route !== null) {
            $routePath = $route['path'];
            $routeParams = $route['params'];
            if ($reply === '') {
                $reply = $this->buildReply($message, null, $target, $state, $tokens, $route, $mode);
            }
        }

        $routeParams = $this->normalizeRouteParams($routePath, $routeParams);
        if ($mode === 'answer') {
            $mode = $routePath !== '' ? 'open' : ($query !== '' ? 'search' : 'answer');
        }
        $reportUrl = $this->normalizeNullableRoute($reportUrl);
        if ($reportUrl === null) {
            $reportUrl = $this->buildReportUrl(
                $mode,
                $route !== null ? $route : ($routePath !== '' ? ['path' => $routePath, 'params' => $routeParams] : null),
                $context,
                $message,
                $target,
                $state
            );
        }
        if (empty($actions)) {
            $actions = $this->buildActions($routePath !== '' ? ['path' => $routePath, 'params' => $routeParams] : null, $query !== '' ? $query : null, $reportUrl);
        }
        if ($reportContext) {
            $followUps = $this->buildFollowUps(
                $normalizedMessage,
                $target,
                $state,
                $query !== '' ? $query : null,
                $routePath !== '' ? ['path' => $routePath, 'params' => $routeParams] : null,
                $context
            );
        } elseif (empty($followUps)) {
            $followUps = $this->buildFollowUps(
                $normalizedMessage,
                $target,
                $state,
                $query !== '' ? $query : null,
                $routePath !== '' ? ['path' => $routePath, 'params' => $routeParams] : null,
                $context
            );
        }

        return [
            'reply'      => $reply,
            'query'      => $query !== '' ? $query : null,
            'routePath'  => $routePath !== '' ? $routePath : null,
            'routeParams'=> $routeParams,
            'mode'       => $mode,
            'actions'    => $actions,
            'reportUrl'  => $reportUrl,
            'chart'      => $chart,
            'followUps'  => $followUps,
            'target'     => $target,
            'state'      => $state,
            'confidence' => $confidence,
            'tokens'     => $tokens,
            'source'     => 'llm',
        ];
    }

    /**
     * @param string $message
     * @param ?string $query
     * @param ?string $target
     * @param ?string $state
     * @param array<int, string> $tokens
     * @param ?array<string, mixed> $route
     *
     * @return string
     */
    private function buildReply($message, $query, $target, $state, array $tokens, $route = null, $mode = 'answer')
    {
        $pieces = [];
        if (is_array($route) && isset($route['path'])) {
            $pieces[] = $this->humanRoute($route['path'], $target);
        } else {
            if ($target !== null) {
                $pieces[] = $this->humanTarget($target);
            }
            if ($state !== null) {
                $pieces[] = 'w stanie ' . $state;
            }
            if (! empty($tokens)) {
                $pieces[] = 'dla "' . implode(' ', $tokens) . '"';
            }

            if (empty($pieces)) {
                $pieces[] = 'dla "' . trim($message) . '"';
            }
        }

        if ($mode === 'report') {
            $reply = 'Mogę przygotować raport dla ' . implode(' ', $pieces) . '.';
            $reply .= ' Mogę przeprowadzić Cię przez pola raportu: Name, Timeframe, Report, Filter, Breakdown i SLA Visualization.';
        } else {
            $reply = is_array($route) && isset($route['path'])
                ? 'Rozumiem to jako otwarcie ' . implode(' ', $pieces) . '.'
                : 'Rozumiem to jako wyszukiwanie ' . implode(' ', $pieces) . '.';
        }
        if ($query) {
            $reply .= ' Przerobiłem to na zapytanie: "' . $query . '".';
        }
        $reply .= $mode === 'report'
            ? ' Mogę otworzyć wynik albo przygotować raport.'
            : ' Mogę otworzyć wynik albo doprecyzować zapytanie.';

        return $reply;
    }

    /**
     * @param string $target
     *
     * @return string
     */
    private function humanTarget($target)
    {
        switch ($target) {
            case 'hostgroup':
                return 'grupy hostów';
            case 'servicegroup':
                return 'grupy serwisów';
            case 'service':
                return 'serwisy';
            case 'host':
            default:
                return 'hosty';
        }
    }

    /**
     * @param string $path
     * @param ?string $target
     *
     * @return string
     */
    private function humanRoute($path, $target)
    {
        if ($path === 'icingadb/services/grid') {
            return 'widoku aktywnych problemów serwisów';
        }

        if ($path === 'icingadb/hosts') {
            return 'widoku hostów z problemami';
        }

        return $this->humanTarget($target ?: 'service');
    }

    /**
     * @param string $normalized
     * @param ?string $target
     * @param ?string $state
     *
     * @return ?array{path:string,params:array<string,mixed>}
     */
    private function buildRouteIntent($normalized, $target, $state)
    {
        if ($this->isProblemIntent($normalized, $state)) {
            $route = $target === 'host' ? 'icingadb/hosts' : 'icingadb/services/grid';
            $params = $target === 'host'
                ? ['host.state.is_problem' => 'y']
                : ['problems' => true];
            return [
                'path' => $route,
                'params' => $params
            ];
        }

        return null;
    }

    /**
     * @param string $routePath
     * @param array<string, mixed> $routeParams
     *
     * @return array<string, mixed>
     */
    private function normalizeRouteParams($routePath, array $routeParams)
    {
        if ($routePath === 'icingadb/services/grid') {
            $params = [];
            if (isset($routeParams['problems'])) {
                $params['problems'] = (bool) $routeParams['problems'];
            }

            return $params;
        }

        if ($routePath === 'icingadb/hosts') {
            $params = [];
            if (isset($routeParams['host.state.is_problem'])) {
                $params['host.state.is_problem'] = (string) $routeParams['host.state.is_problem'];
            }

            return $params;
        }

        return $routeParams;
    }

    /**
     * @param string $normalized
     * @param ?string $state
     *
     * @return bool
     */
    private function isProblemIntent($normalized, $state)
    {
        $normalized = $this->foldText($normalized);
        if (in_array($state, ['critical', 'down', 'warning', 'problem'], true)) {
            return true;
        }

        foreach ($this->problemWords as $word) {
            if (preg_match('/\b' . preg_quote($word, '/') . '\b/u', $normalized)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param ?string $target
     * @param ?string $state
     * @param array<int, string> $tokens
     * @param ?string $query
     *
     * @return string
     */
    private function confidence($target, $state, array $tokens, $query)
    {
        if ($query === null || $query === '') {
            return 'low';
        }

        if ($target !== null && $state !== null && ! empty($tokens)) {
            return 'high';
        }

        if ($target !== null || $state !== null || ! empty($tokens)) {
            return 'medium';
        }

        return 'low';
    }

    /**
     * @param string $message
     *
     * @return string
     */
    private function normalize($message)
    {
        $message = mb_strtolower($message, 'UTF-8');
        $message = preg_replace('/[[:punct:]]+/u', ' ', $message);
        $message = preg_replace('/\s+/u', ' ', $message);

        return trim((string) $message);
    }

    /**
     * @param string $normalized
     *
     * @return ?string
     */
    private function detectTarget($normalized)
    {
        $normalized = $this->foldText($normalized);
        $phraseTargets = [
            '/\bna\s+(hoscie|hostach|serwerze|serwerach)\b/u' => 'host',
            '/\bna\s+(serwisie|serwisach|usludze|uslugach)\b/u' => 'service',
            '/\bgrupa\s+host(ow|y)?\b/u' => 'hostgroup',
            '/\bgrupa\s+serwis(ow|y)?\b/u' => 'servicegroup',
        ];

        foreach ($phraseTargets as $pattern => $target) {
            if (preg_match($pattern, $normalized)) {
                return $target;
            }
        }

        foreach (preg_split('/\s+/u', $normalized, -1, PREG_SPLIT_NO_EMPTY) as $token) {
            if (isset($this->targetWords[$token])) {
                return $this->targetWords[$token];
            }
        }

        return null;
    }

    /**
     * @param string $normalized
     *
     * @return ?string
     */
    private function detectState($normalized)
    {
        $normalized = $this->foldText($normalized);
        $phraseStates = [
            '/\bnie\s+dziala\b/u' => 'down',
            '/\bw\s+dol\b/u' => 'down',
            '/\bzatrzymane\b/u' => 'down',
            '/\bwylaczone\b/u' => 'down',
            '/\bwlaczone\b/u' => 'up',
        ];

        foreach ($phraseStates as $pattern => $state) {
            if (preg_match($pattern, $normalized)) {
                return $state;
            }
        }

        foreach (preg_split('/\s+/u', $normalized, -1, PREG_SPLIT_NO_EMPTY) as $token) {
            if (isset($this->stateWords[$token])) {
                return $this->stateWords[$token];
            }
        }

        return null;
    }

    /**
     * @param string $message
     * @param string $normalized
     * @param ?string $target
     * @param ?string $state
     *
     * @return array<int, string>
     */
    private function extractTokens($message, $normalized, $target = null, $state = null)
    {
        $tokens = [];

        if (preg_match_all('/"([^"]+)"|\'([^\']+)\'/u', $message, $matches, PREG_SET_ORDER)) {
            foreach ($matches as $match) {
                $value = trim($match[1] !== '' ? $match[1] : $match[2]);
                if ($value !== '') {
                    $tokens[] = $this->normalize($value);
                }
            }
        }

        $plainTokens = preg_split('/\s+/u', $normalized, -1, PREG_SPLIT_NO_EMPTY);
        foreach ($plainTokens as $token) {
            if ($this->isNoiseToken($token)) {
                continue;
            }
            if (isset($this->targetWords[$token]) || isset($this->stateWords[$token])) {
                continue;
            }
            if (! in_array($token, $tokens, true)) {
                $tokens[] = $token;
            }
        }

        if ($target !== null && empty($tokens)) {
            $tokens[] = $target;
        }

        if ($state !== null && empty($tokens)) {
            $tokens[] = $state;
        }

        return array_values(array_filter($tokens, function ($token) {
            return $token !== '';
        }));
    }

    /**
     * @param array<int, mixed> $tokens
     *
     * @return array<int, string>
     */
    private function normalizeTokens(array $tokens)
    {
        $normalized = [];
        foreach ($tokens as $token) {
            if (! is_string($token)) {
                continue;
            }

            $token = $this->normalize($token);
            if ($token !== '' && ! in_array($token, $normalized, true)) {
                $normalized[] = $token;
            }
        }

        return $normalized;
    }

    /**
     * @param string $token
     * @param array<string, string> $map
     *
     * @return ?string
     */
    private function normalizeNullableWord($token, array $map)
    {
        $token = $this->normalize($token);
        if ($token === '') {
            return null;
        }

        if (isset($map[$token])) {
            return $map[$token];
        }

        return $token;
    }

    /**
     * @param array<int, string> $tokens
     * @param ?string $target
     * @param ?string $state
     *
     * @return string
     */
    private function buildQuery(array $tokens, $target, $state)
    {
        $queryTokens = [];

        if ($target !== null) {
            $queryTokens[] = $target;
        }
        if ($state !== null) {
            $queryTokens[] = $state;
        }

        foreach ($tokens as $token) {
            if ($this->isNoiseToken($token)) {
                continue;
            }

            $queryTokens[] = $token;
        }

        $queryTokens = array_values(array_unique(array_filter($queryTokens, function ($token) {
            return $token !== '';
        })));

        return implode(' ', $queryTokens);
    }

    /**
     * @param string $normalized
     * @param bool $hasRoute
     * @param bool $hasQuery
     *
     * @return string
     */
    private function detectMode($normalized, $hasRoute, $hasQuery)
    {
        $normalized = $this->foldText($normalized);
        if ($this->hasAnyWord($normalized, ['raport', 'report', 'zestawienie', 'podsumuj'])) {
            return 'report';
        }

        if ($this->hasAnyWord($normalized, ['wykres', 'chart', 'trend', 'graficznie'])) {
            return 'chart';
        }

        if ($hasRoute) {
            return 'open';
        }

        if ($hasQuery) {
            return 'search';
        }

        return 'answer';
    }

    /**
     * @param string $mode
     * @param ?array{path:string,params:array<string,mixed>} $route
     * @param array<string, mixed> $context
     *
     * @return ?string
     */
    private function buildReportUrl($mode, $route, array $context, $message = '', $target = null, $state = null)
    {
        if ($mode !== 'report') {
            return null;
        }

        if (empty($context['capabilities']['reporting'])) {
            return null;
        }

        $reportSpec = $this->extractReportSpec($message, $route, $context, $target, $state);
        $query = [];

        if (! empty($reportSpec['report'])) {
            $query['report'] = $reportSpec['report'];
        }
        if (! empty($reportSpec['name'])) {
            $query['name'] = $reportSpec['name'];
        }
        if (! empty($reportSpec['timeframe_name'])) {
            $query['timeframe_name'] = $reportSpec['timeframe_name'];
        }
        if (! empty($reportSpec['filter'])) {
            $query['filter'] = $reportSpec['filter'];
        }
        if (! empty($reportSpec['breakdown'])) {
            $query['breakdown'] = $reportSpec['breakdown'];
        }
        if (! empty($reportSpec['sla_chart'])) {
            $query['sla_chart'] = $reportSpec['sla_chart'];
        }
        if (! empty($reportSpec['outage_object_type'])) {
            $query['outage_object_type'] = $reportSpec['outage_object_type'];
        }
        if (! empty($reportSpec['outage_filter'])) {
            $query['outage_filter'] = $reportSpec['outage_filter'];
        }
        if (! empty($reportSpec['outage_service_state'])) {
            $query['outage_service_state'] = $reportSpec['outage_service_state'];
        }

        return 'assistant/report' . (empty($query) ? '' : '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986));
    }

    /**
     * @param ?array{path:string,params:array<string,mixed>} $route
     * @param ?string $query
     * @param ?string $reportUrl
     *
     * @return array<int, array<string, mixed>>
     */
    private function buildActions($route, $query, $reportUrl)
    {
        $actions = [];
        if (is_array($route) && isset($route['path'])) {
            $actions[] = [
                'type' => 'open',
                'label' => 'Open result',
            ];
        } elseif ($query !== null && $query !== '') {
            $actions[] = [
                'type' => 'search',
                'label' => 'Open search results',
            ];
        }

        if ($reportUrl !== null) {
            $actions[] = [
                'type' => 'report',
                'label' => 'Create report',
            ];
        }

        return $actions;
    }

    /**
     * @param string $normalized
     * @param ?string $target
     * @param ?string $state
     * @param ?string $query
     * @param ?array{path:string,params:array<string,mixed>} $route
     *
     * @return array<int, mixed>
     */
    private function buildFollowUps($normalized, $target, $state, $query, $route, array $context = [])
    {
        $followUps = [];
        $reportContext = $this->isReportConversation($normalized, $context);
        $reportType = $this->extractReportType(
            $this->foldText($this->normalize($this->collectReportSourceText($normalized, $context))),
            $route,
            $target
        );

        if ($route === null && $query === null) {
            $followUps[] = 'Czy chcesz hosty, serwisy, czy grupy obiektów?';
        }

        if ($reportContext) {
            $followUps[] = $this->makeFollowUpGroup(
                'Jaki typ raportu chcesz przygotować?',
                $this->buildReportTypeOptions($context)
            );
        }

        if ($target !== null && $state === null && $route === null && $query !== null) {
            $followUps[] = 'Chcesz zawęzić to do stanu krytycznego, warning albo down?';
        }

        if ($reportContext) {
            $followUps[] = $this->makeFollowUpGroup(
                'Jak ma się nazywać raport?',
                $this->buildReportNameOptions($target, $state)
            );
            $followUps[] = $this->makeFollowUpGroup(
                'Jaki Timeframe mam ustawić?',
                $this->buildTimeframeOptions($context)
            );
            $templateOptions = $this->buildTemplateOptions($context);
            if (! empty($templateOptions)) {
                $followUps[] = $this->makeFollowUpGroup(
                    'Jaki Template ustawić?',
                    $templateOptions
                );
            }
            $followUps[] = $this->makeFollowUpGroup(
                'Jaki Filter zastosować?',
                [
                    $this->makeFollowUpOption('Bez filtra', 'Nie ustawiaj Filter.'),
                    $this->makeFollowUpOption('hostgroup.name=linux-servers', 'Ustaw Filter na hostgroup.name=linux-servers.'),
                    $this->makeFollowUpOption('servicegroup.name=core-services', 'Ustaw Filter na servicegroup.name=core-services.'),
                ]
            );

            if ($reportType === 'outage' || $this->hasAnyWord($this->foldText($normalized), ['outage'])) {
                $followUps[] = $this->makeFollowUpGroup(
                    'Jakie Objects ustawić?',
                    $this->buildOutageObjectsOptions($context)
                );
                $followUps[] = $this->makeFollowUpGroup(
                    'Jaki Service Outage State ustawić?',
                    $this->buildOutageServiceStateOptions($context)
                );
            } else {
                $followUps[] = $this->makeFollowUpGroup(
                    'Czy chcesz Breakdown?',
                    $this->buildBreakdownOptions($context)
                );
                $followUps[] = $this->makeFollowUpGroup(
                    'Czy ustawić SLA Visualization?',
                    $this->buildSlaVisualizationOptions($context)
                );
            }
        }

        return $this->uniqueFollowUps($followUps);
    }

    /**
     * @param array<string, mixed> $context
     *
     * @return array<int, array<string, string>>
     */
    private function buildReportTypeOptions(array $context)
    {
        $labels = $this->reportingBuilderOptions($context, 'reportTypes', [
            'Host SLA Report',
            'Service SLA Report',
            'Outage Report (Icinga DB)',
        ]);
        $options = [];

        foreach ($labels as $label) {
            $normalized = $this->foldText($this->normalize($label));
            if (strpos($normalized, 'host sla') !== false) {
                $options[] = $this->makeFollowUpOption($label, 'Ustaw Report na Host SLA Report.');
            } elseif (strpos($normalized, 'service sla') !== false) {
                $options[] = $this->makeFollowUpOption($label, 'Ustaw Report na Service SLA Report.');
            } elseif (strpos($normalized, 'outage') !== false) {
                $options[] = $this->makeFollowUpOption($label, 'Ustaw Report na Outage Report (Icinga DB).');
            }
        }

        return $options;
    }

    /**
     * @param array<string, mixed> $context
     *
     * @return array<int, array<string, string>>
     */
    private function buildTimeframeOptions(array $context)
    {
        $labels = $this->reportingBuilderOptions($context, 'timeframes', [
            '25 Hours',
            'One Week',
            'One Month',
            'One Year',
            'Current Day',
            'Last Day',
            'Current Week',
            'Last Week',
            'Current Month',
            'Last Month',
            'Current Year',
            'Last Year',
        ]);
        $options = [];

        foreach ($labels as $label) {
            $options[] = $this->makeFollowUpOption($label, 'Ustaw Timeframe na ' . $label . '.');
        }

        return $options;
    }

    /**
     * @param array<string, mixed> $context
     *
     * @return array<int, array<string, string>>
     */
    private function buildTemplateOptions(array $context)
    {
        $labels = $this->reportingBuilderOptions($context, 'templates', []);
        $options = [
            $this->makeFollowUpOption('Bez template', 'Nie ustawiaj Template.'),
        ];

        foreach ($labels as $label) {
            $options[] = $this->makeFollowUpOption($label, 'Ustaw Template na ' . $label . '.');
        }

        return $options;
    }

    /**
     * @param array<string, mixed> $context
     *
     * @return array<int, array<string, string>>
     */
    private function buildBreakdownOptions(array $context)
    {
        $labels = $this->reportingBuilderOptions($context, 'breakdownOptions', [
            'None',
            'Hour',
            'Day',
            'Week',
            'Month',
        ]);
        $options = [];

        foreach ($labels as $label) {
            $normalized = $this->foldText($this->normalize($label));
            if ($normalized === 'none') {
                $options[] = $this->makeFollowUpOption($label, 'Nie ustawiaj Breakdown.');
            } else {
                $options[] = $this->makeFollowUpOption($label, 'Ustaw Breakdown na ' . strtolower($label) . '.');
            }
        }

        return $options;
    }

    /**
     * @param array<string, mixed> $context
     *
     * @return array<int, array<string, string>>
     */
    private function buildSlaVisualizationOptions(array $context)
    {
        $labels = $this->reportingBuilderOptions($context, 'slaVisualizationOptions', [
            'Table',
            'Horizontal Bars',
            'Columns',
            'Availability Balance Columns',
            'Pie Charts',
        ]);
        $options = [];

        foreach ($labels as $label) {
            $normalized = $this->foldText($this->normalize($label));
            if ($normalized === 'table') {
                $options[] = $this->makeFollowUpOption($label, 'Ustaw SLA Visualization na table.');
            } elseif ($normalized === 'horizontal bars') {
                $options[] = $this->makeFollowUpOption($label, 'Ustaw SLA Visualization na horizontal bars.');
            } elseif ($normalized === 'columns') {
                $options[] = $this->makeFollowUpOption($label, 'Ustaw SLA Visualization na columns.');
            } elseif ($normalized === 'availability balance columns') {
                $options[] = $this->makeFollowUpOption($label, 'Ustaw SLA Visualization na availability balance columns.');
            } elseif ($normalized === 'pie charts') {
                $options[] = $this->makeFollowUpOption($label, 'Ustaw SLA Visualization na pie chart.');
            }
        }

        return $options;
    }

    /**
     * @param array<string, mixed> $context
     *
     * @return array<int, array<string, string>>
     */
    private function buildOutageObjectsOptions(array $context)
    {
        $labels = $this->reportingBuilderOptions($context, 'outageObjectsOptions', [
            'Hosts and Services',
            'Hosts',
            'Services',
        ]);
        $options = [];

        foreach ($labels as $label) {
            $options[] = $this->makeFollowUpOption($label, 'Ustaw Objects na ' . $label . '.');
        }

        return $options;
    }

    /**
     * @param array<string, mixed> $context
     *
     * @return array<int, array<string, string>>
     */
    private function buildOutageServiceStateOptions(array $context)
    {
        $labels = $this->reportingBuilderOptions($context, 'outageServiceStateOptions', [
            'Critical',
            'Critical and Warning',
        ]);
        $options = [];

        foreach ($labels as $label) {
            $options[] = $this->makeFollowUpOption($label, 'Ustaw Service Outage State na ' . $label . '.');
        }

        return $options;
    }

    /**
     * @param array<string, mixed> $context
     * @param string $key
     * @param array<int, string> $defaults
     *
     * @return array<int, string>
     */
    private function reportingBuilderOptions(array $context, $key, array $defaults)
    {
        if (
            isset($context['capabilities']['reportingBuilder'][$key])
            && is_array($context['capabilities']['reportingBuilder'][$key])
        ) {
            $values = [];
            foreach ($context['capabilities']['reportingBuilder'][$key] as $value) {
                $value = trim((string) $value);
                if ($value !== '') {
                    $values[] = $value;
                }
            }

            if (! empty($values)) {
                return $values;
            }
        }

        return $defaults;
    }

    /**
     * @param ?string $target
     * @param ?string $state
     *
     * @return array<int, array<string, string>>
     */
    private function buildReportNameOptions($target, $state)
    {
        $options = [
            $this->makeFollowUpOption('Nadaj nazwę automatycznie', 'Nadaj raportowi automatyczną nazwę.'),
        ];

        if ($target === 'host' && in_array($state, ['problem', 'down'], true)) {
            $options[] = $this->makeFollowUpOption(
                'Raport z problemów hostów',
                'Ustaw Name na "Raport z problemów hostów".'
            );
        }

        if ($target === 'service' || $state === 'critical' || $state === 'warning') {
            $options[] = $this->makeFollowUpOption(
                'Raport SLA serwisów',
                'Ustaw Name na "Raport SLA serwisów".'
            );
        }

        $options[] = $this->makeFollowUpOption('SLA - 7 dni', 'Ustaw Name na "SLA - 7 dni".');
        $options[] = $this->makeFollowUpOption('Outage - prod', 'Ustaw Name na "Outage - prod".');

        return $options;
    }

    /**
     * @param string $normalized
     * @param array<string, mixed> $context
     *
     * @return bool
     */
    private function isReportConversation($normalized, array $context = [])
    {
        $folded = $this->foldText($normalized);
        if ($this->hasAnyWord($folded, ['raport', 'report', 'zestawienie', 'sla'])) {
            return true;
        }

        $historyHasReport = $this->historyHasReportContext($context);
        if (! $historyHasReport) {
            return false;
        }

        if ($this->hasReportFollowUpSignal($folded)) {
            return true;
        }

        return mb_strlen(trim($folded)) <= 48;
    }

    /**
     * @param array<string, mixed> $context
     *
     * @return bool
     */
    private function historyHasReportContext(array $context)
    {
        if (empty($context['history']) || ! is_array($context['history'])) {
            return false;
        }

        $recentHistory = array_slice($context['history'], -6);
        foreach ($recentHistory as $entry) {
            if (! is_array($entry) || empty($entry['content'])) {
                continue;
            }

            $content = $this->foldText($this->normalize((string) $entry['content']));
            if ($this->hasAnyWord($content, ['raport', 'report', 'zestawienie', 'sla'])) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param string $normalized
     *
     * @return bool
     */
    private function hasReportFollowUpSignal($normalized)
    {
        if ($normalized === '') {
            return false;
        }

        if ($this->hasAnyWord($normalized, ['timeframe', 'breakdown', 'template'])) {
            return true;
        }

        if (strpos($normalized, 'sla visualization') !== false) {
            return true;
        }

        if (strpos($normalized, 'ustaw report') !== false) {
            return true;
        }

        if (strpos($normalized, 'ustaw filter') !== false || strpos($normalized, 'nie ustawiaj filter') !== false) {
            return true;
        }

        if (strpos($normalized, 'nadaj raportowi') !== false) {
            return true;
        }

        if (preg_match('/\blast\s+\d+\s+(hours|days|weeks|months)\b/u', $normalized)) {
            return true;
        }

        return false;
    }

    /**
     * @param string $message
     * @param ?array{path:string,params:array<string,mixed>} $route
     * @param array<string, mixed> $context
     * @param ?string $target
     * @param ?string $state
     *
     * @return array<string, string>
     */
    private function extractReportSpec($message, $route, array $context, $target, $state)
    {
        $raw = $this->collectReportSourceText($message, $context);
        $normalized = $this->foldText($this->normalize($raw));

        $report = $this->extractReportType($normalized, $route, $target);
        $timeframe = $this->extractTimeframeName($normalized);
        $filter = $this->extractExplicitReportSetting($raw, 'Filter');
        $breakdown = $this->extractBreakdown($normalized);
        $slaChart = $this->extractSlaChart($normalized);
        $name = $this->extractReportName($raw, $report, $timeframe);
        $outageObjectType = $this->extractOutageObjectType($normalized, $target);
        $outageServiceState = $this->extractOutageServiceState($normalized, $state);

        if ($filter === null && strpos($normalized, 'nie ustawiaj filter') === false) {
            $filter = $this->inferReportFilter($route, $target, $state, $report);
        }

        $spec = [
            'report' => $report,
            'name' => $name,
            'timeframe_name' => $timeframe,
            'filter' => $filter,
            'breakdown' => $breakdown,
            'sla_chart' => $report === 'outage' ? null : $slaChart,
            'outage_object_type' => $report === 'outage' ? $outageObjectType : null,
            'outage_filter' => $report === 'outage' ? $filter : null,
            'outage_service_state' => $report === 'outage' ? $outageServiceState : null,
        ];

        return array_filter($spec, function ($value) {
            return $value !== null && $value !== '';
        });
    }

    /**
     * @param string $message
     * @param array<string, mixed> $context
     *
     * @return string
     */
    private function collectReportSourceText($message, array $context)
    {
        $parts = [trim((string) $message)];
        if (! empty($context['history']) && is_array($context['history'])) {
            foreach (array_slice($context['history'], -6) as $entry) {
                if (! is_array($entry) || empty($entry['content'])) {
                    continue;
                }

                $parts[] = trim((string) $entry['content']);
            }
        }

        return implode("\n", array_filter($parts));
    }

    /**
     * @param string $normalized
     * @param ?array{path:string,params:array<string,mixed>} $route
     * @param ?string $target
     *
     * @return string
     */
    private function extractReportType($normalized, $route, $target)
    {
        if (strpos($normalized, 'outage report') !== false) {
            return 'outage';
        }

        if (strpos($normalized, 'service sla report') !== false) {
            return 'service';
        }

        if (strpos($normalized, 'host sla report') !== false) {
            return 'host';
        }

        if (strpos($normalized, 'outage') !== false) {
            return 'outage';
        }

        if (is_array($route) && isset($route['path'])) {
            if ($route['path'] === 'icingadb/services/grid') {
                return 'service';
            }

            if ($route['path'] === 'icingadb/hosts') {
                return 'host';
            }
        }

        if ($target === 'service') {
            return 'service';
        }

        return 'host';
    }

    /**
     * @param string $normalized
     *
     * @return ?string
     */
    private function extractTimeframeName($normalized)
    {
        $mapping = [
            'last 24 hours' => '25 Hours',
            'last 7 days' => 'One Week',
            'last 30 days' => 'One Month',
            '25 hours' => '25 Hours',
            'one week' => 'One Week',
            'one month' => 'One Month',
            'current day' => 'Current Day',
            'last day' => 'Last Day',
            'current week' => 'Current Week',
            'last week' => 'Last Week',
            'current month' => 'Current Month',
            'last month' => 'Last Month',
            'current year' => 'Current Year',
            'last year' => 'Last Year',
        ];

        foreach ($mapping as $needle => $timeframe) {
            if (strpos($normalized, $needle) !== false) {
                return $timeframe;
            }
        }

        return null;
    }

    /**
     * @param string $raw
     * @param string $field
     *
     * @return ?string
     */
    private function extractExplicitReportSetting($raw, $field)
    {
        if (preg_match('/Ustaw\s+' . preg_quote($field, '/') . '\s+na\s+"([^"]+)"/iu', $raw, $match)) {
            return trim($match[1]);
        }

        if (preg_match('/Ustaw\s+' . preg_quote($field, '/') . '\s+na\s+([^\n]+)/iu', $raw, $match)) {
            return rtrim(trim($match[1]), " \t\n\r\0\x0B.");
        }

        return null;
    }

    /**
     * @param string $raw
     * @param string $report
     * @param ?string $timeframe
     *
     * @return ?string
     */
    private function extractReportName($raw, $report, $timeframe)
    {
        $explicit = $this->extractExplicitReportSetting($raw, 'Name');
        if ($explicit !== null) {
            return $explicit;
        }

        if (preg_match('/Nadaj raportowi automatyczn[aą]\s+nazw[eę]/iu', $raw)) {
            return $this->buildAutomaticReportName($report, $timeframe);
        }

        return null;
    }

    /**
     * @param string $report
     * @param ?string $timeframe
     *
     * @return string
     */
    private function buildAutomaticReportName($report, $timeframe)
    {
        switch ($report) {
            case 'service':
                $prefix = 'Service SLA';
                break;
            case 'outage':
                $prefix = 'Outage Report';
                break;
            case 'host':
            default:
                $prefix = 'Host SLA';
                break;
        }

        return $timeframe !== null ? $prefix . ' - ' . $timeframe : $prefix;
    }

    /**
     * @param ?array{path:string,params:array<string,mixed>} $route
     * @param ?string $target
     * @param ?string $state
     * @param string $report
     *
     * @return ?string
     */
    private function inferReportFilter($route, $target, $state, $report)
    {
        if ($report === 'outage') {
            if ($target === 'service' && ($state === 'problem' || $state === 'critical' || $state === 'warning')) {
                return 'service.state.is_problem=y';
            }

            if ($target === 'host' && ($state === 'problem' || $state === 'down')) {
                return 'host.state.is_problem=y';
            }
        }

        if (is_array($route) && isset($route['path'])) {
            if ($route['path'] === 'icingadb/hosts') {
                return 'host.state.is_problem=y';
            }

            if ($route['path'] === 'icingadb/services/grid') {
                return 'service.state.is_problem=y';
            }
        }

        if ($target === 'service' && in_array($state, ['problem', 'critical', 'warning'], true)) {
            return 'service.state.is_problem=y';
        }

        if ($target === 'host' && in_array($state, ['problem', 'down'], true)) {
            return 'host.state.is_problem=y';
        }

        return null;
    }

    /**
     * @param string $normalized
     *
     * @return ?string
     */
    private function extractBreakdown($normalized)
    {
        if (strpos($normalized, 'nie ustawiaj breakdown') !== false || strpos($normalized, 'bez breakdown') !== false) {
            return 'none';
        }

        foreach (['hour', 'day', 'week', 'month'] as $value) {
            if (strpos($normalized, 'ustaw breakdown na ' . $value) !== false || preg_match('/\bbreakdown\b.*\b' . $value . '\b/u', $normalized)) {
                return $value;
            }
        }

        return null;
    }

    /**
     * @param string $normalized
     *
     * @return ?string
     */
    private function extractSlaChart($normalized)
    {
        if (strpos($normalized, 'sla visualization na table') !== false || strpos($normalized, 'tabela') !== false) {
            return 'table';
        }

        if (strpos($normalized, 'sla visualization na horizontal bars') !== false || preg_match('/\bbars\b/u', $normalized)) {
            return 'bars';
        }

        if (strpos($normalized, 'sla visualization na availability balance columns') !== false || strpos($normalized, 'balance') !== false) {
            return 'balance_columns';
        }

        if (strpos($normalized, 'sla visualization na columns') !== false) {
            return 'columns';
        }

        if (strpos($normalized, 'sla visualization na pie chart') !== false || strpos($normalized, 'pie chart') !== false) {
            return 'gauge';
        }

        return null;
    }

    /**
     * @param ?string $target
     *
     * @return string
     */
    private function inferOutageObjectType($target)
    {
        if ($target === 'service') {
            return 'service';
        }

        if ($target === 'host') {
            return 'host';
        }

        return 'all';
    }

    /**
     * @param string $normalized
     * @param ?string $target
     *
     * @return string
     */
    private function extractOutageObjectType($normalized, $target)
    {
        if (strpos($normalized, 'objects na hosts and services') !== false || strpos($normalized, 'hosts and services') !== false) {
            return 'all';
        }

        if (strpos($normalized, 'objects na hosts') !== false) {
            return 'host';
        }

        if (strpos($normalized, 'objects na services') !== false) {
            return 'service';
        }

        return $this->inferOutageObjectType($target);
    }

    /**
     * @param ?string $state
     *
     * @return string
     */
    private function inferOutageServiceState($state)
    {
        return $state === 'warning' ? 'warning' : 'critical';
    }

    /**
     * @param string $normalized
     * @param ?string $state
     *
     * @return string
     */
    private function extractOutageServiceState($normalized, $state)
    {
        if (strpos($normalized, 'service outage state na critical and warning') !== false || strpos($normalized, 'critical and warning') !== false) {
            return 'warning';
        }

        if (strpos($normalized, 'service outage state na critical') !== false) {
            return 'critical';
        }

        return $this->inferOutageServiceState($state);
    }

    /**
     * @param string $normalized
     * @param array<int, string> $words
     *
     * @return bool
     */
    private function hasAnyWord($normalized, array $words)
    {
        foreach ($words as $word) {
            if (preg_match('/\b' . preg_quote($word, '/') . '\b/u', $normalized)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param ?string $value
     *
     * @return ?string
     */
    private function normalizeNullableRoute($value)
    {
        $value = trim((string) $value);
        return $value === '' ? null : $value;
    }

    /**
     * @param array<int, mixed> $followUps
     *
     * @return array<int, mixed>
     */
    private function normalizeFollowUps(array $followUps)
    {
        $normalized = [];
        foreach ($followUps as $followUp) {
            if (is_string($followUp)) {
                $followUp = trim($followUp);
                if ($followUp !== '' && ! in_array($followUp, $normalized, true)) {
                    $normalized[] = $followUp;
                }
                continue;
            }

            if (! is_array($followUp) || empty($followUp['question']) || empty($followUp['options']) || ! is_array($followUp['options'])) {
                continue;
            }

            $question = trim((string) $followUp['question']);
            $options = [];
            foreach ($followUp['options'] as $option) {
                if (! is_array($option)) {
                    continue;
                }

                $label = isset($option['label']) ? trim((string) $option['label']) : '';
                $message = isset($option['message']) ? trim((string) $option['message']) : '';
                if ($message === '') {
                    continue;
                }

                $options[] = [
                    'label' => $label !== '' ? $label : $message,
                    'message' => $message,
                ];
            }

            if ($question !== '' && ! empty($options)) {
                $normalized[] = [
                    'question' => $question,
                    'options' => $options,
                ];
            }
        }

        return $normalized;
    }

    /**
     * @param string $question
     * @param array<int, array<string, string>> $options
     *
     * @return array<string, mixed>
     */
    private function makeFollowUpGroup($question, array $options)
    {
        return [
            'question' => $question,
            'options' => $options,
        ];
    }

    /**
     * @param string $label
     * @param string $message
     *
     * @return array<string, string>
     */
    private function makeFollowUpOption($label, $message)
    {
        return [
            'label' => $label,
            'message' => $message,
        ];
    }

    /**
     * @param array<int, mixed> $followUps
     *
     * @return array<int, mixed>
     */
    private function uniqueFollowUps(array $followUps)
    {
        $unique = [];
        $seen = [];

        foreach ($this->normalizeFollowUps($followUps) as $followUp) {
            $key = \Icinga\Util\Json::encode($followUp);
            if (isset($seen[$key])) {
                continue;
            }

            $seen[$key] = true;
            $unique[] = $followUp;
        }

        return $unique;
    }

    /**
     * @param string $token
     *
     * @return bool
     */
    private function isNoiseToken($token)
    {
        return $token === '' || in_array($token, $this->stopWords, true);
    }

    /**
     * @param string $text
     *
     * @return string
     */
    private function foldText($text)
    {
        $folded = @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $text);
        if ($folded === false || $folded === '') {
            return $text;
        }

        return strtolower($folded);
    }
}
