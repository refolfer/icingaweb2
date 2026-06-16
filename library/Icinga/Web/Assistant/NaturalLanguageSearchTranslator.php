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
        'service' => 'service',
        'services' => 'service',
        'serwis' => 'service',
        'serwisy' => 'service',
        'servicegroup' => 'servicegroup',
        'servicegroupy' => 'servicegroup',
        'servicegrupa' => 'servicegroup',
        'servicegrupy' => 'servicegroup',
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
     *     target: ?string,
     *     state: ?string,
     *     confidence: string,
     *     tokens: array<int, string>,
     *     source: string
     * }
     */
    public function translate($message)
    {
        $message = trim((string) $message);
        if ($message === '') {
            return $this->emptyResult();
        }

        try {
            if ($this->client->isConfigured()) {
                $result = $this->fromLlm($message);
                if ($result !== null) {
                    return $result;
                }
            }
        } catch (IcingaException $e) {
            // Fall back to deterministic parsing.
        }

        return $this->fromRules($message);
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
    private function fromLlm($message)
    {
        $result = $this->client->interpret($message, $this->buildContext($message));
        $normalized = $this->normalizeResult($result, $message);
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
    private function fromRules($message)
    {
        $normalized = $this->normalize($message);
        $target = $this->detectTarget($normalized);
        $state = $this->detectState($normalized);
        $route = $this->buildRouteIntent($normalized, $target, $state);
        $tokens = $route !== null
            ? []
            : $this->extractTokens($message, $normalized, $target, $state);
        $query = $route !== null ? null : $this->buildQuery($tokens, $target, $state);
        $reply = $this->buildReply($message, $query, $target, $state, $tokens, $route);
        $confidence = $this->confidence($target, $state, $tokens, $query);

        return [
            'reply'      => $reply,
            'query'      => $query ?: null,
            'routePath'  => $route !== null ? $route['path'] : null,
            'routeParams'=> $route !== null ? $route['params'] : [],
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
    private function buildContext($message)
    {
        $context = [];
        $normalized = $this->normalize($message);

        if (($target = $this->detectTarget($normalized)) !== null) {
            $context['target_hint'] = $target;
        }
        if (($state = $this->detectState($normalized)) !== null) {
            $context['state_hint'] = $state;
        }

        return $context;
    }

    /**
     * @param array<string, mixed> $result
     * @param string $message
     *
     * @return array<string, mixed>|null
     */
    private function normalizeResult(array $result, $message)
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

        $route = $this->buildRouteIntent($normalizedMessage, $target, $state);
        if ($route !== null) {
            $routePath = $route['path'];
            $routeParams = $route['params'];
            if ($reply === '') {
                $reply = $this->buildReply($message, null, $target, $state, $tokens, $route);
            }
        }

        $routeParams = $this->normalizeRouteParams($routePath, $routeParams);

        return [
            'reply'      => $reply,
            'query'      => $query !== '' ? $query : null,
            'routePath'  => $routePath !== '' ? $routePath : null,
            'routeParams'=> $routeParams,
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
    private function buildReply($message, $query, $target, $state, array $tokens, $route = null)
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

        $reply = is_array($route) && isset($route['path'])
            ? 'Rozumiem to jako otwarcie ' . implode(' ', $pieces) . '.'
            : 'Rozumiem to jako wyszukiwanie ' . implode(' ', $pieces) . '.';
        if ($query) {
            $reply .= ' Przerobiłem to na zapytanie: "' . $query . '".';
        }
        $reply .= ' Mogę otworzyć wynik albo doprecyzować zapytanie.';

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

        if ($path === 'icingadb/hosts/grid') {
            return 'widoku aktywnych problemów hostów';
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
            $route = $target === 'host' ? 'icingadb/hosts/grid' : 'icingadb/services/grid';
            return [
                'path' => $route,
                'params' => ['problems' => true]
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
        if ($routePath === 'icingadb/services/grid' || $routePath === 'icingadb/hosts/grid') {
            $params = [];
            if (isset($routeParams['problems'])) {
                $params['problems'] = (bool) $routeParams['problems'];
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
