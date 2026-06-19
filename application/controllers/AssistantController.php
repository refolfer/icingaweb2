<?php

// SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

namespace Icinga\Controllers;

use GuzzleHttp\Psr7\ServerRequest;
use Icinga\Application\Icinga;
use Icinga\Web\Assistant\IcingaAgentToolbox;
use Icinga\Web\Assistant\OpenAiCompatibleClient;
use Icinga\Web\Assistant\NaturalLanguageSearchTranslator;
use Icinga\Web\Controller\ActionController;
use Icinga\Web\Url;

class AssistantController extends ActionController
{
    public function indexAction()
    {
        $this->view->title = t('AI Search');
        $this->view->assistantEndpoint = Url::fromPath('assistant/respond')->getAbsoluteUrl();
        $this->view->searchUrl = Url::fromPath('search')->getAbsoluteUrl();
        $this->view->assistantCapabilities = $this->getAssistantCapabilities();
        $this->view->examples = [
            t('Hosty prod'),
            t('Serwisy krytyczne'),
            t('Hosty z błędem w nazwie db'),
            t('Zrób raport o problemach hostów'),
        ];
    }

    public function respondAction()
    {
        if (! $this->getRequest()->isPost()) {
            $this->getResponse()->json()
                ->setFailData(['message' => t('Use POST for assistant replies.')])
                ->sendResponse();
            return;
        }

        $message = trim((string) $this->getRequest()->getPost('message', ''));
        if ($message === '') {
            $this->getResponse()->json()
                ->setFailData(['message' => t('Please enter a search request.')])
                ->sendResponse();
            return;
        }

        $history = $this->decodeHistory((string) $this->getRequest()->getPost('history', ''));
        $assistantContext = $this->getAssistantContext($history);
        $translator = new NaturalLanguageSearchTranslator();
        $intent = $translator->translate($message, $assistantContext);
        $searchUrl = null;
        $openUrl = null;
        $reportUrl = null;
        $dashboardUrl = null;
        $actions = [];
        $toolData = $this->emptyToolData();
        $toolbox = new IcingaAgentToolbox();
        if ($this->shouldInspectWithToolbox($message, $intent)) {
            try {
                $toolData = $toolbox->inspect($message, $intent, $this->buildToolboxOptions($message, $intent));
            } catch (\Throwable $e) {
                $toolData = $this->emptyToolData();
            }
        }
        $agentReply = $this->buildAgentReply($message, $intent, $toolData, $assistantContext);

        if (! empty($agentReply['reply'])) {
            $intent['reply'] = $agentReply['reply'];
        }

        if (! empty($agentReply['followUps']) && is_array($agentReply['followUps'])) {
            $intent['followUps'] = $agentReply['followUps'];
        }

        if (! empty($agentReply['chart']) && is_array($agentReply['chart'])) {
            $intent['chart'] = $agentReply['chart'];
        }

        if (! empty($agentReply['confidence']) && is_string($agentReply['confidence'])) {
            $intent['confidence'] = $agentReply['confidence'];
        }

        if (! empty($toolData['available'])) {
            $intent['source'] = $intent['source'] . '+tools';
        }

        if (! empty($toolData['dashboardDraft']['draftPath'])) {
            $dashboardUrl = Url::fromPath(
                $toolData['dashboardDraft']['draftPath'],
                isset($toolData['dashboardDraft']['draftParams'])
                    && is_array($toolData['dashboardDraft']['draftParams'])
                    ? $toolData['dashboardDraft']['draftParams']
                    : []
            )->getAbsoluteUrl();
        }

        if (! empty($intent['routePath'])) {
            if (! empty($intent['routeQuery']) && is_string($intent['routeQuery'])) {
                $openUrl = Url::fromPath($intent['routePath'])->getAbsoluteUrl()
                    . '?' . ltrim((string) $intent['routeQuery'], '?');
            } else {
                $openUrl = Url::fromPath($intent['routePath'], $intent['routeParams'])->getAbsoluteUrl();
            }
        } elseif (! empty($intent['query'])) {
            $searchUrl = Url::fromPath('search', ['q' => $intent['query']])->getAbsoluteUrl();
            $openUrl = $searchUrl;
        }

        if (! empty($intent['reportUrl'])) {
            $reportPath = $intent['reportUrl'];
            $reportParams = [];
            if (strpos($reportPath, '?') !== false) {
                list($reportPath, $reportQuery) = explode('?', $reportPath, 2);
                parse_str($reportQuery, $reportParams);
            }
            $reportUrl = Url::fromPath($reportPath, $reportParams)->getAbsoluteUrl();
        }

        if ($reportUrl !== null) {
            $actions[] = [
                'type' => 'report',
                'label' => t('Create report'),
                'url' => $reportUrl,
            ];
        }

        if ($dashboardUrl !== null) {
            $actions[] = [
                'type' => 'open',
                'label' => t('Create dashboard'),
                'url' => $dashboardUrl,
            ];
        }

        if ($openUrl !== null) {
            $actions[] = [
                'type' => ! empty($intent['query']) ? 'search' : 'open',
                'label' => ! empty($intent['query'])
                    ? t('Open search results')
                    : t('Open result'),
                'url' => $openUrl,
            ];
        }

        $this->getResponse()->json()
            ->setSuccessData([
                'message'   => $intent['reply'],
                'query'     => $intent['query'],
                'searchUrl' => $searchUrl,
                'openUrl'   => $openUrl,
                'reportUrl' => $reportUrl,
                'dashboardUrl' => $dashboardUrl,
                'routePath' => $intent['routePath'],
                'routeParams' => $intent['routeParams'],
                'routeQuery' => isset($intent['routeQuery']) ? $intent['routeQuery'] : null,
                'mode'      => $intent['mode'],
                'actions'   => $actions,
                'chart'     => $intent['chart'],
                'followUps' => $intent['followUps'],
                'target'    => $intent['target'],
                'state'     => $intent['state'],
                'tokens'    => $intent['tokens'],
                'confidence'=> $intent['confidence'],
                'source'    => $intent['source'],
                'agentScope'=> isset($toolData['scope']) ? $toolData['scope'] : [],
            ])
            ->sendResponse();
    }

