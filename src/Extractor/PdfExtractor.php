<?php

declare(strict_types=1);

namespace Splitbrain\DocExtract\Extractor;

use Smalot\PdfParser\Parser;
use Splitbrain\DocExtract\Exception\ExtractionException;
use Splitbrain\DocExtract\Extractor;

final class PdfExtractor implements Extractor
{
    public function supports(string $path): bool
    {
        return strtolower(pathinfo($path, PATHINFO_EXTENSION)) === 'pdf';
    }

    public function extract(string $path): string
    {
        if (!is_file($path)) {
            throw new ExtractionException("File not found: $path");
        }
        try {
            $pdf = (new Parser())->parseFile($path);
            return trim($pdf->getText());
        } catch (\Throwable $e) {
            throw new ExtractionException(
                "Failed to extract text from $path: " . $e->getMessage(),
                0,
                $e,
            );
        }
    }
}
