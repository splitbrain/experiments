<?php

declare(strict_types=1);

namespace Splitbrain\DocExtract\Extractor;

use Splitbrain\DocExtract\Exception\ExtractionException;

final class DocxExtractor extends AbstractOoxmlExtractor
{
    protected function extension(): string
    {
        return 'docx';
    }

    protected function extractText(): string
    {
        $doc = $this->readPart('word/document.xml');
        if ($doc === null) {
            throw new ExtractionException('Not a valid DOCX file: missing word/document.xml');
        }

        $parts = [
            $this->extractDocxText($doc),
        ];

        foreach ($this->listParts('word/header') as $headerPath) {
            if (str_ends_with($headerPath, '.xml')) {
                $xml = $this->readPart($headerPath);
                if ($xml !== null) {
                    $parts[] = $this->extractDocxText($xml);
                }
            }
        }
        foreach ($this->listParts('word/footer') as $footerPath) {
            if (str_ends_with($footerPath, '.xml')) {
                $xml = $this->readPart($footerPath);
                if ($xml !== null) {
                    $parts[] = $this->extractDocxText($xml);
                }
            }
        }

        return trim(implode("\n", array_filter($parts, fn ($p) => $p !== '')));
    }

    private function extractDocxText(string $xml): string
    {
        return $this->extractTextFromXml(
            $xml,
            textElement: 't',
            blockElements: ['p', 'br'],
            tabElements: ['tab'],
        );
    }
}
