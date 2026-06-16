<?php

// SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

namespace Icinga\Web\Assistant;

use Icinga\Application\Config;
use Icinga\Application\Icinga;
use Icinga\Exception\IcingaException;
use Icinga\Exception\ProgrammingError;
use Icinga\Util\Json;

class OpenAiCompatibleClient
{
    /**
     * @var array<string, mixed>
     */
    private $config;

    /**
     * @param array<string, mixed>|null $config
     */
    public function __construct(?array $config = null)
    {
        $this->config = $config ?? $this->loadConfig();
    }

    /**
     * @return bool
     */
    public function isConfigured()
    {
        if (! empty($this->config['api_key'])) {
            return true;
        }

        return $this->isLocalEndpoint();
    }

    /**
     * @param string $message
     * @param array<string, mixed> $context
     *
     * @return array<string, mixed>
     */
    public function interpret($message, array $context = [])
    {
        if (! $this->isConfigured()) {
            throw new IcingaException('Assistant LLM is not configured');
        }

        $messages = [
            [
                'role' => 'system',
                'content' => $this->systemPrompt()
            ],
            ...$this->historyMessages($context),
            [
                'role' => 'user',
                'content' => $this->userPrompt($message, $context)
            ],
        ];

        $payload = $this->buildPayload($messages);

        $response = $this->request($payload);
        $content = $this->extractContent($response);

        return $this->decodeContent($content);
    }

    /**
     * @return array<string, mixed>
     */
    private function loadConfig()
    {
        $config = [
            'api_key' => getenv('ICINGAWEB_ASSISTANT_API_KEY') ?: null,
            'base_url' => rtrim((string) (getenv('ICINGAWEB_ASSISTANT_BASE_URL') ?: 'https://api.openai.com'), '/'),
            'endpoint' => (string) (getenv('ICINGAWEB_ASSISTANT_ENDPOINT') ?: '/api/chat'),
            'model' => (string) (getenv('ICINGAWEB_ASSISTANT_MODEL') ?: 'qwen3:1.7b'),
            'temperature' => (float) (getenv('ICINGAWEB_ASSISTANT_TEMPERATURE') !== false ? getenv('ICINGAWEB_ASSISTANT_TEMPERATURE') : 0),
            'timeout' => (int) (getenv('ICINGAWEB_ASSISTANT_TIMEOUT') !== false ? getenv('ICINGAWEB_ASSISTANT_TIMEOUT') : 12),
        ];

        try {
            $appConfig = Config::app()->getSection('assistant');
            foreach (['api_key', 'base_url', 'endpoint', 'model', 'temperature', 'timeout'] as $key) {
                if (isset($appConfig->$key) && $appConfig->$key !== '') {
                    $config[$key] = $appConfig->$key;
                }
            }
        } catch (ProgrammingError $e) {
            // The application may not have started yet; env vars still work.
        }

        $config['base_url'] = rtrim((string) $config['base_url'], '/');
        $config['endpoint'] = (string) $config['endpoint'];
        $config['model'] = (string) $config['model'];
        $config['temperature'] = (float) $config['temperature'];
        $config['timeout'] = (int) $config['timeout'];

        return $config;
    }

    /**
     * @param array<int, array<string, string>> $messages
     *
     * @return array<string, mixed>
     */
    private function buildPayload(array $messages)
    {
        if ($this->usesNativeChatApi()) {
            $payload = [
                'model' => $this->config['model'],
                'messages' => $messages,
                'stream' => false,
                'format' => 'json',
                'options' => [
                    'temperature' => $this->config['temperature'],
                ],
            ];

            if ($this->shouldDisableThinking()) {
                $payload['think'] = false;
            }

            return $payload;
        }

        return [
            'model' => $this->config['model'],
            'temperature' => $this->config['temperature'],
            'messages' => $messages,
        ];
    }

    /**
     * @return string
     */
    private function systemPrompt()
    {
        return implode("\n", [
            'You are a conversational assistant for Icinga Web 2.',
            'Stay strictly inside Icinga Web 2, its enabled modules, and their data.',
            'If the request is outside that domain, say so briefly and offer a relevant Icinga alternative.',
            'Return JSON with the keys: reply, query, target, state, mode, actions, reportUrl, chart, followUps, confidence, tokens.',
            'When possible also return routePath and routeParams for a direct Icinga view.',
            'target must be one of: host, service, hostgroup, servicegroup, or null.',
            'state must be one of: up, down, critical, warning, unknown, pending, problem, or null.',
            'mode must be one of: answer, open, search, report, chart, mixed.',
            'actions must be an array of domain actions like open, report, chart, or search.',
            'reportUrl should point to a report creation page when a report is requested and the reporting module is available.',
            'chart should be omitted unless you can describe a chart in a way that is grounded in the Icinga domain.',
            'followUps should contain one or more short clarifying questions when the request is ambiguous.',
            'query should be a short text search string only when there is no better direct route.',
            'Prefer routePath + routeParams over query whenever the intent maps to a known Icinga grid or list.',
            'For problem-focused queries, use direct IcingaDB views such as icingadb/services/grid with problems=true or icingadb/hosts with host.state.is_problem=y.',
            'Do not invent routeParams like service.state or host.state for grid views.',
            'Examples:',
            '  - "Serwisy krytyczne" -> {"reply":"Rozumiem to jako aktywne problemy serwisów.","routePath":"icingadb/services/grid","routeParams":{"problems":true},"target":"service","state":"critical","mode":"open","actions":[{"type":"open","label":"Open result"}],"confidence":"high","tokens":[]}',
            '  - "Hosty z awarią" -> {"reply":"Rozumiem to jako hosty z problemami.","routePath":"icingadb/hosts","routeParams":{"host.state.is_problem":"y"},"target":"host","state":"down","mode":"open","actions":[{"type":"open","label":"Open result"}],"confidence":"high","tokens":[]}',
            '  - "Zrób raport o problemach hostów" -> {"reply":"Mogę przygotować raport z problemów hostów.","mode":"report","reportUrl":"reporting/reports/new?report=host&filter=host.state.is_problem=y","target":"host","state":"problem","confidence":"high","tokens":["raport","problemy","hostow"]}',
            '  - "Hosty prod" -> {"reply":"Rozumiem to jako hosty z etykietą prod.","query":"prod","target":"host","state":null,"mode":"search","confidence":"medium","tokens":["prod"]}',
            'confidence must be one of: low, medium, high.',
            'Do not output markdown or prose outside the JSON object.',
        ]);
    }

