<?php

/* Icinga Web 2 | (c) 2026 Icinga Development Team | GPLv2+ */

namespace Icinga\Web\Widget;

use Icinga\Util\Csp;
use ipl\Html\Table;
use ipl\I18n\Translation;

class CspConfigurationTable extends Table
{
    use Translation;

    public function __construct()
    {
        $this->getAttributes()->add('class', 'csp-config-table');
    }

    protected function assemble(): void
    {
        $this->add(static::tr([
            static::th($this->translate('Type')),
            static::th($this->translate('Info')),
            static::th($this->translate('Directive')),
            static::th($this->translate('Value')),
        ]));

        foreach (Csp::collectDirectives() as $directive) {
            $reason = $directive['reason'];
            $type = $reason['type'];
            $info = match ($type) {
                'navigation' => $reason['navType']
                    . '/' . ($reason['parent'] !== null ? ($reason['parent'] . '/') : '')
                    . $reason['name'],
                'dashlet' => $reason['pane'] . '/' . $reason['dashlet'],
                'module' => $reason['module'],
                default => '-',
            };
            foreach ($directive['directives'] as $directive => $policies) {
                $this->add(static::tr([
                    static::td($type),
                    static::td($info),
                    static::td($directive),
                    static::td(join(', ', $policies)),
                ]));
            }
        }
    }
}
