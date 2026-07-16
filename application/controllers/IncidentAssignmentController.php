<?php

// SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

namespace Icinga\Controllers;

use Exception;
use Icinga\Exception\ProgrammingError;
use Icinga\Authentication\User\DomainAwareInterface;
use Icinga\Module\Icingadb\Common\Backend as IcingadbBackend;
use Icinga\Module\Icingadb\Model\Host;
use Icinga\Module\Icingadb\Model\Service;
use Icinga\User;
use Icinga\Web\Controller\AuthBackendController;
use Icinga\Module\Modernui\IncidentAssignment\IncidentAssignmentStore;
use Icinga\Web\Security\CsrfToken;
use Icinga\Util\Json;
use ipl\Stdlib\Filter;

class IncidentAssignmentController extends AuthBackendController
{
    private const HOST_CRITICAL_STATE = 1;
    private const SERVICE_CRITICAL_STATE = 2;

    public function init(): void
    {
        parent::init();
        // @phpstan-ignore-next-line Zend helper methods are resolved dynamically.
        $this->_helper->layout->disableLayout();
        // @phpstan-ignore-next-line Zend helper methods are resolved dynamically.
        $this->_helper->viewRenderer->setNoRender(true);
    }

    public function indexAction(): void
    {
        $this->getResponse()->setHttpResponseCode(404);
    }

    public function getAction(): void
    {
        if (! $this->assertAuthenticated()) {
            return;
        }
        $response = $this->getResponse();

        $response->setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0', true);
        $response->setHeader('Pragma', 'no-cache', true);

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

        $canAssign = $this->getAuthenticatedUser()->can('application/critical-assignments');
        $includeUsers = $this->stringValue($this->params->get('include_users', '1')) !== '0';

        $this->respondWithJson([
            'ok' => true,
            'object' => $object,
            'assignment' => $assignment,
            'users' => $canAssign && $includeUsers ? $this->collectAssignableUsers() : [],
            'canAssign' => $canAssign,
            'csrfToken' => $canAssign ? CsrfToken::generate() : null
        ]);
    }

