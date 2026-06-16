<?php

// SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

namespace Icinga\Controllers;

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

        if ($openUrl !== null) {
            $actions[] = [
                'type' => ! empty($intent['reportUrl']) ? 'open' : (! empty($intent['query']) ? 'search' : 'open'),
                'label' => ! empty($intent['query'])
                    ? t('Open search results')
                    : t('Open result'),
                'url' => $openUrl,
            ];
        }

        if ($reportUrl !== null) {
            $actions[] = [
                'type' => 'report',
                'label' => t('Create report'),
                'url' => $reportUrl,
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
}
