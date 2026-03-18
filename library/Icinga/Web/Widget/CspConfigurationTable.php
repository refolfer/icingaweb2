<?php

/* Icinga Web 2 | (c) 2026 Icinga Development Team | GPLv2+ */

namespace Icinga\Web\Widget;

use Icinga\Util\Csp;
use ipl\Html\BaseHtmlElement;
use ipl\Html\HtmlElement;
use ipl\Html\Table;
use ipl\I18n\Translation;

class CspConfigurationTable extends BaseHtmlElement
{
    use Translation;

    protected $tag = 'div';

    public function __construct()
    {
        $this->getAttributes()->add('class', 'csp-config-table');
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
        $csp = iterator_to_array(Csp::collectDirectives(), false);

        $this->addPolicyTable(
            t('System'),
            'system',
            $csp,
            [t('Directive'), t('Value')],
            function (array $reason, string $directive, string $policy) {
                return Table::tr([
                    Table::td($directive),
                    $this->buildPolicy($policy),
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
                    $this->buildPolicy($policy),
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
                    Table::td($reason['parent'] ?? 'NA'),
                    Table::td($directive),
                    $this->buildPolicy($policy),
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
                    $this->buildPolicy($policy),
                ]);
            }
        );
    }

    protected function getKeywordType(string $policy): ?string
    {
        $secureKeywords = [
            "'self'",
            "'none'",
            "'strict-dynamic'",
            "'report-sample'",
            "'report-sha256'",
            "'report-sha384'",
            "'report-sha512'",
        ];

        if (in_array($policy, $secureKeywords)) {
            return 'secure';
        }

        $warningKeywords = [
            "'unsafe-inline'",
            "'unsafe-eval'",
            "'unsafe-hashes'",
        ];

        if (in_array($policy, $warningKeywords)) {
            return 'warning';
        }

        return null;
    }

    protected function getSchemeType(string $policy): ?string
    {
        if (! str_ends_with($policy, ':')) {
            return null;
        }

        if (str_contains($policy, ' ')) {
            return null;
        }

        $scheme = substr($policy, 0, -1);

        $secureSchemes = [
            'https',
            'wss',
        ];

        if (in_array($scheme, $secureSchemes)) {
            return 'secure';
        }

        $warningSchemes = [
            'http',
            'ws',
            'blob',
            'data',
        ];

        if (in_array($scheme, $warningSchemes)) {
            return 'warning';
        }

        return 'unknown';
    }

    protected function isNonce(string $policy): bool
    {
        return (str_starts_with($policy, "'nonce-") && str_ends_with($policy, "'"));
    }

    protected function buildPolicy(string $policy): BaseHtmlElement
    {
        if ($policy === '*') {
            $result = HtmlElement::create('span', ['class' => 'wildcard'], $policy);
        } else if ($policy === "'self'") {
            $result = HtmlElement::create('span', ['class' => 'self'], $policy);
        } else if (($keyword = $this->getKeywordType($policy)) !== null) {
            $result = HtmlElement::create(
                'span', ['class' => ['keyword', $keyword]], $policy
            );
        } else if (($scheme = $this->getSchemeType($policy)) !== null) {
            $result = HtmlElement::create(
                'span', ['class' => ['scheme', $scheme]], $policy
            );
        } else if ($this->isNonce($policy)) {
            $result = HtmlElement::create(
                'span', ['class' => 'nonce'], $policy
            );
        } else if (filter_var($policy, FILTER_VALIDATE_URL) !== false) {
            $result = HtmlElement::create(
                'a',
                [
                    'href' => $policy,
                    'class' => 'url',
                    'target' => '_blank',
                ],
                $policy,
            );
        } else {
            $result = HtmlElement::create('span', null, $policy);
        }
        return Table::td($result, ['class' => 'csp-policies']);
    }
}
