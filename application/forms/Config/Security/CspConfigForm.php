<?php

/* Icinga Web 2 | (c) 2026 Icinga GmbH | GPLv2+ */

namespace Icinga\Forms\Config\Security;

use Exception;
use Icinga\Application\Config;
use Icinga\Data\ConfigObject;
use Icinga\Security\Csp\LoadedCsp;
use Icinga\Security\Csp\Reason\CspReason;
use Icinga\Security\Csp\Reason\DashboardCspReason;
use Icinga\Security\Csp\Reason\ModuleCspReason;
use Icinga\Security\Csp\Reason\NavigationCspReason;
use Icinga\Security\Csp\Reason\StaticCspReason;
use Icinga\Util\Csp;
use Icinga\Web\Session;
use ipl\Html\Attributes;
use ipl\Html\BaseHtmlElement;
use ipl\Html\HtmlElement;
use ipl\Html\Table;
use ipl\Html\Text;
use ipl\Validator\CallbackValidator;
use ipl\Web\Common\CalloutType;
use ipl\Web\Common\Csp as CspInstance;
use ipl\Web\Common\CsrfCounterMeasure;
use ipl\Web\Common\FormUid;
use ipl\Web\Compat\CompatForm;
use ipl\Web\Widget\Callout;
use ipl\Web\Widget\Icon;
use ipl\Web\Widget\Link;

class CspConfigForm extends CompatForm
{
    use FormUid;
    use CsrfCounterMeasure;

    /** @var string[] */
    protected const SECURE_KEYWORDS = [
        "'self'",
        "'none'",
        "'strict-dynamic'",
        "'report-sample'",
        "'report-sha256'",
        "'report-sha384'",
        "'report-sha512'",
    ];

    /** @var string[] */
    protected const WARNING_KEYWORDS = [
        "'unsafe-inline'",
        "'unsafe-eval'",
        "'unsafe-hashes'",
    ];

    /** @var string[] */
    protected const SECURE_SCHEMAS = [
        'https',
        'wss',
    ];

    /** @var string[] */
    protected const WARNING_SCHEMAS = [
        'http',
        'ws',
        'blob',
    ];

    /** @var string[] */
    protected const CRITICAL_DATA_DIRECTIVES = [
        'default-src',
        'script-src',
        'object-src',
        'frame-src',
    ];

    /** @var string[] */
    protected const WARNING_DATA_DIRECTIVES = [
        'style-src',
        'worker-src',
        'child-src',
        'base-uri',
    ];

    /**
     * The number of rows for the CUSTOMS CSP textarea
     *
     * @const int
     */
    protected const TEXTAREA_ROWS = 8;

    protected bool $changed = false;

    public function __construct(protected Config $config)
    {
        $this->setAttribute('name', 'csp_config');
        $this->getAttributes()->add('class', 'csp-config-form');
        $this->applyDefaultElementDecorators();
    }