    public function setAction(): void
    {
        if (! $this->assertAuthenticated()) {
            return;
        }
        $this->assertPermission('application/critical-assignments');
        $this->assertHttpMethod('POST');
        if (! $this->assertValidCsrfToken()) {
            return;
        }

        $object = $this->getObjectFromRequest();
        $rawParams = $this->getRawRequestParams();
        $assignee = trim($this->stringValue($this->getRequestValue('assignee', '', $rawParams)));
        $note = null;
        if ($this->params->get('note', null) !== null || array_key_exists('note', $rawParams)) {
            $note = $this->sanitizeAssignmentNote($this->getRequestValue('note', '', $rawParams));
        }

        if ($object === null) {
            $this->respondWithJson(['error' => 'Missing object identifiers'], 400);
            return;
        }

        if (! $this->objectExists($object)) {
            $this->respondWithJson(['error' => 'The selected monitoring object no longer exists'], 404);
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
                'canAssign' => true,
                'csrfToken' => CsrfToken::generate()
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
                $this->getAuthenticatedUser()->getUsername(),
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
            'canAssign' => true,
            'csrfToken' => CsrfToken::generate()
        ]);
    }

    public function summaryAction(): void
    {
        if (! $this->assertAuthenticated()) {
            return;
        }

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
            'currentUser' => $this->getAuthenticatedUser()->getUsername(),
            'lanes' => $summary['lanes']
        ]);
    }

    public function assignedAction(): void
    {
        if (! $this->assertAuthenticated()) {
            return;
        }

        $assigned = trim($this->stringValue($this->params->get('assigned', '')));

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

    /** @return array{type:string,host_name:string,service_name:?string}|null */
    protected function getObjectFromRequest(): ?array
    {
        $rawParams = $this->getRawRequestParams();
        $type = trim($this->stringValue($this->getRequestValue('type', '', $rawParams)));
        if ($type === '') {
            $type = trim($this->stringValue($this->getRequestValue('object_type', '', $rawParams)));
        }

        $hostName = trim($this->stringValue($this->getRequestValue(
            'host.name',
            $this->getRequestValue('host_name', '', $rawParams),
            $rawParams
        )));
        if ($hostName === '') {
            $hostName = trim($this->stringValue(
                $this->getRequestValue('object_host_name', '', $rawParams)
            ));
        }

        $serviceName = trim($this->stringValue($this->getRequestValue(
            'service.name',
            $this->getRequestValue('service_name', '', $rawParams),
            $rawParams
        )));
        if ($serviceName === '') {
            $serviceName = trim($this->stringValue(
                $this->getRequestValue('object_service_name', '', $rawParams)
            ));
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

    /** @return list<array{type:string,host_name:string,service_name:?string}> */
    protected function getObjectsFromRequest(): array
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

    protected function sanitizeAssignmentNote(mixed $note): string
    {
        return mb_substr(trim($this->stringValue($note)), 0, 1024);
    }

    /** @param array<string,mixed> $rawParams */
    protected function getRequestValue(string $key, mixed $default = '', array $rawParams = []): mixed
    {
        $value = $default;

        if ($this->params->get($key, null) !== null) {
            $safeDefault = is_bool($default) || is_int($default) || is_string($default) || $default === null
                ? $default
                : null;
            $value = $this->params->get($key, $safeDefault);
        } elseif (array_key_exists($key, $rawParams)) {
            $value = $rawParams[$key];
        } elseif ($key === 'host.name' && array_key_exists('host_name', $rawParams)) {
            $value = $rawParams['host_name'];
        } elseif ($key === 'service.name' && array_key_exists('service_name', $rawParams)) {
            $value = $rawParams['service_name'];
        }

        return $value;
    }

    /** @return array<string,mixed> */
    protected function getRawRequestParams(): array
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

        $normalized = [];
        foreach ($parsed as $key => $value) {
            $normalized[(string) $key] = $value;
        }

        return $normalized;
    }

    /** @return list<string> */
    protected function collectAssignableUsers(): array
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

    protected function isKnownUser(string $userName): bool
    {
        return in_array($userName, $this->collectAssignableUsers(), true);
    }

    /**
     * @param list<array<string,mixed>> $objects
     * @param array<string,array<string,mixed>> $assignments
     * @return array<string,mixed>
     */
    protected function buildAssignmentSummary(array $objects, array $assignments): array
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
            $assignee = $assignment ? $this->stringValue($assignment['assignee'] ?? '') : '';
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

    /** @return list<array{type:string,host_name:string,service_name:?string}> */
    protected function loadCriticalObjects(): array
    {
        $db = IcingadbBackend::getDb();
        $objects = [];

        $hosts = Host::on($db)
            ->with(['state'])
            ->filter(Filter::all(
                Filter::equal('state.is_problem', 'y'),
                Filter::equal('state.soft_state', self::HOST_CRITICAL_STATE)
            ));
        foreach ($hosts as $host) {
            /** @var Host $host */
            $objects[] = [
                'type' => 'host',
                'host_name' => (string) $host->name,
                'service_name' => null
            ];
        }

        $services = Service::on($db)
            ->with(['state', 'host'])
            ->filter(Filter::all(
                Filter::equal('state.is_problem', 'y'),
                Filter::equal('state.soft_state', self::SERVICE_CRITICAL_STATE)
            ));
        foreach ($services as $service) {
            /** @var Service $service */
            /** @var Host|null $host */
            $host = $service->host;
            $objects[] = [
                'type' => 'service',
                'host_name' => $host === null ? '' : $host->name,
                'service_name' => (string) $service->name
            ];
        }

        return $objects;
    }

    /** @param array{type:string,host_name:string,service_name:?string} $object */
    protected function objectExists(array $object): bool
    {
        $db = IcingadbBackend::getDb();

        if ($object['type'] === 'host') {
            $query = Host::on($db)
                ->filter(Filter::equal('name', $object['host_name']))
                ->limit(1);
        } else {
            $query = Service::on($db)
                ->with(['host'])
                ->filter(Filter::all(
                    Filter::equal('name', $object['service_name']),
                    Filter::equal('host.name', $object['host_name'])
                ))
                ->limit(1);
        }

        foreach ($query as $_) {
            return true;
        }

        return false;
    }

    /** @param list<string> $currentUserNames */
    protected function getAssignmentLane(string $assignee, array $currentUserNames): string
    {
        if (! trim((string) $assignee)) {
            return 'unassigned';
        }

        return $this->isAssigneeCurrentUser($assignee, $currentUserNames) ? 'me' : 'assigned';
    }

    /** @param array<string,mixed> $object */
    protected function buildObjectSignature(array $object): ?string
    {
        $type = trim($this->stringValue($object['type'] ?? ''));
        $hostName = trim($this->stringValue($object['host_name'] ?? ''));
        $serviceName = trim($this->stringValue($object['service_name'] ?? ''));

        if (! in_array($type, ['host', 'service'], true) || $hostName === '') {
            return null;
        }

        if ($type === 'service' && $serviceName === '') {
            return null;
        }

        return $type . '|' . $hostName . '|' . ($type === 'service' ? $serviceName : '');
    }

    /**
     * @param list<array<string,mixed>> $objects
     * @param array<string,array<string,mixed>> $assignments
     * @return list<array<string,mixed>>
     */
    protected function filterObjectsByAssigned(array $objects, array $assignments, string $assigned): array
    {
        $filtered = [];

        foreach ($objects as $object) {
            $signature = $this->buildObjectSignature($object);
            if ($signature === null) {
                continue;
            }

            $assignment = $assignments[$signature] ?? null;
            $assignee = is_array($assignment)
                ? trim($this->stringValue($assignment['assignee'] ?? ''))
                : '';

            if (! $this->matchesAssignedFilter($assignee, $assigned)) {
                continue;
            }

            $filtered[] = $object;
        }

        return $filtered;
    }

    protected function matchesAssignedFilter(string $assignee, string $assigned): bool
    {
        $assigned = strtolower(trim((string) $assigned));
        $assigneeNames = $this->normalizeAssigneeNames($assignee);
        $assignedNames = $this->normalizeAssigneeNames($assigned);

        if ($assigned === '' || $assigned === 'true') {
            return count($assigneeNames) > 0;
        }

        if ($assigned === 'false') {
            return count($assigneeNames) === 0;
        }

        return $this->namesOverlap($assigneeNames, $assignedNames);
    }

    /**
     * @param list<array<string,mixed>> $objects
     * @param array<string,array<string,mixed>> $assignments
     */
    protected function renderAssignedObjects(array $objects, array $assignments, string $assigned): string
    {
        $title = $this->getAssignedFilterTitle($assigned);

        $html = [];
        $html[] = '<div class="incident-assignment-search">';
        $html[] = '<h2>' . htmlspecialchars($title, ENT_QUOTES, 'UTF-8') . '</h2>';
        $html[] = '<p>'
            . htmlspecialchars(sprintf('%d matching incidents', count($objects)), ENT_QUOTES, 'UTF-8')
            . '</p>';

        if (! count($objects)) {
            $html[] = '<p>' . htmlspecialchars('No matching incidents', ENT_QUOTES, 'UTF-8') . '</p>';
            $html[] = '</div>';
            return join('', $html);
        }

        $html[] = '<ul class="incident-assignment-search-list">';
        foreach ($objects as $object) {
            $signature = $this->buildObjectSignature($object);
            $assignment = $signature !== null && array_key_exists($signature, $assignments)
                ? $assignments[$signature]
                : null;
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

    protected function getAssignedFilterTitle(string $assigned): string
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

    /** @return list<string> */
    protected function normalizeAssigneeNames(string $value): array
    {
        $names = [];
        $normalized = strtolower(trim((string) $value));

        if ($normalized === '') {
            return $names;
        }

        $names[] = $normalized;
        if (strpos($normalized, '@') !== false) {
            $local = strtok($normalized, '@');
            if ($local !== false && $local !== '') {
                $names[] = $local;
            }
        }

        return array_values(array_unique(array_filter($names)));
    }

    /**
     * @param list<string> $left
     * @param list<string> $right
     */
    protected function namesOverlap(array $left, array $right): bool
    {
        return count(array_intersect($left, $right)) > 0;
    }

    /** @param array<string,mixed> $object */
    protected function getObjectLabel(array $object): string
    {
        if (($object['type'] ?? '') === 'service') {
            return sprintf(
                '%s on %s',
                $this->stringValue($object['service_name'] ?? ''),
                $this->stringValue($object['host_name'] ?? '')
            );
        }

        return $this->stringValue($object['host_name'] ?? '');
    }

    /** @param array<string,mixed> $object */
    protected function getObjectMeta(array $object, mixed $assignment = null): string
    {
        if (! is_array($assignment) || ! trim($this->stringValue($assignment['assignee'] ?? ''))) {
            return 'Not assigned';
        }

        return 'Assigned to ' . $this->stringValue($assignment['assignee']);
    }

    /** @param array<string,mixed> $object */
    protected function getObjectUrl(array $object): string
    {
        $baseUrl = (string) $this->getRequest()->getBaseUrl();
        if ($baseUrl === '/') {
            $baseUrl = '';
        }

        if (($object['type'] ?? '') === 'service') {
            return $baseUrl . '/icingadb/service?name=' . rawurlencode(
                $this->stringValue($object['service_name'] ?? '')
            ) . '&host.name=' . rawurlencode($this->stringValue($object['host_name'] ?? ''));
        }

        return $baseUrl . '/icingadb/host?host.name=' . rawurlencode(
            $this->stringValue($object['host_name'] ?? '')
        );
    }

    /** @return list<string> */
    protected function getCurrentUserNames(): array
    {
        $user = $this->getAuthenticatedUser();
        $names = [];

        $names = array_merge($names, $this->normalizeAssigneeNames($user->getUsername()));
        if (method_exists($user, 'getLocalUsername')) {
            $names = array_merge($names, $this->normalizeAssigneeNames($user->getLocalUsername()));
        }

        return array_values(array_unique(array_filter($names)));
    }

    /** @param list<string> $currentUserNames */
    protected function isAssigneeCurrentUser(string $assignee, array $currentUserNames): bool
    {
        if (! count($currentUserNames)) {
            return false;
        }

        return $this->namesOverlap($this->normalizeAssigneeNames($assignee), $currentUserNames);
    }

    /**
     * @param array<int,mixed> $objects
     * @return list<array{type:string,host_name:string,service_name:?string}>
     */
    protected function normalizeObjects(array $objects): array
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

    protected function assertAuthenticated(): bool
    {
        if (! $this->Auth()->isAuthenticated()) {
            $this->respondWithJson(['error' => 'Unauthorized'], 401);
            return false;
        }

        return true;
    }

    protected function assertValidCsrfToken(): bool
    {
        $rawParams = $this->getRawRequestParams();
        $token = $this->getRequest()->getHeader('X-CSRF-Token');
        if ($token === null || $token === '') {
            $token = $this->getRequestValue('CSRFToken', '', $rawParams);
        }

        if (! CsrfToken::isValid($token)) {
            $this->respondWithJson(['error' => 'Invalid or expired CSRF token'], 403);
            return false;
        }

        return true;
    }

    /** @param array<string,mixed> $payload */
    protected function respondWithJson(array $payload, int $statusCode = 200): void
    {
        $this->getResponse()
            ->setHttpResponseCode((int) $statusCode)
            ->setHeader('Content-Type', 'application/json; charset=utf-8', true)
            ->setBody(Json::sanitize($payload));
    }

    protected function getAuthenticatedUser(): User
    {
        $user = $this->Auth()->getUser();
        if ($user === null) {
            throw new ProgrammingError('This operation requires an authenticated user');
        }

        return $user;
    }

    protected function stringValue(mixed $value): string
    {
        return is_scalar($value) || $value instanceof \Stringable ? (string) $value : '';
    }
}
