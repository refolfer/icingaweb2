<?php

// SPDX-FileCopyrightText: 2018 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

namespace Icinga\Application\Hook;

use Icinga\Application\Hook;
use ipl\Html\ValidHtml;
use RuntimeException;

/**
 * Base class for the PDF Export Hook
 */
abstract class PdfexportHook
{
    /**
     * Get the first hook
     *
     * @return static
     */
    public static function first()
    {
        if (! Hook::has('Pdfexport')) {
            throw new RuntimeException('No PDF exporter available');
        }
        $pdfexport = Hook::first('Pdfexport');
        if (! $pdfexport->isSupported()) {
            throw new RuntimeException('PDF exporter is not supported');
        }
        return $pdfexport;
    }

    /**
     * Get whether PDF export is supported
     *
     * @return  bool
     */
    abstract public function isSupported();

    /**
     * Render the specified HTML to PDF and stream it to the client
     *
     * @param ValidHtml $html The HTML to render to PDF
     * @param string $filename The filename for the generated PDF
     * @return never
     */
    abstract public function streamPdfFromHtml($html, $filename);

    /**
     * Render the specified HTML to PDF and return the PDF document as a string
     *
     * @param ValidHtml $html The HTML to render to PDF
     *
     * @return string
     */
    abstract public function htmlToPdf($html);
}
