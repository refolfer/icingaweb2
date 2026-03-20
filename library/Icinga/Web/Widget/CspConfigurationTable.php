<?php

/* Icinga Web 2 | (c) 2026 Icinga Development Team | GPLv2+ */

namespace Icinga\Web\Widget;

use Icinga\Security\Csp\LoadedCsp;
use Icinga\Security\Csp\Reason\CspReason;
use Icinga\Security\Csp\Reason\DashboardCspReason;
use Icinga\Security\Csp\Reason\ModuleCspReason;
use Icinga\Security\Csp\Reason\NavigationCspReason;
use Icinga\Security\Csp\Reason\StaticCspReason;
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

    /**
     * @param string $title
     * @param callable $filter
     * @param LoadedCsp[] $csps
     * @param array $header
     * @param callable $rowBuilder
     *
     * @return void
     */
    protected function addPolicyTable(
        string $title,
        callable $filter,
        array $csps,
        array $header,
        callable $rowBuilder,
    ): void {
        $rows = [];
        foreach ($csps as $csp) {
            if (! $filter($csp->loadReason)) {
                continue;
            }
            foreach ($csp->getDirectives() as $directive => $policies)
            {
                foreach ($policies as $policy) {
                    $rows[] = $rowBuilder($csp->loadReason, $directive, $policy);
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
        $csps = Csp::load($this->includeUserContent);

        $this->addPolicyTable(
            t('System'),
            function (CspReason $reason) {
                return $reason instanceof StaticCspReason
                    && $reason->name === 'system';
            },
            $csps,
            [t('Directive'), t('Value')],
            function (StaticCspReason $reason, string $directive, string $policy) {
                return Table::tr([
                    Table::td($directive),
                    $this->buildPolicy($directive, $policy),
                ]);
            },
        );

        $this->addPolicyTable(
            t('Dashboard'),
            function (CspReason $reason) {
                return $reason instanceof DashboardCspReason;
            },
            $csps,
            [t('Dashboard'), t('Dashlet'), t('Directive'), t('Value')],
            function (DashboardCspReason $reason, string $directive, string $policy) {
                return Table::tr([
                    Table::td($reason->pane->getName()),
                    Table::td($reason->dashlet->getName()),
                    Table::td($directive),
                    $this->buildPolicy($directive, $policy),
                ]);
            },
        );

        // TODO: Handle other types of navigation in extra tables
        $this->addPolicyTable(
            t('Navigation'),
            function (CspReason $reason) {
                return $reason instanceof NavigationCspReason;
            },
            $csps,
            [t('Type'), t('Parent'), t('Name'), t('Directive'), t('Value')],
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
        );

        $this->addPolicyTable(
            t('Modules'),
            function (CspReason $reason) {
                return $reason instanceof ModuleCspReason;
            },
            $csps,
            [t('Module'), t('Directive'), t('Value')],
            function (ModuleCspReason $reason, string $directive, string $policy) {
                return Table::tr([
                    Table::td($reason->module),
                    Table::td($directive),
                    $this->buildPolicy($directive, $policy),
                ]);
            },
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