    public function reportAction()
    {
        if (! Icinga::app()->getModuleManager()->hasEnabled('reporting')) {
            $this->httpNotFound(t('The reporting module is not enabled.'));
            return;
        }

        require_once '/usr/share/icingaweb2/modules/reporting/application/controllers/ReportsController.php';
        require_once '/usr/share/icingaweb2/modules/reporting/library/Reporting/Database.php';
        require_once '/usr/share/icingaweb2/modules/reporting/library/Reporting/Web/Forms/ReportForm.php';
        require_once '/usr/share/icingaweb2/modules/reporting/library/Reporting/Reports/'
            . 'OutageReport.php';
        require_once '/usr/share/icingaweb2/modules/icingadb/library/Icingadb/ProvidedHook/Reporting/HostSlaReport.php';
        require_once '/usr/share/icingaweb2/modules/icingadb/library/Icingadb/ProvidedHook/Reporting/'
            . 'ServiceSlaReport.php';

        $this->assertPermission('reporting/reports');
        $this->view->title = t('AI Prefilled Report');

        $reportletClass = trim((string) $this->params->get('reportlet', ''));
        if ($reportletClass === '') {
            $reportletClass = $this->resolveAssistantReportletClass((string) $this->params->get('report', ''));
        }
        $reportletClass = $this->normalizeAssistantReportletValue($reportletClass);

        $timeframeId = trim((string) $this->params->get('timeframe', ''));
        if ($timeframeId === '') {
            $timeframeId = (string) $this->resolveAssistantTimeframeId(
                (string) $this->params->get('timeframe_name', '')
            );
        }

        $prefill = [
            'name'      => trim((string) $this->params->get('name', '')),
            'timeframe' => $timeframeId,
            'reportlet' => $reportletClass,
            'filter'    => trim((string) $this->params->get('filter', '')),
            'breakdown' => trim((string) $this->params->get('breakdown', '')),
            'sla_chart' => trim((string) $this->params->get('sla_chart', '')),
            'outage_object_type' => trim((string) $this->params->get('outage_object_type', '')),
            'outage_filter'      => trim((string) $this->params->get('outage_filter', '')),
            'outage_service_state' => trim((string) $this->params->get('outage_service_state', '')),
        ];

        $prefill = array_filter($prefill, function ($value) {
            return $value !== null && $value !== '';
        });

        $form = (new \Icinga\Module\Reporting\Web\Forms\ReportForm(\Icinga\Module\Reporting\Database::get()))
            ->setAction((string) Url::fromRequest())
            ->setRenderCreateAndShowButton($reportletClass !== null)
            ->populate($prefill)
            ->on(
                \Icinga\Module\Reporting\Web\Forms\ReportForm::ON_SUCCESS,
                function (\Icinga\Module\Reporting\Web\Forms\ReportForm $form) {
                    \Icinga\Web\Notification::success(t('Created report successfully'));

                    $pressedButton = $form->getPressedSubmitElement();
                    if ($pressedButton && $pressedButton->getName() !== 'create_show') {
                        $this->closeModalAndRefreshRelatedView(Url::fromPath('reporting/reports'));
                    } else {
                        $this->redirectNow(
                            Url::fromPath(sprintf(
                                'reporting/reports#!%s',
                                Url::fromPath('reporting/report', ['id' => $form->getId()])->getAbsoluteUrl()
                            ))
                        );
                    }
                }
            )
            ->handleRequest(ServerRequest::fromGlobals());

        $this->view->prefillHint = t(
            'This report form was prefilled from the AI conversation. Review the fields before creating the report.'
        );
        $this->view->form = $form;
        $this->view->reportletValue = $reportletClass;
    }

