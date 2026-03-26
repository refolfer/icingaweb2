# Hooks

## ConfigFormEventsHook

The `ConfigFormEventsHook` allows developers to hook into the handling of configuration forms. It provides three methods:

* `appliesTo()`
* `isValid()`
* `onSuccess()`

`appliesTo()` determines whether the hook should run for a given configuration form.
Developers should use `instanceof` checks in order to decide whether the hook should run or not.
If `appliesTo()` returns `false`, `isValid()` and `onSuccess()` won't get called for this hook.

`isValid()` is called after the configuration form has been validated successfully.
An exception thrown here indicates form errors and prevents the config from being stored.
The exception's error message is shown in the frontend automatically.
If there are multiple hooks indicating errors, every error will be displayed.

`onSuccess()` is called after the configuration has been stored successfully.
Form handling can't be interrupted here. Any exception will be caught, logged and notified.

Hook example:

```php
namespace Icinga\Module\Acme\ProvidedHook;

use Icinga\Application\Hook\ConfigFormEventsHook;
use Icinga\Forms\ConfigForm;
use Icinga\Forms\Security\RoleForm;

class ConfigFormEvents extends ConfigFormEventsHook
{
    public function appliesTo(ConfigForm $form)
    {
        return $form instanceof RoleForm;
    }

    public function onSuccess(ConfigForm $form)
    {
        $this->updateMyModuleConfig();
    }

    protected function updateMyModuleConfig()
    {
        // ...
    }
}
```

## CspPolicyProviderHook <a id="hooks-csp-policy-provider"></a>

The `CspPolicyProviderHook` allows developers to add custom CSP policies to the Icinga Web 2 frontend.
It provides the method `getCsp()` which should return an array of CSP policies the module wants to add.
The policies are combined additively with the default policies, icingaweb2 generated ones and other module-defined
policies.
This hook is only called if `csp_enable_modules` is enabled in the Icinga Web 2 configuration.

Hook example:

```php
namespace Icinga\Module\Acme\ProvidedHook;

use Icinga\Application\Hook\CspPolicyProviderHook;
use ipl\Web\Common\Csp;

class CspPolicyProvider extends CspPolicyProviderHook
{
    public function getCsp(): Csp
    {
        $csp = new Csp();
        $csp->add('img-src', ['cdn.example.com', 'usercontent.example.com']);
        $csp->add('style-src', 'cdn.example.com');

        // ...

        return $csp;
    }
}
```
