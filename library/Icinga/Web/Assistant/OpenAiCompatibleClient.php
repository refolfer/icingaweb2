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
     * @param array<string, string> $context
     *
     * @return array<string, mixed>
     */
    public function interpret($message, array $context = [])
    {
        if (! $this->isConfigured()) {
            throw new IcingaException('Assistant LLM is not configured');
        }

        $payload = [
            'model' => $this->config['model'],
            'temperature' => $this->config['temperature'],
            'messages' => [
                [
                    'role' => 'system',
                    'content' => $this->systemPrompt()
                ],
                [
                    'role' => 'user',
                    'content' => $this->userPrompt($message, $context)
                ],
            ],
        ];

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
            'endpoint' => (string) (getenv('ICINGAWEB_ASSISTANT_ENDPOINT') ?: '/v1/chat/completions'),
            'model' => (string) (getenv('ICINGAWEB_ASSISTANT_MODEL') ?: 'gpt-4o-mini'),
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
     * @return string
     */
    private function systemPrompt()
    {
        return implode("\n", [
            'You are a search assistant for Icinga Web 2.',
            'Convert natural language into a concise search intent.',
            'Return JSON with the keys: reply, query, target, state, confidence, tokens.',
            'When possible also return routePath and routeParams for a direct Icinga view.',
            'target must be one of: host, service, hostgroup, servicegroup, or null.',
            'state must be one of: up, down, critical, warning, unknown, pending, problem, or null.',
            'query should be a short text search string only when there is no better direct route.',
            'Prefer routePath + routeParams over query whenever the intent maps to a known Icinga grid or list.',
            'For problem-focused queries, use direct IcingaDB views such as icingadb/services/grid or icingadb/hosts/grid with problems=true.',
            'Do not invent routeParams like service.state or host.state for grid views.',
            'Examples:',
            '  - "Serwisy krytyczne" -> {"reply":"Rozumiem to jako aktywne problemy serwisów.","routePath":"icingadb/services/grid","routeParams":{"problems":true},"target":"service","state":"critical","confidence":"high","tokens":[]}',
            '  - "Hosty z awarią" -> {"reply":"Rozumiem to jako aktywne problemy hostów.","routePath":"icingadb/hosts/grid","routeParams":{"problems":true},"target":"host","state":"down","confidence":"high","tokens":[]}',
            '  - "Hosty prod" -> {"reply":"Rozumiem to jako hosty z etykietą prod.","query":"prod","target":"host","state":null,"confidence":"medium","tokens":["prod"]}',
            'confidence must be one of: low, medium, high.',
            'Do not output markdown or prose outside the JSON object.',
        ]);
    }

    /**
     * @param string $message
     * @param array<string, string> $context
     *
     * @return string
     */
    private function userPrompt($message, array $context)
    {
        $parts = [
            'User request: ' . $message,
        ];

        if (! empty($context)) {
            $parts[] = 'Known context: ' . Json::encode($context);
        }

        return implode("\n", $parts);
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
     * @param array<string, mixed> $response
     *
     * @return string
     */
    private function extractContent(array $response)
    {
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
