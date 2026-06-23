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
        $rawParams = $this->getRawRequestParams();
        $assignee = trim((string) $this->getRequestValue('assignee', '', $rawParams));
        $note = null;
        if ($this->params->get('note', null) !== null || array_key_exists('note', $rawParams)) {
            $note = $this->sanitizeAssignmentNote($this->getRequestValue('note', '', $rawParams));
        }

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
                $this->Auth()->getUser()->getUsername(),
                $note
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

    public function summaryAction()
    {
        $this->assertAuthenticated();

        $objects = $this->getObjectsFromRequest();
        if (! count($objects)) {
            $this->respondWithJson(['error' => 'Missing object identifiers'], 400);
            return;
        }

        try {
            $store = IncidentAssignmentStore::create();
            $assignments = $store->loadMany($objects);
            $assignmentCounts = $store->aggregateByAssignee($objects);
        } catch (Exception $e) {
            $this->respondWithJson(['error' => $e->getMessage()], 500);
            return;
        }

        $summary = $this->buildAssignmentSummary($objects, $assignmentCounts);

        $this->respondWithJson([
            'ok' => true,
            'objects' => $objects,
            'assignments' => $assignments,
            'assignmentCounts' => $assignmentCounts,
            'summary' => $summary,
            'currentUser' => $this->Auth()->getUser()->getUsername()
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

    protected function getObjectsFromRequest()
    {
        $rawParams = $this->getRawRequestParams();
        $objects = [];
        $rawObjects = $this->getRequestValue('objects', null, $rawParams);

        if (is_array($rawObjects)) {
            $objects = $rawObjects;
        } elseif (is_string($rawObjects) && trim($rawObjects) !== '') {
            try {
                $decoded = Json::decode($rawObjects, true);
                if (is_array($decoded)) {
                    $objects = $decoded;
                }
            } catch (Exception $_) {
                $objects = [];
            }
        }

        if (! count($objects)) {
            $object = $this->getObjectFromRequest();
            if ($object !== null) {
                $objects = [$object];
            }
        }

        return $this->normalizeObjects($objects);
    }

    protected function sanitizeAssignmentNote($note)
    {
        return mb_substr(trim((string) $note), 0, 1024);
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

    protected function buildAssignmentSummary(array $objects, array $assignmentCounts)
    {
        $summary = [
            'me' => 0,
            'assigned' => 0,
            'unassigned' => 0,
            'total' => count($objects)
        ];
        $currentUserNames = $this->getCurrentUserNames();

        foreach ($assignmentCounts as $assignee => $count) {
            if ($count <= 0) {
                continue;
            }

            if ($this->isAssigneeCurrentUser($assignee, $currentUserNames)) {
                $summary['me'] += (int) $count;
            } else {
                $summary['assigned'] += (int) $count;
            }
        }

        $summary['unassigned'] = max(0, $summary['total'] - $summary['me'] - $summary['assigned']);

        return $summary;
    }

    protected function getCurrentUserNames()
    {
        $names = [];
        $user = $this->Auth()->getUser();
        $candidates = [];

        if ($user) {
            $candidates[] = $user->getUsername();
            if (method_exists($user, 'getLocalUsername')) {
                $candidates[] = $user->getLocalUsername();
            }
        }

        foreach ($candidates as $name) {
            $normalized = strtolower(trim((string) $name));
            if ($normalized === '') {
                continue;
            }

            $names[] = $normalized;
            if (strpos($normalized, '@') !== false) {
                $names[] = strtok($normalized, '@');
            }
        }

        return array_values(array_unique(array_filter($names)));
    }

    protected function isAssigneeCurrentUser($assignee, array $currentUserNames)
    {
        $normalized = strtolower(trim((string) $assignee));
        if ($normalized === '' || ! count($currentUserNames)) {
            return false;
        }

        if (in_array($normalized, $currentUserNames, true)) {
            return true;
        }

        if (strpos($normalized, '@') !== false) {
            return in_array(strtok($normalized, '@'), $currentUserNames, true);
        }

        return false;
    }

    protected function normalizeObjects(array $objects)
    {
        $normalized = [];

        foreach ($objects as $object) {
            if (! is_array($object)) {
                continue;
            }

            $type = trim((string) ($object['type'] ?? $object['object_type'] ?? ''));
            $hostName = trim((string) ($object['host_name'] ?? $object['hostName'] ?? ''));
            $serviceName = trim((string) ($object['service_name'] ?? $object['serviceName'] ?? ''));

            if (! in_array($type, ['host', 'service'], true) || $hostName === '') {
                continue;
            }

            if ($type === 'service') {
                if ($serviceName === '') {
                    continue;
                }
            } else {
                $serviceName = null;
            }

            $normalized[] = [
                'type' => $type,
                'host_name' => $hostName,
                'service_name' => $serviceName
            ];
        }

        return $normalized;
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
