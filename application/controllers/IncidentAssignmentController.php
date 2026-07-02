<?php

// SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

namespace Icinga\Controllers;

use Exception;
use Icinga\Authentication\User\DomainAwareInterface;
use Icinga\Module\Icingadb\Common\Backend as IcingadbBackend;
use Icinga\Module\Icingadb\Model\Host;
use Icinga\Module\Icingadb\Model\Service;
use Icinga\User;
use Icinga\Web\Controller\AuthBackendController;
use Icinga\Web\IncidentAssignment\IncidentAssignmentStore;
use Icinga\Util\Json;
use ipl\Stdlib\Filter;

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

        try {
            $criticalObjects = $this->loadCriticalObjects();
            $store = IncidentAssignmentStore::create();
            $assignments = $store->loadMany($criticalObjects);
            $summary = $this->buildAssignmentSummary($criticalObjects, $assignments);
        } catch (Exception $e) {
            $this->respondWithJson(['error' => $e->getMessage()], 500);
            return;
        }

        $this->respondWithJson([
            'ok' => true,
            'objects' => $criticalObjects,
            'assignments' => $assignments,
            'summary' => $summary,
            'currentUser' => $this->Auth()->getUser()->getUsername(),
            'lanes' => $summary['lanes']
        ]);
    }

    public function assignedAction()
    {
        $this->assertAuthenticated();

        $assigned = trim((string) $this->params->get('assigned', ''));

        try {
            $criticalObjects = $this->loadCriticalObjects();
            $store = IncidentAssignmentStore::create();
            $assignments = $store->loadMany($criticalObjects);
            $filteredObjects = $this->filterObjectsByAssigned($criticalObjects, $assignments, $assigned);
        } catch (Exception $e) {
            $this->getResponse()
                ->setHttpResponseCode(500)
                ->setHeader('Content-Type', 'text/plain; charset=utf-8', true)
                ->setBody($e->getMessage());
            return;
        }

        $this->getResponse()
            ->setHeader('Content-Type', 'text/html; charset=utf-8', true)
            ->setBody($this->renderAssignedObjects($filteredObjects, $assignments, $assigned));
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

    protected function buildAssignmentSummary(array $objects, array $assignments)
    {
        $summary = [
            'me' => 0,
            'assigned' => 0,
            'unassigned' => 0,
            'total' => count($objects),
            'lanes' => [
                'me' => [
                    'title' => '',
                    'meta' => '',
                    'url' => ''
                ],
                'assigned' => [
                    'title' => '',
                    'meta' => '',
                    'url' => ''
                ],
                'unassigned' => [
                    'title' => '',
                    'meta' => '',
                    'url' => ''
                ]
            ]
        ];
        $currentUserNames = $this->getCurrentUserNames();

        foreach ($objects as $object) {
            $signature = $this->buildObjectSignature($object);
            if ($signature === null) {
                continue;
            }

            $assignment = $assignments[$signature] ?? null;
            $assignee = $assignment ? (string) ($assignment['assignee'] ?? '') : '';
            $lane = $this->getAssignmentLane($assignee, $currentUserNames);

            if ($lane === 'me') {
                $summary['me'] += 1;
            } elseif ($lane === 'assigned') {
                $summary['assigned'] += 1;
            } else {
                $summary['unassigned'] += 1;
            }

            if ($summary['lanes'][$lane]['title'] === '') {
                $summary['lanes'][$lane] = [
                    'title' => $this->getObjectLabel($object),
                    'meta' => $this->getObjectMeta($object, $assignment),
                    'url' => $this->getObjectUrl($object)
                ];
            }
        }

        return $summary;
    }

    protected function loadCriticalObjects()
    {
        $db = IcingadbBackend::getDb();
        $objects = [];

        foreach (
            Host::on($db)
                ->with(['state'])
                ->filter(Filter::equal('state.is_problem', 'y')) as $host
        ) {
            $objects[] = [
                'type' => 'host',
                'host_name' => (string) $host->name,
                'service_name' => null
            ];
        }

        foreach (
            Service::on($db)
                ->with(['state', 'host'])
                ->filter(Filter::equal('state.is_problem', 'y')) as $service
        ) {
            $objects[] = [
                'type' => 'service',
                'host_name' => (string) ($service->host->name ?? ''),
                'service_name' => (string) $service->name
            ];
        }

        return $objects;
    }

    protected function getAssignmentLane($assignee, array $currentUserNames)
    {
        if (! trim((string) $assignee)) {
            return 'unassigned';
        }

        return $this->isAssigneeCurrentUser($assignee, $currentUserNames) ? 'me' : 'assigned';
    }

    protected function buildObjectSignature(array $object)
    {
        $type = trim((string) ($object['type'] ?? ''));
        $hostName = trim((string) ($object['host_name'] ?? ''));
        $serviceName = trim((string) ($object['service_name'] ?? ''));

        if (! in_array($type, ['host', 'service'], true) || $hostName === '') {
            return null;
        }

        if ($type === 'service' && $serviceName === '') {
            return null;
        }

        return $type . '|' . $hostName . '|' . ($type === 'service' ? $serviceName : '');
    }

    protected function filterObjectsByAssigned(array $objects, array $assignments, $assigned)
    {
        $filtered = [];

        foreach ($objects as $object) {
            $signature = $this->buildObjectSignature($object);
            if ($signature === null) {
                continue;
            }

            $assignment = $assignments[$signature] ?? null;
            $assignee = is_array($assignment) ? trim((string) ($assignment['assignee'] ?? '')) : '';

            if (! $this->matchesAssignedFilter($assignee, $assigned)) {
                continue;
            }

            $filtered[] = $object;
        }

        return $filtered;
    }

    protected function matchesAssignedFilter($assignee, $assigned)
    {
        $assignee = strtolower(trim((string) $assignee));
        $assigned = strtolower(trim((string) $assigned));

        if ($assigned === '' || $assigned === 'true') {
            return $assignee !== '';
        }

        if ($assigned === 'false') {
            return $assignee === '';
        }

        return $assignee === $assigned;
    }

    protected function renderAssignedObjects(array $objects, array $assignments, $assigned)
    {
        $title = $this->getAssignedFilterTitle($assigned);

        $html = [];
        $html[] = '<div class="incident-assignment-search">';
        $html[] = '<h2>' . htmlspecialchars($title, ENT_QUOTES, 'UTF-8') . '</h2>';
        $html[] = '<p>' . htmlspecialchars(sprintf('%d matching incidents', count($objects)), ENT_QUOTES, 'UTF-8') . '</p>';

        if (! count($objects)) {
            $html[] = '<p>' . htmlspecialchars('No matching incidents', ENT_QUOTES, 'UTF-8') . '</p>';
            $html[] = '</div>';
            return join('', $html);
        }

        $html[] = '<ul class="incident-assignment-search-list">';
        foreach ($objects as $object) {
            $signature = $this->buildObjectSignature($object);
            $assignment = $signature !== null && array_key_exists($signature, $assignments) ? $assignments[$signature] : null;
            $label = htmlspecialchars($this->getObjectLabel($object), ENT_QUOTES, 'UTF-8');
            $url = htmlspecialchars($this->getObjectUrl($object), ENT_QUOTES, 'UTF-8');
            $meta = htmlspecialchars($this->getObjectMeta($object, $assignment), ENT_QUOTES, 'UTF-8');
            $html[] = '<li class="incident-assignment-search-item">';
            $html[] = '<a href="' . $url . '">' . $label . '</a>';
            if ($meta !== '') {
                $html[] = '<div class="incident-assignment-search-meta">' . $meta . '</div>';
            }
            $html[] = '</li>';
        }
        $html[] = '</ul>';
        $html[] = '</div>';

        return join('', $html);
    }

    protected function getAssignedFilterTitle($assigned)
    {
        $assigned = trim((string) $assigned);

        if ($assigned === '' || strtolower($assigned) === 'true') {
            return 'Assigned incidents';
        }

        if (strtolower($assigned) === 'false') {
            return 'Unassigned incidents';
        }

        return 'Assigned to ' . $assigned;
    }

    protected function getObjectLabel(array $object)
    {
        if (($object['type'] ?? '') === 'service') {
            return sprintf(
                '%s on %s',
                (string) ($object['service_name'] ?? ''),
                (string) ($object['host_name'] ?? '')
            );
        }

        return (string) ($object['host_name'] ?? '');
    }

    protected function getObjectMeta(array $object, $assignment = null)
    {
        if (! is_array($assignment) || ! trim((string) ($assignment['assignee'] ?? ''))) {
            return 'Not assigned';
        }

        return 'Assigned to ' . (string) $assignment['assignee'];
    }

    protected function getObjectUrl(array $object)
    {
        $baseUrl = (string) $this->getRequest()->getBaseUrl();
        if ($baseUrl === '/') {
            $baseUrl = '';
        }

        if (($object['type'] ?? '') === 'service') {
            return $baseUrl . '/icingadb/service?service.name=' . rawurlencode((string) $object['service_name'])
                . '&host.name=' . rawurlencode((string) $object['host_name']);
        }

        return $baseUrl . '/icingadb/host?host.name=' . rawurlencode((string) $object['host_name']);
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
