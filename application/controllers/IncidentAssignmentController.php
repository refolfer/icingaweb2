<?php

// SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

namespace Icinga\Controllers;

use Exception;
use Icinga\Authentication\User\DomainAwareInterface;
use Icinga\User;
use Icinga\Web\Controller\AuthBackendController;
use Icinga\Web\IncidentAssignment\IncidentAssignmentStore;
use Icinga\Util\Json;

class IncidentAssignmentController extends AuthBackendController
{
    public function init()
    {
        parent::init();
        $this->_helper->layout->disableLayout();
        $this->_helper->viewRenderer->setNoRender(true);
    }

    public function indexAction()
    {
        $this->getResponse()->setHttpResponseCode(404);
    }

    public function getAction()
    {
        $this->assertAuthenticated();

        $object = $this->getObjectFromRequest();
        if ($object === null) {
            $this->respondWithJson(['error' => 'Missing object identifiers'], 400);
            return;
        }

        try {
            $store = IncidentAssignmentStore::create();
            $assignment = $store->load($object['type'], $object['host_name'], $object['service_name']);
        } catch (Exception $e) {
            $this->respondWithJson(['error' => $e->getMessage()], 500);
            return;
        }

        $canAssign = $this->Auth()->isAuthenticated()
            && $this->Auth()->getUser()->can('application/critical-assignments');

        $this->respondWithJson([
            'ok' => true,
            'object' => $object,
            'assignment' => $assignment,
            'users' => $canAssign ? $this->collectAssignableUsers() : [],
            'canAssign' => $canAssign
        ]);
    }

    public function setAction()
    {
        $this->assertAuthenticated();
        $this->assertPermission('application/critical-assignments');
        $this->assertHttpMethod('POST');

        $object = $this->getObjectFromRequest();
        $assignee = trim((string) $this->params->get('assignee', ''));

        if ($object === null) {
            $this->respondWithJson(['error' => 'Missing object identifiers'], 400);
            return;
        }

        if ($assignee === '') {
            try {
                IncidentAssignmentStore::create()->remove(
                    $object['type'],
                    $object['host_name'],
                    $object['service_name']
                );
            } catch (Exception $e) {
                $this->respondWithJson(['error' => $e->getMessage()], 500);
                return;
            }

            $this->respondWithJson([
                'ok' => true,
                'assignment' => null,
                'users' => $this->collectAssignableUsers(),
                'canAssign' => true
            ]);
            return;
        }

        if (! $this->isKnownUser($assignee)) {
            $this->respondWithJson(['error' => sprintf('Unknown user "%s"', $assignee)], 400);
            return;
        }

        try {
            $assignment = IncidentAssignmentStore::create()->save(
                $object['type'],
                $object['host_name'],
                $object['service_name'],
                $assignee,
                $this->Auth()->getUser()->getUsername()
            );
        } catch (Exception $e) {
            $this->respondWithJson(['error' => $e->getMessage()], 500);
            return;
        }

        $this->respondWithJson([
            'ok' => true,
            'assignment' => $assignment,
            'users' => $this->collectAssignableUsers(),
            'canAssign' => true
        ]);
    }

    protected function getObjectFromRequest()
    {
        $rawParams = $this->getRawRequestParams();
        $type = trim((string) $this->getRequestValue('type', '', $rawParams));
        if ($type === '') {
            $type = trim((string) $this->getRequestValue('object_type', '', $rawParams));
        }

        $hostName = trim((string) $this->getRequestValue('host.name', $this->getRequestValue('host_name', '', $rawParams), $rawParams));
        if ($hostName === '') {
            $hostName = trim((string) $this->getRequestValue('object_host_name', '', $rawParams));
        }

        $serviceName = trim((string) $this->getRequestValue('service.name', $this->getRequestValue('service_name', '', $rawParams), $rawParams));
        if ($serviceName === '') {
            $serviceName = trim((string) $this->getRequestValue('object_service_name', '', $rawParams));
        }

        if ($type === '' && $hostName === '') {
            $rawObject = $this->getRequestValue('object', '', $rawParams);
            if (is_string($rawObject) && $rawObject !== '') {
                $decoded = json_decode($rawObject, true);
                if (is_array($decoded)) {
                    $type = trim((string) ($decoded['type'] ?? ''));
                    $hostName = trim((string) ($decoded['hostName'] ?? $decoded['host_name'] ?? ''));
                    $serviceName = trim((string) ($decoded['serviceName'] ?? $decoded['service_name'] ?? ''));
                }
            }
        }

        if (! in_array($type, ['host', 'service'], true) || $hostName === '') {
            return null;
        }

        if ($type === 'service' && $serviceName === '') {
            return null;
        }

        return [
            'type' => $type,
            'host_name' => $hostName,
            'service_name' => $type === 'service' ? $serviceName : null
        ];
    }

    protected function getRequestValue($key, $default = '', array $rawParams = [])
    {
        $value = $default;

        if ($this->params->get($key, null) !== null) {
            $value = $this->params->get($key, $default);
        } elseif (array_key_exists($key, $rawParams)) {
            $value = $rawParams[$key];
        } elseif ($key === 'host.name' && array_key_exists('host_name', $rawParams)) {
            $value = $rawParams['host_name'];
        } elseif ($key === 'service.name' && array_key_exists('service_name', $rawParams)) {
            $value = $rawParams['service_name'];
        }

        return $value;
    }

    protected function getRawRequestParams()
    {
        $rawBody = '';
        $request = $this->getRequest();

        if (method_exists($request, 'getRawBody')) {
            $rawBody = (string) $request->getRawBody();
        }

        if ($rawBody === '') {
            return [];
        }

        parse_str($rawBody, $parsed);

        return is_array($parsed) ? $parsed : [];
    }

    protected function collectAssignableUsers()
    {
        $users = [];
        foreach ($this->loadUserBackends('Icinga\Data\Selectable') as $backend) {
            try {
                if ($backend instanceof DomainAwareInterface) {
                    $domain = $backend->getDomain();
                } else {
                    $domain = null;
                }
                $query = $backend->select(['user_name']);
                foreach ($query as $row) {
                    $userObj = new User((string) $row->user_name);
                    if ($domain !== null) {
                        if ($userObj->hasDomain() && $userObj->getDomain() !== $domain) {
                            continue;
                        }

                        $userObj->setDomain($domain);
                    }

                    $userName = $userObj->getUsername();
                    if ($userName !== '') {
                        $users[$userName] = $userName;
                    }
                }
            } catch (Exception $_) {
                continue;
            }
        }

        asort($users, SORT_NATURAL | SORT_FLAG_CASE);

        return array_values($users);
    }

    protected function isKnownUser($userName)
    {
        return in_array($userName, $this->collectAssignableUsers(), true);
    }

    protected function assertAuthenticated()
    {
        if (! $this->Auth()->isAuthenticated()) {
            $this->respondWithJson(['error' => 'Unauthorized'], 401);
            exit;
        }
    }

    protected function respondWithJson(array $payload, $statusCode = 200)
    {
        $this->getResponse()
            ->setHttpResponseCode((int) $statusCode)
            ->setHeader('Content-Type', 'application/json; charset=utf-8', true)
            ->setBody(Json::sanitize($payload));
    }
}