    /**
     * @param string $message
     * @param array<string, mixed> $context
     *
     * @return string
     */
    private function userPrompt($message, array $context)
    {
        $parts = [
            'User request: ' . $message,
        ];

        if (! empty($context['capabilities'])) {
            $parts[] = 'Available capabilities: ' . Json::encode($context['capabilities']);
        }

        if (! empty($context['history']) && is_array($context['history'])) {
            $parts[] = 'Conversation history: ' . Json::encode($context['history']);
        }

        if (! empty($context)) {
            $parts[] = 'Known context: ' . Json::encode($context);
        }

        return implode("\n", $parts);
    }

    /**
     * @param array<string, mixed> $context
     *
     * @return array<int, array<string, string>>
     */
    private function historyMessages(array $context)
    {
        if (empty($context['history']) || ! is_array($context['history'])) {
            return [];
        }

        $messages = [];
        foreach ($context['history'] as $entry) {
            if (! is_array($entry)) {
                continue;
            }

            $role = isset($entry['role']) ? (string) $entry['role'] : '';
            $content = isset($entry['content']) ? trim((string) $entry['content']) : '';
            if ($content === '' || ! in_array($role, ['user', 'assistant'], true)) {
                continue;
            }

            $messages[] = [
                'role' => $role,
                'content' => $content,
            ];
        }

        return $messages;
    }

    /**
     * @param array<string, mixed> $payload
     *
     * @return array<string, mixed>
     */
    private function request(array $payload)
    {
        $body = Json::encode($payload);
        $headers = ['Content-Type: application/json'];
        if (! empty($this->config['api_key'])) {
            $headers[] = 'Authorization: Bearer ' . $this->config['api_key'];
        }

        if (function_exists('curl_init')) {
            $curl = curl_init($this->config['base_url'] . $this->config['endpoint']);
            curl_setopt_array($curl, [
                CURLOPT_POST => true,
                CURLOPT_POSTFIELDS => $body,
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_HTTPHEADER => $headers,
                CURLOPT_CONNECTTIMEOUT => $this->config['timeout'],
                CURLOPT_TIMEOUT => $this->config['timeout'],
            ]);

            $response = curl_exec($curl);
            $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
            if ($response === false) {
                $error = curl_error($curl);
                curl_close($curl);
                throw new IcingaException('Assistant request failed: %s', $error ?: 'unknown error');
            }
            curl_close($curl);
        } else {
            $context = stream_context_create([
                'http' => [
                    'method' => 'POST',
                    'header' => implode("\r\n", $headers),
                    'content' => $body,
                    'timeout' => $this->config['timeout'],
                    'ignore_errors' => true,
                ],
            ]);
            $response = @file_get_contents($this->config['base_url'] . $this->config['endpoint'], false, $context);
            $status = isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $match)
                ? (int) $match[1]
                : 0;
            if ($response === false) {
                throw new IcingaException('Assistant request failed');
            }
        }

        if ($status < 200 || $status >= 300) {
            throw new IcingaException('Assistant request failed with HTTP %s', $status);
        }

        return Json::decode($response, true);
    }

    /**
     * @return bool
     */
    private function isLocalEndpoint()
    {
        $host = parse_url($this->config['base_url'], PHP_URL_HOST);
        return in_array($host, ['localhost', '127.0.0.1', '::1'], true);
    }

    /**
     * @return bool
     */
    private function usesNativeChatApi()
    {
        return $this->config['endpoint'] === '/api/chat';
    }

    /**
     * @return bool
     */
    private function shouldDisableThinking()
    {
        return strpos(strtolower($this->config['model']), 'qwen3') === 0;
    }

    /**
     * @param array<string, mixed> $response
     *
     * @return string
     */
    private function extractContent(array $response)
    {
        if (isset($response['message']['content'])) {
            return (string) $response['message']['content'];
        }

        if (isset($response['choices'][0]['message']['content'])) {
            return (string) $response['choices'][0]['message']['content'];
        }

        if (isset($response['output_text'])) {
            return (string) $response['output_text'];
        }

        throw new IcingaException('Assistant response did not include any content');
    }

    /**
     * @param string $content
     *
     * @return array<string, mixed>
     */
    private function decodeContent($content)
    {
        $content = trim($content);
        if ($content === '') {
            throw new IcingaException('Assistant response was empty');
        }

        $decoded = null;
        try {
            $decoded = Json::decode($content, true);
        } catch (\Exception $e) {
            $start = strpos($content, '{');
            $end = strrpos($content, '}');
            if ($start !== false && $end !== false && $end > $start) {
                $decoded = Json::decode(substr($content, $start, $end - $start + 1), true);
            } else {
                throw new IcingaException('Assistant response was not valid JSON');
            }
        }

        if (! is_array($decoded)) {
            throw new IcingaException('Assistant response was not valid JSON');
        }

        return $decoded;
    }
}