    /**
     * @param array<int, array<string, string>> $history
     *
     * @return array<string, mixed>
     */
    private function getAssistantContext(array $history)
    {
        return [
            'capabilities' => $this->getAssistantCapabilities(),
            'history' => $history,
        ];
    }

    /**
     * @param string $message
     * @param array<string, mixed> $intent
     * @param array<string, mixed> $toolData
     * @param array<string, mixed> $assistantContext
     *
     * @return array<string, mixed>
     */
    private function buildAgentReply($message, array $intent, array $toolData, array $assistantContext)
    {
        if (empty($toolData['available'])) {
            return [];
        }

        $fallback = $this->buildDeterministicAgentReply($message, $intent, $toolData);
        if ($this->shouldPreferDeterministicAgentReply($intent, $toolData)) {
            return $fallback;
        }

        try {
            $client = new OpenAiCompatibleClient();
            $reply = $client->answerWithData(
                $message,
                $intent,
                $this->compactToolDataForLlm($toolData, $intent),
                $this->compactAssistantContextForLlm($assistantContext)
            );

            if (empty($reply['reply']) || ! is_string($reply['reply'])) {
                return $fallback;
            }

            return $reply + $fallback;
        } catch (\Throwable $e) {
            return $fallback;
        }
    }

    /**
     * @param array<string, mixed> $intent
     * @param array<string, mixed> $toolData
     *
     * @return bool
     */
    private function shouldPreferDeterministicAgentReply(array $intent, array $toolData)
    {
        $routePath = isset($intent['routePath']) ? (string) $intent['routePath'] : '';
        $source = isset($intent['source']) ? (string) $intent['source'] : '';
        $confidence = isset($intent['confidence']) ? (string) $intent['confidence'] : '';

        if ($routePath !== '' && $source === 'local' && $confidence === 'high') {
            return true;
        }

        if ($routePath === 'icingadb/history' || $routePath === 'dashboard') {
            return true;
        }

        if (! empty($toolData['dashboardDraft'])) {
            return true;
        }

        return false;
    }

    /**
     * @param string $message
     * @param array<string, mixed> $intent
     *
     * @return bool
     */
    private function shouldInspectWithToolbox($message, array $intent)
    {
        $routePath = isset($intent['routePath']) ? (string) $intent['routePath'] : '';
        $mode = isset($intent['mode']) ? (string) $intent['mode'] : '';
        $source = isset($intent['source']) ? (string) $intent['source'] : '';
        $confidence = isset($intent['confidence']) ? (string) $intent['confidence'] : '';

        if ($routePath === 'dashboard' || $this->isDashboardIntent($message)) {
            return true;
        }

        if ($routePath === 'icingadb/history' || $this->isHistoryIntent($message)) {
            return true;
        }

        if ($mode === 'report' || $mode === 'chart') {
            return true;
        }

        if ($routePath !== '' && $source === 'local' && $confidence === 'high') {
            return false;
        }

        return true;
    }

