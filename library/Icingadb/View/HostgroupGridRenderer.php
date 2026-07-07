<?php

// SPDX-FileCopyrightText: 2025 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

namespace Icinga\Module\Icingadb\View;

use Icinga\Module\Icingadb\Common\Database;
use Icinga\Module\Icingadb\Common\Links;
use Icinga\Module\Icingadb\Model\Hostgroupsummary;
use Icinga\Module\Icingadb\Widget\Detail\HostStatistics;
use Icinga\Module\Icingadb\Widget\Detail\ServiceStatistics;
use ipl\Html\Attributes;
use ipl\Html\HtmlDocument;
use ipl\Html\HtmlElement;
use ipl\Html\Text;
use ipl\I18n\Translation;
use ipl\Stdlib\BaseFilter;
use ipl\Stdlib\Filter;
use ipl\Web\Common\ItemRenderer;
use ipl\Web\Url;
use ipl\Web\Widget\Link;
use ipl\Web\Widget\StateBadge;

/** @implements ItemRenderer<Hostgroupsummary> */
class HostgroupGridRenderer implements ItemRenderer
{
    use Translation;
    use BaseFilter;
    use Database;

    public function assembleAttributes($item, Attributes $attributes, string $layout): void
    {
        $attributes->get('class')->addValue(['object-grid-cell', 'hostgroup']);
    }

    public function assembleVisual($item, HtmlDocument $visual, string $layout): void
    {
        $url = Url::fromPath('icingadb/hosts');
        $urlFilter = Filter::all(Filter::equal('hostgroup.name', $item->name));

        if ($item->hosts_down_unhandled > 0) {
            $urlFilter->add(Filter::equal('host.state.soft_state', 1))
                ->add(Filter::equal('host.state.is_handled', 'n'))
                ->add(Filter::equal('host.state.is_reachable', 'y'));

            $link = new Link(
                new StateBadge($item->hosts_down_unhandled, 'down'),
                $url->setFilter($urlFilter),
                [
                    'title' => sprintf(
                        $this->translatePlural(
                            'List %d host that is currently in DOWN state in host group "%s"',
                            'List %d hosts which are currently in DOWN state in host group "%s"',
                            $item->hosts_down_unhandled
                        ),
                        $item->hosts_down_unhandled,
                        $item->display_name
                    )
                ]
            );
        } elseif ($item->hosts_down_handled > 0) {
            $urlFilter->add(Filter::equal('host.state.soft_state', 1))
                ->add(Filter::any(
                    Filter::equal('host.state.is_handled', 'y'),
                    Filter::equal('host.state.is_reachable', 'n')
                ));

            $link = new Link(
                new StateBadge($item->hosts_down_handled, 'down', true),
                $url->setFilter($urlFilter),
                [
                    'title' => sprintf(
                        $this->translatePlural(
                            'List %d host that is currently in DOWN (Acknowledged) state in host group "%s"',
                            'List %d hosts which are currently in DOWN (Acknowledged) state in host group "%s"',
                            $item->hosts_down_handled
                        ),
                        $item->hosts_down_handled,
                        $item->display_name
                    )
                ]
            );
        } elseif ($item->hosts_pending > 0) {
            $urlFilter->add(Filter::equal('host.state.soft_state', 99));

            $link = new Link(
                new StateBadge($item->hosts_pending, 'pending'),
                $url->setFilter($urlFilter),
                [
                    'title' => sprintf(
                        $this->translatePlural(
                            'List %d host that is currently in PENDING state in host group "%s"',
                            'List %d hosts which are currently in PENDING state in host group "%s"',
                            $item->hosts_pending
                        ),
                        $item->hosts_pending,
                        $item->display_name
                    )
                ]
            );
        } elseif ($item->hosts_up > 0) {
            $urlFilter->add(Filter::equal('host.state.soft_state', 0));

            $link = new Link(
                new StateBadge($item->hosts_up, 'up'),
                $url->setFilter($urlFilter),
                [
                    'title' => sprintf(
                        $this->translatePlural(
                            'List %d host that is currently in UP state in host group "%s"',
                            'List %d hosts which are currently in UP state in host group "%s"',
                            $item->hosts_up
                        ),
                        $item->hosts_up,
                        $item->display_name
                    )
                ]
            );
        } else {
            $link = new Link(
                new StateBadge(0, 'none'),
                Links::hostgroup($item),
                [
                    'title' => sprintf(
                        $this->translate('There are no hosts in host group "%s"'),
                        $item->display_name
                    )
                ]
            );
        }

        $visual->addHtml($link);
    }

