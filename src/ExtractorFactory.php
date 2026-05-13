<?php

declare(strict_types=1);

namespace Splitbrain\DocExtract;

use Splitbrain\DocExtract\Exception\UnsupportedFormatException;
use Splitbrain\DocExtract\Extractor\DocxExtractor;
use Splitbrain\DocExtract\Extractor\PdfExtractor;
use Splitbrain\DocExtract\Extractor\PptxExtractor;
use Splitbrain\DocExtract\Extractor\XlsxExtractor;

final class ExtractorFactory
{
    /**
     * Return an Extractor for the given file, based on its extension.
     *
     * @throws UnsupportedFormatException if the extension is not recognised
     */
    public static function forFile(string $path): Extractor
    {
        $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        return match ($ext) {
            'docx' => new DocxExtractor(),
            'xlsx' => new XlsxExtractor(),
            'pptx' => new PptxExtractor(),
            'pdf' => new PdfExtractor(),
            default => throw new UnsupportedFormatException(
                $ext === ''
                    ? "Cannot determine format: no file extension on $path"
                    : "Unsupported file extension: .$ext",
            ),
        };
    }

    /**
     * Convenience: pick the right extractor and run it.
     */
    public static function extract(string $path): string
    {
        return self::forFile($path)->extract($path);
    }
}