    protected function assemble(): void
    {
        Csp::createNonce();
        $csps = Csp::load(new ConfigObject([
            'csp_enable_modules' => '1',
            'csp_enable_dashboards' => '1',
            'csp_enable_navigation' => '1',
        ]));

        $this->addElement($this->createUidElement());

        $this->addCsrfCounterMeasure(Session::getSession()->getId());

        $this->addElement(
            'checkbox',
            'use_strict_csp',
            [
                'label'          => $this->translate('Send CSP-Header'),
                'description'    => $this->translate(
                    'Use strict content security policy (CSP).'
                    . ' This setting helps to protect from cross-site scripting (XSS).',
                ),
                'class'          => 'autosubmit',
                'checkedValue'   => '1',
                'uncheckedValue' => '0',
            ],
        );

        $disabledState = $this->getPopulatedValue('use_custom_csp') === '1';
        $disabledClass = $disabledState ? 'csp-disabled' : '';

        $this->add(HtmlElement::create(
            'p',
            ['class' => ['csp-form-hint', $disabledClass]],
            $this->translate(
                'Enabling CSP will block some requests and prevent some functionality from working as expected.'
            ),
        ));

        if (! $this->isCspEnabled()) {
            $this->addElement('hidden', 'use_custom_csp');
            $this->addElement('hidden', 'custom_csp');
            $this->addElement('hidden', 'csp_enable_modules');
            $this->addElement('hidden', 'csp_enable_dashboards');
            $this->addElement('hidden', 'csp_enable_navigation');
        } else {
            $this->add(HtmlElement::create(
                'h3',
                ['class' => ['csp-form-hint', $disabledClass]],
                $this->translate('Allowed Sources'),
            ));

            $this->add(HtmlElement::create(
                'p',
                ['class' => ['csp-form-hint', $disabledClass]],
                $this->translate(
                    'Sources that are used in the generation of the CSP-Header.'
                ),
            ));

            $this->addPolicyTitleElement($this->translate('System'), 'unused', null, ! $disabledState);
            $this->addPolicyContentElement(
                $csps,
                [t('Directive'), t('Value')],
                function (CspReason $reason) {
                    return $reason instanceof StaticCspReason
                        && $reason->name === 'system';
                },
                function (StaticCspReason $reason, string $directive, string $policy) {
                    return Table::tr([
                        Table::td($directive),
                        $this->buildPolicy($directive, $policy),
                    ]);
                },
                ! $disabledState,
                $this->translate('No system policies defined.')
            );

            $this->addPolicyTitleElement(
                $this->translate('Modules'),
                $this->translate(
                    'Should module defined csp directives be enabled?'
                    . ' Note: Modules can define or change csp directives at any point.'
                ),
                'csp_enable_modules',
                ! $disabledState,
            );

            $this->addPolicyContentElement(
                $csps,
                [t('Module'), t('Directive'), t('Value')],
                function (CspReason $reason) {
                    return $reason instanceof ModuleCspReason;
                },
                function (ModuleCspReason $reason, string $directive, string $policy) {
                    return Table::tr([
                        Table::td($reason->module),
                        Table::td($directive),
                        $this->buildPolicy($directive, $policy),
                    ]);
                },
                $disabledState === false && $this->getValue('csp_enable_modules') === '1',
                $this->translate('No module policies defined.')
            );

            $this->addPolicyTitleElement(
                $this->translate('Dashboard'),
                $this->translate(
                    'Enable user defined dashboards. Note: You will only be able to see your own dashboards,'
                    . ' and there is currently no way to see what others have configured for themselves.'
                ),
                'csp_enable_dashboards',
                ! $disabledState,
            );

            $this->addPolicyContentElement(
                $csps,
                [t('Dashboard'), t('Dashlet'), t('Directive'), t('Value')],
                function (CspReason $reason) {
                    return $reason instanceof DashboardCspReason;
                },
                function (DashboardCspReason $reason, string $directive, string $policy) {
                    return Table::tr([
                        Table::td($reason->pane->getName()),
                        Table::td($reason->dashlet->getName()),
                        Table::td($directive),
                        $this->buildPolicy($directive, $policy),
                    ]);
                },
                $disabledState === false && $this->getValue('csp_enable_dashboards') === '1',
                $this->translate('No dashboard policies found.'),
            );

            $this->addPolicyTitleElement(
                $this->translate('Navigation'),
                $this->translate(
                    'Enable navigation items. Note: You will only be able to see your own navigation items,'
                    . ' and there is currently no way to see what others have configured for themselves.'
                ),
                'csp_enable_navigation',
                ! $disabledState,
            );

            $this->addPolicyContentElement(
                $csps,
                [t('Navigation'), t('Parent'), t('Name'), t('Directive'), t('Value')],
                function (CspReason $reason) {
                    return $reason instanceof NavigationCspReason;
                },
                function (NavigationCspReason $reason, string $directive, string $policy) {
                    $parent = $reason->item->getParent();
                    if ($parent === null) {
                        $parentCell = Table::td(t('None'))->setAttribute('class', 'empty-state');
                    } else {
                        $parentCell = Table::td($parent->getName());
                    }
                    return Table::tr([
                        Table::td($reason->type),
                        $parentCell,
                        Table::td($reason->item->getName()),
                        Table::td($directive),
                        $this->buildPolicy($directive, $policy),
                    ]);
                },
                $disabledState === false && $this->getValue('csp_enable_navigation') === '1',
                $this->translate('No navigation policies found.'),
            );

            $this->addElement(
                'checkbox',
                'use_custom_csp',
                [
                    'label'          => $this->translate('Enable Custom CSP'),
                    'description'    => $this->translate(
                        'Specify whether to use a custom, user provided, string as the CSP-Header.',
                    ),
                    'class'          => 'autosubmit csp-form-content-aligned csp-label-header-h3 csp-form-header',
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
            }

            $this->addElement('textarea', 'custom_csp', [
                'label'       => $this->translate(''),
                'description' => $this->translate(
                    'Set a custom CSP-Header. This completely overrides the automatically generated one.'
                    . ' Use the placeholder {style_nonce} to insert the automatically generated style nonce.',
                ),
                'rows'        => static::TEXTAREA_ROWS,
                'disabled'    => ! $this->isCustomCspEnabled(),
                'validators' => [
                    new CallbackValidator(function ($value, CallbackValidator $validator) {
                        if (empty($value)) {
                            return true;
                        }

                        try {
                            $value = str_replace('{style_nonce}', "'nonce-validation'", $value);
                            CspInstance::fromString($value);
                        } catch (Exception $e) {
                            $validator->addMessage($e->getMessage());
                            return false;
                        }

                        return true;
                    }),
                ]
            ]);
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
        $section['csp_enable_modules'] = $this->getValue('csp_enable_modules');
        $section['csp_enable_dashboards'] = $this->getValue('csp_enable_dashboards');
        $section['csp_enable_navigation'] = $this->getValue('csp_enable_navigation');
        $section['use_custom_csp'] = $this->getValue('use_custom_csp');
        $section['custom_csp'] = $this->getValue('custom_csp');

        $this->changed = ! empty(array_diff_assoc(
            iterator_to_array($section),
            iterator_to_array($beforeSection)
        ));

        if (! $this->changed) {
            return;
        }

        $config->setSection('security', $section);

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
        return $this->getPopulatedValue('use_custom_csp') === '1';
    }

    /**
     * @param string $title the title of the section
     * @param string|null $description the description of the section
     * @param string|null $field the name of the checkbox that controls the section
     * @param bool $enabled whether the section should be enabled
     *
     * @return void
     */
    protected function addPolicyTitleElement(
        string $title,
        ?string $description,
        ?string $field,
        bool $enabled,
    ): void {
        $disabledClass = $enabled ? '' : 'csp-disabled';

        if ($field == null) {
            $this->add(HtmlElement::create('h4', ['class' => "csp-form-hint $disabledClass"], $title));
            return;
        }

        $this->addElement('checkbox', $field, [
            'label' => sprintf($this->translate('Enable %s'), $title),
            'description' => $description,
            'class' => "autosubmit csp-form-content-aligned csp-label-header-h4 $disabledClass",
            'checkedValue' => '1',
            'uncheckedValue' => '0',
            'disabled' => ! $enabled,
            'value' => $this->getPopulatedValue($field),
        ]);
    }

    /**
     * @param LoadedCsp[] $csps the list of cps along with their reasons
     * @param string[] $header the header of the table
     * @param callable $filter a filter function that returns true if the csp should be included in the table
     * @param callable $rowBuilder a function that builds a row for the table
     * @param bool $enabled whether the content should be enabled
     * @param string $emptyText the text to display if there are no policies
     *
     * @return void
     */
    protected function addPolicyContentElement(
        array $csps,
        array $header,
        callable $filter,
        callable $rowBuilder,
        bool $enabled,
        string $emptyText,
    ): void {
        $rows = [];
        foreach ($csps as $csp) {
            if (! $filter($csp->loadReason)) {
                continue;
            }
            foreach ($csp->getDirectives() as $directive => $policies) {
                foreach ($policies as $policy) {
                    $rows[] = $rowBuilder($csp->loadReason, $directive, $policy);
                }
            }
        }

        if (count($rows) === 0) {
            $this->add(
                HtmlElement::create('p', ['class' => 'csp-form-hint'], $emptyText)
            );
            return;
        }

        $table = new Table();
        $table->addAttributes(Attributes::create(['class' => ['csp-config-table', $enabled ? '' : 'csp-disabled']]));
        $headerRow = Table::tr();
        foreach ($header as $h) {
            $headerRow->add(Table::th($h));
        }
        $table->add($headerRow);

        foreach ($rows as $row) {
            $table->add($row);
        }

        $this->add(HtmlElement::create(
            'div',
            [
                'class'               => 'collapsible',
                'data-visible-height' => 100,
            ],
            $table,
        ));
    }

    protected function getKeywordType(string $policy): ?string
    {
        if (in_array($policy, static::SECURE_KEYWORDS)) {
            return 'secure';
        }

        if (in_array($policy, static::WARNING_KEYWORDS)) {
            return 'warning';
        }

        return null;
    }

    protected function getSchemeType(string $directive, string $policy): ?string
    {
        if (! str_ends_with($policy, ':')) {
            return null;
        }

        if (str_contains($policy, ' ')) {
            return null;
        }

        $schema = substr($policy, 0, -1);

        if (in_array($schema, static::SECURE_SCHEMAS)) {
            return 'secure';
        }

        if (in_array($schema, static::WARNING_SCHEMAS)) {
            return 'warning';
        }

        if ($schema === 'data' && in_array($directive, static::CRITICAL_DATA_DIRECTIVES)) {
            return 'critical';
        }

        if ($schema === 'data' && in_array($directive, static::WARNING_DATA_DIRECTIVES)) {
            return 'warning';
        }

        return 'unknown';
    }

    protected function isNonce(string $policy): bool
    {
        return (str_starts_with($policy, "'nonce-") && str_ends_with($policy, "'"));
    }

    protected function buildPolicy(string $directive, string $policy): BaseHtmlElement
    {
        if ($policy === '*') {
            $result = HtmlElement::create(
                'span',
                ['class' => 'csp-wildcard'],
                [
                    $policy,
                    new Icon(
                        'warning',
                        [
                            'class' => 'csp-policy-info',
                            'title' => t(
                                'This is a wildcard policy. It allows everything and should therefore be avoided.'
                            ),
                        ]
                    ),
                ],
            );
        } elseif (($keyword = $this->getKeywordType($policy)) !== null) {
            $icon = match ($keyword) {
                'warning' => new Icon(
                    'warning',
                    [
                        'class' => 'csp-policy-info',
                        'title' => t('This is a potentially unsafe keyword.'),
                    ]
                ),
                default => null,
            };
            $result = HtmlElement::create(
                'span',
                ['class' => ['csp-keyword', 'csp-' . $keyword]],
                [
                    $policy,
                    $icon,
                ]
            );
        } elseif (($scheme = $this->getSchemeType($directive, $policy)) !== null) {
            $icon = match ($scheme) {
                'warning' => new Icon(
                    'warning',
                    [
                        'class' => 'csp-policy-info',
                        'title' => t('This is a potentially unsafe scheme.'),
                    ]
                ),
                'critical' => new Icon(
                    'warning',
                    [
                        'class' => 'csp-policy-info',
                        'title' => t('This is a critical scheme and should not be used.'),
                    ]
                ),
                default => null,
            };
            $result = HtmlElement::create(
                'span',
                ['class' => ['csp-scheme', 'csp-' . $scheme]],
                [
                    $policy,
                    $icon,
                ]
            );
        } elseif ($this->isNonce($policy)) {
            $result = HtmlElement::create(
                'span',
                ['class' => 'csp-nonce'],
                [
                    $policy,
                    new Icon(
                        'info-circle',
                        [
                            'class' => 'csp-policy-info',
                            'title' => t('This is an automatically generated nonce. Its value is unique per request.'),
                        ],
                    ),
                ]
            );
        } elseif (filter_var($policy, FILTER_VALIDATE_URL) !== false) {
            $result = new Link($policy, $policy, ['target' => '_blank']);
        } else {
            $result = new Text($policy);
        }
        return Table::td($result, ['class' => 'csp-policies']);
    }
}
