<?php

/* Icinga Web 2 | (c) 2026 Icinga Development Team | GPLv2+ */

namespace Icinga\Web\Widget;

use Icinga\Util\Csp;
use ipl\Html\BaseHtmlElement;
use ipl\Html\HtmlElement;
use ipl\Html\Table;
use ipl\I18n\Translation;
use ipl\Web\Widget\Link;

class CspConfigurationTable extends BaseHtmlElement
{
    use Translation;

    protected $defaultAttributes = ['class' => 'csp-config-table'];

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

    protected $tag = 'div';

    public function __construct(
        protected ?bool $includeUserContent = null,
    ) {
    }

    protected function addPolicyTable(
        string $title,
        string $filterType,
        array $csp,
        array $header,
        callable $rowBuilder
    ): void {
        $rows = [];
        foreach ($csp as $row) {
            $reason = $row['reason'];
            $type = $reason['type'];
            if ($type !== $filterType) {
                continue;
            }
            foreach ($row['directives'] as $directive => $policies) {
                if (count($policies) === 0) {
                    continue;
                }
                foreach ($policies as $k => $policy) {
                    $rows[] = $rowBuilder($reason, $directive, $policy);
                }
            }
        }

        if (count($rows) === 0) {
            return;
        }

        $this->add(HtmlElement::create('h3', null, $title));

        $table = new Table();
        $headerRow = Table::tr();
        foreach ($header as $h) {
            $headerRow->add(Table::th($h));
        }
        $table->add($headerRow);

        foreach ($rows as $row) {
            $table->add($row);
        }

        $this->add($table);
    }

    protected function assemble(): void
    {
        $csp = iterator_to_array(Csp::collectDirectives($this->includeUserContent), false);

        $this->addPolicyTable(
            t('System'),
            'system',
            $csp,
            [t('Directive'), t('Value')],
            function (array $reason, string $directive, string $policy) {
                return Table::tr([
                    Table::td($directive),
                    $this->buildPolicy($directive, $policy),
                ]);
            },
        );

        $this->addPolicyTable(
            t('Dashboard'),
            'dashlet',
            $csp,
            [t('Dashboard'), t('Dashlet'), t('Directive'), t('Value')],
            function (array $reason, string $directive, string $policy) {
                return Table::tr([
                    Table::td($reason['pane']),
                    Table::td($reason['dashlet']),
                    Table::td($directive),
                    $this->buildPolicy($directive, $policy),
                ]);
            }
        );

        // TODO: Handle other types of navigation in extra tables
        $this->addPolicyTable(
            t('Navigation'),
            'navigation',
            $csp,
            [t('Type'), t('Name'), t('Parent'), t('Directive'), t('Value')],
            function (array $reason, string $directive, string $policy) {
                return Table::tr([
                    Table::td($reason['navType']),
                    Table::td($reason['name']),
                    Table::td($reason['parent'] ?? t('NA')),
                    Table::td($directive),
                    $this->buildPolicy($directive, $policy),
                ]);
            }
        );

        $this->addPolicyTable(
            t('Modules'),
            'module',
            $csp,
            [t('Module'), t('Directive'), t('Value')],
            function (array $reason, string $directive, string $policy) {
                return Table::tr([
                    Table::td($reason['module']),
                    Table::td($directive),
                    $this->buildPolicy($directive, $policy),
                ]);
            }
        );
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
            $result = HtmlElement::create('span', ['class' => 'wildcard'], $policy);
        } elseif ($policy === "'self'") {
            $result = HtmlElement::create('span', ['class' => 'self'], $policy);
        } elseif (($keyword = $this->getKeywordType($policy)) !== null) {
            $result = HtmlElement::create('span', ['class' => ['keyword', $keyword]], $policy);
        } elseif (($scheme = $this->getSchemeType($directive, $policy)) !== null) {
            $result = HtmlElement::create('span', ['class' => ['scheme', $scheme]], $policy);
        } elseif ($this->isNonce($policy)) {
            $result = HtmlElement::create('span', ['class' => 'nonce'], $policy);
        } elseif (filter_var($policy, FILTER_VALIDATE_URL) !== false) {
            $result = new Link($policy, $policy, ['target' => '_blank']);
        } else {
            $result = HtmlElement::create('span', null, $policy);
        }
        return Table::td($result, ['class' => 'csp-policies']);
    }
}