    /**
     * @param string $message
     * @param array<string, mixed> $intent
     *
     * @return array<string, bool>
     */
    private function buildToolboxOptions($message, array $intent)
    {
        $routePath = isset($intent['routePath']) ? (string) $intent['routePath'] : '';
        $mode = isset($intent['mode']) ? (string) $intent['mode'] : '';
        $query = isset($intent['query']) ? trim((string) $intent['query']) : '';
        $target = isset($intent['target']) ? (string) $intent['target'] : '';
        $source = isset($intent['source']) ? (string) $intent['source'] : '';
        $confidence = isset($intent['confidence']) ? (string) $intent['confidence'] : '';
        $isHistory = $routePath === 'icingadb/history' || $this->isHistoryIntent($message);
        $isDashboard = $routePath === 'dashboard' || $this->isDashboardIntent($message);
        $isDirectHighConfidenceRoute = $routePath !== '' && $source === 'local' && $confidence === 'high';

        return [
            'fetchSummaries' => ! $isDashboard,
            'fetchItems' => ! $isHistory
                && ! $isDashboard
                && ! $isDirectHighConfidenceRoute
                && ($query !== '' || $target !== '' || $mode === 'mixed' || $mode === 'answer'),
            'fetchHistory' => $isHistory,
            'fetchDashboards' => $isDashboard,
            'fetchDashboardDraft' => $isDashboard,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function emptyToolData()
    {
        return [
            'available' => false,
            'scope' => [],
            'summaries' => [],
            'items' => [],
            'history' => [],
            'dashboards' => [],
            'dashboardDraft' => null,
        ];
    }

    /**
     * @param string $message
     *
     * @return bool
     */
    private function isHistoryIntent($message)
    {
        $normalized = mb_strtolower((string) $message, 'UTF-8');

        foreach (['historia', 'historie', 'history', 'zdarzen', 'zdarzenia', 'zdarzeń', 'event', 'events'] as $token) {
            if (mb_strpos($normalized, $token) !== false) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param string $message
     *
     * @return bool
     */
    private function isDashboardIntent($message)
    {
        $normalized = mb_strtolower((string) $message, 'UTF-8');

        foreach (['dashboard', 'dashlet', 'pulpit', 'panel'] as $token) {
            if (mb_strpos($normalized, $token) !== false) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param string $message
     * @param array<string, mixed> $intent
     * @param array<string, mixed> $toolData
     *
     * @return array<string, mixed>
     */
    private function buildDeterministicAgentReply($message, array $intent, array $toolData)
    {
        $routePath = isset($intent['routePath']) ? (string) $intent['routePath'] : '';
        $target = isset($intent['target']) ? (string) $intent['target'] : '';
        $state = isset($intent['state']) ? (string) $intent['state'] : '';
        $items = isset($toolData['items']) && is_array($toolData['items']) ? $toolData['items'] : [];
        $history = isset($toolData['history']) && is_array($toolData['history']) ? $toolData['history'] : [];

        if ($routePath === 'icingadb/history') {
            $count = count($history);
            $latest = $count > 0 ? $history[0] : null;
            $reply = $count > 0
                ? sprintf(
                    'Mogę otworzyć historię zdarzeń. Widzę %d ostatnich wpisów%s.',
                    $count,
                    $latest && ! empty($latest['host_name'])
                        ? sprintf('; najnowszy dotyczy obiektu %s', (string) $latest['host_name'])
                        : ''
                )
                : 'Mogę otworzyć historię zdarzeń. W podglądzie nie widzę teraz żadnych dopasowanych wpisów.';

            return [
                'reply' => $reply,
                'confidence' => 'high',
                'followUps' => [],
            ];
        }

        if (! empty($toolData['dashboardDraft'])) {
            return [
                'reply' => 'Mogę przygotować dashboard na podstawie tego zapytania. '
                    . 'Otworzę gotowy szkic dashletu, żeby dało się go od razu '
                    . 'zapisać w Icinga Web.',
                'confidence' => 'high',
                'followUps' => [],
            ];
        }

        $matches = [];
        if ($target === 'host' && ! empty($items['hosts']) && is_array($items['hosts'])) {
            $matches = $items['hosts'];
        } elseif ($target === 'service' && ! empty($items['services']) && is_array($items['services'])) {
            $matches = $items['services'];
        } elseif (! empty($items['services']) && is_array($items['services'])) {
            $matches = $items['services'];
        } elseif (! empty($items['hosts']) && is_array($items['hosts'])) {
            $matches = $items['hosts'];
        }

        if (! empty($matches)) {
            $names = [];
            foreach (array_slice($matches, 0, 3) as $item) {
                if (! is_array($item)) {
                    continue;
                }

                if (! empty($item['host_name']) && ! empty($item['display_name'])) {
                    $names[] = sprintf('%s / %s', (string) $item['host_name'], (string) $item['display_name']);
                } elseif (! empty($item['display_name'])) {
                    $names[] = (string) $item['display_name'];
                } elseif (! empty($item['name'])) {
                    $names[] = (string) $item['name'];
                }
            }

            $reply = sprintf(
                'Znalazłem %d pasujących %s%s.',
                count($matches),
                $target === 'host' ? 'hostów' : ($target === 'service' ? 'serwisów' : 'obiektów'),
                ! empty($names) ? ' Przykłady: ' . implode(', ', $names) . '.' : ''
            );

            return [
                'reply' => $reply,
                'confidence' => 'high',
                'followUps' => [],
            ];
        }

        return [
            'reply' => 'Mogę otworzyć wynik w Icinga Web i dalej go doprecyzować, '
                . 'ale w szybkim podglądzie nie widzę teraz jednoznacznego '
                . 'dopasowania do zapytania: ' . trim((string) $message),
            'confidence' => 'medium',
            'followUps' => [],
        ];
    }

    /**
     * @param array<string, mixed> $toolData
     * @param array<string, mixed> $intent
     *
     * @return array<string, mixed>
     */
    private function compactToolDataForLlm(array $toolData, array $intent)
    {
        $target = isset($intent['target']) ? (string) $intent['target'] : '';
        $isHistory = isset($intent['routePath']) && $intent['routePath'] === 'icingadb/history';
        $isDashboard = ! empty($toolData['dashboardDraft']);

        $items = [];
        if ($target === 'host' && ! empty($toolData['items']['hosts'])) {
            $items['hosts'] = array_slice($toolData['items']['hosts'], 0, 3);
        } elseif ($target === 'service' && ! empty($toolData['items']['services'])) {
            $items['services'] = array_slice($toolData['items']['services'], 0, 3);
        } else {
            if (! empty($toolData['items']['hosts'])) {
                $items['hosts'] = array_slice($toolData['items']['hosts'], 0, 2);
            }
            if (! empty($toolData['items']['services'])) {
                $items['services'] = array_slice($toolData['items']['services'], 0, 2);
            }
        }

        $scope = isset($toolData['scope']) && is_array($toolData['scope'])
            ? $toolData['scope']
            : [];
        $summaries = isset($toolData['summaries']) && is_array($toolData['summaries'])
            ? $toolData['summaries']
            : [];

        return [
            'available' => ! empty($toolData['available']),
            'scope' => array_slice($scope, 0, 8),
            'summaries' => $summaries,
            'items' => $items,
            'history' => $isHistory && ! empty($toolData['history']) && is_array($toolData['history'])
                ? array_slice($toolData['history'], 0, 5)
                : [],
            'dashboards' => $isDashboard && ! empty($toolData['dashboards']) && is_array($toolData['dashboards'])
                ? array_slice($toolData['dashboards'], 0, 3)
                : [],
            'dashboardDraft' => $isDashboard ? $toolData['dashboardDraft'] : null,
        ];
    }

    /**
     * @param array<string, mixed> $assistantContext
     *
     * @return array<string, mixed>
     */
    private function compactAssistantContextForLlm(array $assistantContext)
    {
        return [
            'history' => ! empty($assistantContext['history']) && is_array($assistantContext['history'])
                ? array_slice($assistantContext['history'], -4)
                : [],
            'capabilities' => [
                'modules' => ! empty($assistantContext['capabilities']['modules'])
                    ? array_values(array_slice($assistantContext['capabilities']['modules'], 0, 10))
                    : [],
                'reporting' => ! empty($assistantContext['capabilities']['reporting']),
                'icingadb' => ! empty($assistantContext['capabilities']['icingadb']),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function getAssistantCapabilities()
    {
        $modules = [];
        $reportingEnabled = false;
        $timeframes = [];
        $templates = [];
        $moduleManager = Icinga::app()->getModuleManager()->loadEnabledModules();
        foreach ($moduleManager->getLoadedModules() as $module) {
            $modules[] = $module->getName();
        }

        sort($modules);
        $reportingEnabled = in_array('reporting', $modules, true);

        if ($reportingEnabled) {
            try {
                require_once '/usr/share/icingaweb2/modules/reporting/library/Reporting/Database.php';
                $timeframes = array_values(\Icinga\Module\Reporting\Database::listTimeframes());
                $templates = array_values(\Icinga\Module\Reporting\Database::listTemplates());
            } catch (\Throwable $e) {
                $timeframes = [];
                $templates = [];
            }
        }

        return [
            'modules' => $modules,
            'icingadb' => in_array('icingadb', $modules, true),
            'reporting' => $reportingEnabled,
            'history' => in_array('icingadb', $modules, true),
            'dashboards' => [
                'openPath' => 'dashboard',
                'createPath' => 'dashboard/new-dashlet',
                'supportsDraftDashlets' => true,
            ],
            'reportingBuilder' => [
                'fields' => [
                    'Name',
                    'Timeframe',
                    'Report',
                    'Filter',
                    'Breakdown',
                    'SLA Visualization',
                ],
                'reportTypes' => [
                    'Host SLA Report',
                    'Service SLA Report',
                    'Outage Report (Icinga DB)',
                ],
                'timeframes' => $timeframes,
                'templates' => $templates,
                'breakdownOptions' => [
                    'None',
                    'Hour',
                    'Day',
                    'Week',
                    'Month',
                ],
                'slaVisualizationOptions' => [
                    'Table',
                    'Horizontal Bars',
                    'Columns',
                    'Availability Balance Columns',
                    'Pie Charts',
                ],
                'outageObjectsOptions' => [
                    'Hosts and Services',
                    'Hosts',
                    'Services',
                ],
                'outageServiceStateOptions' => [
                    'Critical',
                    'Critical and Warning',
                ],
                'notes' => [
                    'Template is also available in the report form.',
                    'SLA Visualization applies to SLA reports.',
                    'Filter uses the reporting/filter/objects syntax from Icinga DB object filters.',
                ],
            ],
        ];
    }

    /**
     * @param string $json
     *
     * @return array<int, array<string, string>>
     */
    private function decodeHistory($json)
    {
        $json = trim($json);
        if ($json === '') {
            return [];
        }

        try {
            $decoded = \Icinga\Util\Json::decode($json, true);
        } catch (\Exception $e) {
            return [];
        }

        if (! is_array($decoded)) {
            return [];
        }

        $history = [];
        foreach ($decoded as $entry) {
            if (! is_array($entry)) {
                continue;
            }
            $role = isset($entry['role']) ? (string) $entry['role'] : '';
            $content = isset($entry['content']) ? trim((string) $entry['content']) : '';
            if ($content === '' || ! in_array($role, ['user', 'assistant'], true)) {
                continue;
            }

            $history[] = [
                'role' => $role,
                'content' => $content,
            ];
        }

        return $history;
    }

    /**
     * @param string $report
     *
     * @return ?string
     */
    private function resolveAssistantReportletClass($report)
    {
        switch (strtolower(trim($report))) {
            case 'host':
                return \Icinga\Module\Icingadb\ProvidedHook\Reporting\HostSlaReport::class;
            case 'service':
                return \Icinga\Module\Icingadb\ProvidedHook\Reporting\ServiceSlaReport::class;
            case 'outage':
                return '\\' . \Icinga\Module\Reporting\Reports\OutageReport::class;
            default:
                return null;
        }
    }

    /**
     * @param string $timeframeName
     *
     * @return ?string
     */
    private function resolveAssistantTimeframeId($timeframeName)
    {
        $timeframeName = trim($timeframeName);
        if ($timeframeName === '') {
            return null;
        }

        $timeframes = \Icinga\Module\Reporting\Database::listTimeframes();
        $normalizedNeedle = $this->normalizeAssistantTimeframeName($timeframeName);

        foreach ($timeframes as $id => $name) {
            if ($this->normalizeAssistantTimeframeName((string) $name) === $normalizedNeedle) {
                return (string) $id;
            }
        }

        return null;
    }

    /**
     * @param string $value
     *
     * @return string
     */
    private function normalizeAssistantTimeframeName($value)
    {
        $value = strtolower(trim($value));
        $value = str_replace(['-', '_'], ' ', $value);
        $value = preg_replace('/\s+/', ' ', $value);

        switch ($value) {
            case 'last 24 hours':
                return '25 hours';
            case 'last 7 days':
                return 'one week';
            case 'last 30 days':
                return 'one month';
            default:
                return $value;
        }
    }

    /**
     * @param ?string $value
     *
     * @return ?string
     */
    private function normalizeAssistantReportletValue($value)
    {
        $value = trim((string) $value);
        if ($value === '') {
            return null;
        }

        if ($value === \Icinga\Module\Reporting\Reports\OutageReport::class) {
            return '\\' . $value;
        }

        return $value;
    }
}
