#!/usr/bin/env php
<?php

declare(strict_types=1);

$rootDir = dirname(__DIR__);
$baselineFile = $rootDir . '/phpstan-baseline.neon';
$budgetFile = $rootDir . '/phpstan-baseline-budget';

if (! is_file($baselineFile)) {
    fwrite(STDERR, "Missing baseline file: {$baselineFile}\n");
    exit(2);
}

if (! is_file($budgetFile)) {
    fwrite(STDERR, "Missing budget file: {$budgetFile}\n");
    exit(2);
}

$baseline = file_get_contents($baselineFile);
$budget = trim((string) file_get_contents($budgetFile));

if ($baseline === false) {
    fwrite(STDERR, "Cannot read baseline file: {$baselineFile}\n");
    exit(2);
}

if (! ctype_digit($budget)) {
    fwrite(STDERR, "Invalid budget value in {$budgetFile}: '{$budget}'\n");
    exit(2);
}

$current = preg_match_all('/^\s*message:\s/m', $baseline);
$allowed = (int) $budget;

if ($current === false) {
    fwrite(STDERR, "Failed to count baseline entries in {$baselineFile}\n");
    exit(2);
}

if ($current > $allowed) {
    fwrite(
        STDERR,
        "PHPStan baseline budget exceeded: {$current} > {$allowed}.\n"
        . "Please fix issues or update {$budgetFile} with justification.\n"
    );
    exit(1);
}

fwrite(STDOUT, "PHPStan baseline budget OK: {$current}/{$allowed}\n");
