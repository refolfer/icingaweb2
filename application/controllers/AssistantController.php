<?php

// SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

namespace Icinga\Controllers;

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
        $this->view->examples = [
            t('Hosty prod'),
            t('Serwisy krytyczne'),
            t('Hosty z błędem w nazwie db'),
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

        $translator = new NaturalLanguageSearchTranslator();
        $intent = $translator->translate($message);
        $searchUrl = null;

        if (! empty($intent['query'])) {
            $searchUrl = Url::fromPath('search', ['q' => $intent['query']])->getAbsoluteUrl();
        }

        $this->getResponse()->json()
            ->setSuccessData([
                'message'   => $intent['reply'],
                'query'     => $intent['query'],
                'searchUrl' => $searchUrl,
                'target'    => $intent['target'],
                'state'     => $intent['state'],
                'tokens'    => $intent['tokens'],
                'confidence'=> $intent['confidence'],
                'source'    => $intent['source'],
            ])
            ->sendResponse();
    }
}
