<?php

// SPDX-FileCopyrightText: 2023 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

namespace Icinga\Util;

use Exception;
use Icinga\Application\Config;
use Icinga\Application\Icinga;
use Icinga\Application\Logger;
use Icinga\Data\ConfigObject;
use Icinga\Security\Csp\LoadedCsp;
use Icinga\Security\Csp\Loader\DashboardCspLoader;
use Icinga\Security\Csp\Loader\ModuleCspLoader;
use Icinga\Security\Csp\Loader\NavigationCspLoader;
use Icinga\Security\Csp\Loader\StaticCspLoader;
use Icinga\Web\Response;
use Icinga\Web\Window;
use ipl\Web\Common\Csp as CspInstance;
use RuntimeException;

/**
 * Helper to enable strict content security policy (CSP)
 *
 * {@see static::addHeader()} adds a strict Content-Security-Policy header with a nonce to still support dynamic CSS
 * securely.
 * Note that {@see static::createNonce()} must be called first.
 * Use {@see static::getStyleNonce()} to access the nonce for dynamic CSS.
 *
 * A nonce is not created for dynamic JS,
 * and it is questionable whether this will ever be supported.
 */
class Csp
{
    /** @var CspInstance|null */
    protected static ?CspInstance $csp = null;

    /** Singleton */
    private function __construct()
    {
    }

    /**
     * Add a Content-Security-Policy header with a nonce for dynamic CSS
     *
     * Note that {@see static::createNonce()} must be called beforehand.
     *
     * @param Response $response
     *
     * @throws RuntimeException If no nonce set for CSS
     */
    public static function addHeader(Response $response): void
    {
        $response->setHeader('Content-Security-Policy', static::getHeader(), true);
    }

    public static function isEnabled(): bool
    {
        return (bool) Config::app()->get('security', 'use_strict_csp', '0');
    }

    /**
     * @return LoadedCsp[]
     */
    public static function load(?ConfigObject $config = null): array
    {
        if ($config === null) {
            $config = Config::app()->getSection('security');
        }

        $nonce = static::getStyleNonce();
        if (empty($nonce)) {
            throw new RuntimeException('No nonce set for CSS');
        }

        $result = [];
        $result = array_merge($result, (new StaticCspLoader(
            'system',
            [
                /* There is no need to define `default-src` here, as it is already defined in the base CSP */
                'style-src' => ["'self'", "'nonce-{$nonce}'"],
                'font-src'  => ["'self'", "data:"],
                'img-src'   => ["'self'", "data:"],
                'frame-src' => ["'self'"],
            ]
        ))->load());

        try {
            if ($config->get('csp_enable_modules', '1')) {
                $result = array_merge($result, (new ModuleCspLoader())->load());
            }
        } catch (Exception $e) {
            Logger::warning('Module CSP loader failed: %s', $e->getMessage());
        }

        try {
            if ($config->get('csp_enable_dashboards', '1')) {
                $result = array_merge($result, (new DashboardCspLoader())->load());
            }
        } catch (Exception $e) {
            Logger::warning('Dashboard CSP loader failed: %s', $e->getMessage());
        }

        try {
            if ($config->get('csp_enable_navigation', '1')) {
                $result = array_merge($result, (new NavigationCspLoader())->load());
            }
        } catch (Exception $e) {
            Logger::warning('Navigation CSP loader failed: %s', $e->getMessage());
        }

        return $result;
    }

    /**
     * Get the Content-Security-Policy header.
     *
     * @return string Returns the CSP header for this request.
     * @throws RuntimeException If no nonce set for CSS
     */
    public static function getHeader(): string
    {
        if (static::$csp === null) {
            $config = Config::app();
            if ($config->get('security', 'use_custom_csp')) {
                static::$csp = self::getCustomHeader();
            } else {
                static::$csp = self::getAutomaticHeader();
            }
        }

        return static::$csp->getHeader();
    }

    /**
     * Get the custom Content-Security-Policy set in the config.
     * This method automatically replaces new-lines and the {style_nonce} placeholder with the generated nonce.
     *
     * @return CspInstance Returns the custom CSP header.
     */
    protected static function getCustomHeader(): CspInstance
    {
        $nonce = static::getStyleNonce();
        if (empty($nonce)) {
            throw new RuntimeException('No nonce set for CSS');
        }

        $config = Config::app();
        $customCsp = $config->get('security', 'custom_csp', '');
        $customCsp = str_replace('{style_nonce}', "'nonce-{$nonce}'", $customCsp);

        return CspInstance::fromString($customCsp);
    }

    /**
     * Get the automatically generated Content-Security-Policy.
     *
     * @return CspInstance Returns the generated header value.
     * @throws RuntimeException If no nonce set for CSS
     */
    public static function getAutomaticHeader(): CspInstance
    {
        $csps = self::load();
        return CspInstance::merge(...$csps);
    }

    /**
     * Set/recreate nonce for dynamic CSS
     *
     * Should always be called upon initial page loads or page reloads,
     * as it sets/recreates a nonce for CSS and writes it to a window-aware session.
     */
    public static function createNonce(): void
    {
        if (Window::getInstance()->getSessionNamespace('csp')->get('style_nonce') === null) {
            $nonce = base64_encode(random_bytes(16));
            Window::getInstance()->getSessionNamespace('csp')->set('style_nonce', $nonce);
        }
    }

    /**
     * Get nonce for dynamic CSS
     *
     * @return ?string
     */
    public static function getStyleNonce(): ?string
    {
        if (Icinga::app()->isWeb() && static::$csp !== null) {
            return static::$csp->getNonce();
        }

        return Window::getInstance()->getSessionNamespace('csp')->get('style_nonce');
    }
}
