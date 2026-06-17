<?php

// SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

namespace Icinga\Controllers;

use GuzzleHttp\Psr7\ServerRequest;
use Icinga\Application\Icinga;
require_once __DIR__ . '/../../library/Icinga/Web/Assistant/OpenAiCompatibleClient.php';
require_once __DIR__ . '/../../library/Icinga/Web/Assistant/NaturalLanguageSearchTranslator.php';

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
        $translator = new NaturalLanguageSearchTranslator();
        $intent = $translator->translate($message, $this->getAssistantContext($history));
        $searchUrl = null;
        $openUrl = null;
        $reportUrl = null;
        $actions = [];

        if (! empty($intent['routePath'])) {
            $openUrl = Url::fromPath($intent['routePath'], $intent['routeParams'])->getAbsoluteUrl();
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
                'routePath' => $intent['routePath'],
                'routeParams' => $intent['routeParams'],
                'mode'      => $intent['mode'],
                'actions'   => $actions,
                'chart'     => $intent['chart'],
                'followUps' => $intent['followUps'],
                'target'    => $intent['target'],
                'state'     => $intent['state'],
                'tokens'    => $intent['tokens'],
                'confidence'=> $intent['confidence'],
                'source'    => $intent['source'],
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
        require_once '/usr/share/icingaweb2/modules/reporting/library/Reporting/Reports/OutageReport.php';
        require_once '/usr/share/icingaweb2/modules/icingadb/library/Icingadb/ProvidedHook/Reporting/HostSlaReport.php';
        require_once '/usr/share/icingaweb2/modules/icingadb/library/Icingadb/ProvidedHook/Reporting/ServiceSlaReport.php';

        $this->assertPermission('reporting/reports');
        $this->view->title = t('AI Prefilled Report');

        $reportletClass = trim((string) $this->params->get('reportlet', ''));
        if ($reportletClass === '') {
            $reportletClass = $this->resolveAssistantReportletClass((string) $this->params->get('report', ''));
        }
        $reportletClass = $this->normalizeAssistantReportletValue($reportletClass);

        $timeframeId = trim((string) $this->params->get('timeframe', ''));
        if ($timeframeId === '') {
            $timeframeId = (string) $this->resolveAssistantTimeframeId((string) $this->params->get('timeframe_name', ''));
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
            ->on(\Icinga\Module\Reporting\Web\Forms\ReportForm::ON_SUCCESS, function (\Icinga\Module\Reporting\Web\Forms\ReportForm $form) {
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
            })
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
     * @return array<string, mixed>
     */
    private function getAssistantCapabilities()
    {
        $modules = [];
        $moduleManager = Icinga::app()->getModuleManager()->loadEnabledModules();
        foreach ($moduleManager->getLoadedModules() as $module) {
            $modules[] = $module->getName();
        }

        sort($modules);

        return [
            'modules' => $modules,
            'icingadb' => in_array('icingadb', $modules, true),
            'reporting' => in_array('reporting', $modules, true),
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
