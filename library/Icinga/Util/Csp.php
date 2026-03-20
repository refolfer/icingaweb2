<?php

// SPDX-FileCopyrightText: 2023 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

namespace Icinga\Util;

use Icinga\Application\Config;
use Icinga\Application\Icinga;
use Icinga\Security\Csp\LoadedCsp;
use Icinga\Security\Csp\Loader\DashboardCspLoader;
use Icinga\Security\Csp\Loader\ModuleCspLoader;
use Icinga\Security\Csp\Loader\NavigationCspLoader;
use Icinga\Security\Csp\Loader\StaticCspLoader;
use Icinga\Web\Response;
use Icinga\Web\Window;
use ipl\Web\Common\Csp as CspInstance;
use RuntimeException;
use function ipl\Stdlib\get_php_type;

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
    /** @var self|null */
    protected static ?self $instance = null;

    /** @var ?string */
    protected ?string $styleNonce = null;

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
        $header = static::getHeader();
        $response->setHeader('Content-Security-Policy', $header, true);
    }

    public static function isEnabled(): bool
    {
        return Config::app()->get('security', 'use_strict_csp', '0') === '1';
    }

    /**
     * @return LoadedCsp[]
     */
    public static function load(?bool $includeUserContent = null): array
    {
        $csp = static::getInstance();
        if (empty($csp->styleNonce)) {
            throw new RuntimeException('No nonce set for CSS');
        }

        $result = [];
        $result = array_merge($result, (new StaticCspLoader(
            'system',
            [
//                'default-src' => ["'self'"],
                'style-src'   => ["'self'", "'nonce-{$csp->styleNonce}'"],
                'font-src'    => ["'self'", "data:"],
                'img-src'     => ["'self'", "data:"],
                'frame-src'   => ["'self'"],
            ]
        ))->load());

        $result = array_merge($result, (new ModuleCspLoader())->load());

        if ($includeUserContent === null) {
            $includeUserContent = Config::app()->get('security', 'include_user_content', '0') === '1';
        }

        if ($includeUserContent) {
            $result = array_merge($result, (new DashboardCspLoader())->load());
            $result = array_merge($result, (new NavigationCspLoader())->load());
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
        $config = Config::app();
        if ($config->get('security', 'use_custom_csp', '0') === '1') {
            return self::getCustomHeader();
        }

        return self::getAutomaticHeader();
    }

    /**
     * Get the custom Content-Security-Policy set in the config.
     * This method automatically replaces new-lines and the {style_nonce} placeholder with the generated nonce.
     *
     * @return CspInstance Returns the custom CSP header.
     */
    protected static function getCustomHeader(): CspInstance
    {
        $csp = static::getInstance();

        if (empty($csp->styleNonce)) {
            throw new RuntimeException('No nonce set for CSS');
        }

        $config = Config::app();
        $customCsp = $config->get('security', 'custom_csp', '');
        $customCsp = str_replace("\r\n", ' ', $customCsp);
        $customCsp = str_replace("\n", ' ', $customCsp);
        $customCsp = str_replace('{style_nonce}', "'nonce-{$csp->styleNonce}'", $customCsp);

        return CspInstance::fromString($customCsp);
    }

    /**
     * Get the automatically generated Content-Security-Policy.
     *
     * @return CspInstance Returns the generated header value.
     * @throws RuntimeException If no nonce set for CSS
     */
    public static function getAutomaticHeader(?bool $includeUserContent = null): CspInstance
    {
        $csps = self::load($includeUserContent);
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
        $csp = static::getInstance();
        if ($csp->styleNonce === null) {
            $csp->styleNonce = base64_encode(random_bytes(16));
            Window::getInstance()->getSessionNamespace('csp')->set('style_nonce', $csp->styleNonce);
        }
    }

    /**
     * Get nonce for dynamic CSS
     *
     * @return ?string
     */
    public static function getStyleNonce(): ?string
    {
        if (Icinga::app()->isWeb()) {
            return static::getInstance()->styleNonce;
        }
        return null;
    }

    /**
     * Get the CSP instance
     *
     * @return self
     */
    protected static function getInstance(): self
    {
        if (static::$instance === null) {
            $csp = new static();
            $nonce = Window::getInstance()->getSessionNamespace('csp')->get('style_nonce');
            if ($nonce !== null && ! is_string($nonce)) {
                throw new RuntimeException(
                    sprintf(
                        'Nonce value is expected to be string, got %s instead',
                        get_php_type($nonce),
                    ),
                );
            }

            $csp->styleNonce = $nonce;

            static::$instance = $csp;
        }

        return static::$instance;
    }
}
