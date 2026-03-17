<?php

/* Icinga Web 2 | (c) 2026 Icinga GmbH | GPLv2+ */

namespace Icinga\Forms\Config\General;

use Icinga\Application\Config;
use Icinga\Util\Csp;
use Icinga\Web\Session;
use ipl\Web\Common\CalloutType;
use ipl\Web\Common\CsrfCounterMeasure;
use ipl\Web\Common\FormUid;
use ipl\Web\Compat\CompatForm;
use ipl\Web\Widget\Callout;

class CspConfigForm extends CompatForm
{
    use FormUid;
    use CsrfCounterMeasure;

    protected bool $changed = false;

    public function __construct(protected Config $config)
    {
        $this->setAttribute("name", "csp_config");
        $this->applyDefaultElementDecorators();
    }

    protected function assemble(): void
    {
        $this->addElement($this->createUidElement());

        $this->addCsrfCounterMeasure(Session::getSession()->getId());

        $this->addElement(
            'checkbox',
            'use_strict_csp',
            [
                'label'          => $this->translate('Enable strict CSP'),
                'description'    => $this->translate(
                    'Set whether to use strict content security policy (CSP).'
                    . ' This setting helps to protect from cross-site scripting (XSS).',
                ),
                'class'          => 'autosubmit',
                'checkedValue'   => '1',
                'uncheckedValue' => '0',
            ],
        );

        if (! $this->isCspEnabled()) {
            $this->addElement('hidden', 'use_custom_csp');
            $this->addElement('hidden', 'custom_csp');
        } else {
            $this->addElement(
                'checkbox',
                'use_custom_csp',
                [
                    'label'          => $this->translate('Enable Custom CSP'),
                    'description'    => $this->translate(
                        'Specify whether to use a custom, user provided, string as the CSP-Header.',
                    ),
                    'class'          => 'autosubmit',
                    'checkedValue'   => '1',
                    'uncheckedValue' => '0',
                ],
            );

            if ($this->isCustomCspEnabled()) {
                $this->addHtml((new Callout(
                    CalloutType::Warning,
                    $this->translate(
                        'Be aware that the custom CSP-Header completely overrides the automatically generated one.'
                        . ' This means that you are solely responsible for keeping the custom CSP-Header up-to-date'
                        . ' and secure.',
                    ),
                    $this->translate('Warning: Use at your own risk!'),
                ))->setFormElement());

                $this->addElement('textarea', 'custom_csp', [
                    'label'       => $this->translate('Custom CSP'),
                    'description' => $this->translate(
                        'Set a custom CSP-Header. This completely overrides the automatically generated one.'
                        . ' Use the placeholder {style_nonce} to insert the automatically generated style nonce.',
                    ),
                ]);
            } else {
                $this->addElement('hidden', 'custom_csp');

                Csp::createNonce();
                $this->addElement('textarea', 'generated_csp', [
                    'label'       => $this->translate('Generated CSP'),
                    'description' => $this->translate(
                        'This is the current CSP-Header. You can always safely go back to this by disabling the'
                        . ' Enable Custom CSP checkbox above.',
                    ),
                    'disabled'    => true,
                    'value'       => Csp::getAutomaticHeaderValue(),
                ]);
            }
        }

        $this->addElement('submit', 'submit', [
            'label' => t('Save changes'),
        ]);
    }

    protected function onSuccess(): void
    {
        $config = Config::app();

        $section = $config->getSection('security');
        $beforeSection = clone $section;
        $section['use_strict_csp'] = $this->getValue('use_strict_csp');
        if ($this->isCspEnabled()) {
            $section['use_custom_csp'] = $this->getValue('use_custom_csp');
            if ($this->isCustomCspEnabled()) {
                $section['custom_csp'] = $this->getValue('custom_csp');
            }
        }

        $this->changed = ! empty(array_diff_assoc(
            iterator_to_array($section),
            iterator_to_array($beforeSection)
        ));

        if (! $this->changed) {
            return;
        }

        $config->saveIni();
    }

    public function hasConfigChanged(): bool
    {
        return $this->changed;
    }

    public function isCspEnabled(): bool
    {
        return $this->getValue('use_strict_csp') === '1';
    }

    public function isCustomCspEnabled(): bool
    {
        return $this->getValue('use_custom_csp') === '1';
    }
}