    public function assembleTitle($item, HtmlDocument $title, string $layout): void
    {
        $link = new Link(
            $item->display_name,
            Links::hostgroup($item),
            [
                'class' => 'subject',
                'title' => sprintf(
                    $this->translate('List all hosts in the group "%s"'),
                    $item->display_name
                )
            ]
        );

        if ($this->hasBaseFilter()) {
            $link->getUrl()->setFilter($this->getBaseFilter());
        }

        $title->addHtml($link);
    }

    public function assembleCaption($item, HtmlDocument $caption, string $layout): void
    {
        $caption->addHtml(Text::create($item->name));
    }

    public function assembleExtendedInfo($item, HtmlDocument $info, string $layout): void
    {
    }

    public function assembleFooter($item, HtmlDocument $footer, string $layout): void
    {
    }

    public function assemble($item, string $name, HtmlDocument $element, string $layout): bool
    {
        return false; // no custom sections
    }

    public function assembleColumns($item, HtmlDocument $columns, string $layout): void
    {
        $responsibility = $this->createResponsibilityInfo($item, true);
        if ($responsibility !== null) {
            $columns->addHtml($responsibility);
        }

        [$hostStats, $serviceStats] = $this->createStatistics($item);

        if ($this->hasBaseFilter()) {
            $hostStats->setBaseFilter(Filter::all($hostStats->getBaseFilter(), $this->getBaseFilter()));
            $serviceStats->setBaseFilter(Filter::all($serviceStats->getBaseFilter(), $this->getBaseFilter()));
        }

        $columns->addHtml($hostStats, $serviceStats);
    }

    /**
     * Create statistics for the given item
     *
     * @param Hostgroupsummary $item
     *
     * @return array{0: HostStatistics, 1: ServiceStatistics}
     */
    protected function createStatistics(Hostgroupsummary $item): array
    {
        $hostStats = (new HostStatistics($item))
            ->setBaseFilter(Filter::equal('hostgroup.name', $item->name));

        $serviceStats = (new ServiceStatistics($item))
            ->setBaseFilter(Filter::equal('hostgroup.name', $item->name));

        return [$hostStats, $serviceStats];
    }

    protected function createResponsibilityInfo(
        Hostgroupsummary $item,
        bool $withAction = false
    ): ?HtmlElement
    {
        $responsibility = $this->fetchResponsibility($item);
        $user = trim((string) ($responsibility['responsible_user'] ?? ''));
        $note = trim((string) ($responsibility['responsible_note'] ?? ''));

        if ($user === '' && $note === '' && ! $withAction) {
            return null;
        }

        $parts = [
            new HtmlElement(
                'span',
                Attributes::create(['class' => 'hostgroup-responsibility-label']),
                Text::create($this->translate('Responsible'))
            )
        ];

        if ($user !== '') {
            $parts[] = new HtmlElement(
                'span',
                Attributes::create(['class' => 'hostgroup-responsibility-user']),
                Text::create($user)
            );
        }

        if ($note !== '') {
            $parts[] = new HtmlElement(
                'span',
                Attributes::create(['class' => 'hostgroup-responsibility-note']),
                Text::create($note)
            );
        }

        if ($user === '' && $note === '' && $withAction) {
            $parts[] = new HtmlElement(
                'span',
                Attributes::create(['class' => 'hostgroup-responsibility-empty']),
                Text::create($this->translate('No responsibility configured'))
            );
        }

        if ($withAction) {
            $parts[] = new HtmlElement(
                'span',
                Attributes::create(['class' => 'hostgroup-responsibility-action']),
                new Link(
                    $this->translate('Edit responsibility'),
                    Url::fromPath('icingadb/hostgroup/responsibility')->setParam('name', $item->name),
                    [
                        'class' => 'action-link',
                        'data-icinga-modal' => true,
                        'data-no-icinga-ajax' => true,
                        'data-base-target' => '_main',
                        'title' => $this->translate('Edit host group responsibility')
                    ]
                )
            );
        }

        return new HtmlElement(
            'div',
            Attributes::create(['class' => 'hostgroup-responsibility']),
            ...$parts
        );
    }

    protected function fetchResponsibility(Hostgroupsummary $item): array
    {
        $row = $this->getDb()->fetchRow(
            'SELECT responsible_user, responsible_note'
            . ' FROM hostgroup_responsibility r'
            . ' JOIN hostgroup h ON h.id = r.hostgroup_id'
            . ' WHERE h.name = ?',
            [$item->name]
        );

        if (is_array($row)) {
            return $row;
        }

        if (is_object($row)) {
            return get_object_vars($row);
        }

        return [];
    }
}
