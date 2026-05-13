<?php

declare(strict_types=1);

namespace Splitbrain\DocExtract\Extractor;

use Splitbrain\DocExtract\Exception\ExtractionException;
use XMLReader;

final class PptxExtractor extends AbstractOoxmlExtractor
{
    private const RELS_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

    protected function extension(): string
    {
        return 'pptx';
    }

    protected function extractText(): string
    {
        $slidePaths = $this->getSlideOrder();
        if ($slidePaths === []) {
            throw new ExtractionException('Not a valid PPTX file: no slides found');
        }

        $out = [];
        foreach ($slidePaths as $i => $slidePath) {
            $xml = $this->readPart($slidePath);
            if ($xml === null) {
                continue;
            }
            $body = $this->extractSlideText($xml);
            $out[] = "=== Slide " . ($i + 1) . " ===\n" . $body;

            $notesPath = $this->correspondingNotes($slidePath);
            if ($notesPath !== null) {
                $notesXml = $this->readPart($notesPath);
                if ($notesXml !== null) {
                    $notes = $this->extractSlideText($notesXml);
                    if (trim($notes) !== '') {
                        $out[] = "--- Notes ---\n" . $notes;
                    }
                }
            }
        }

        return trim(implode("\n", $out));
    }

    /**
     * @return string[] internal paths of slides in display order
     */
    private function getSlideOrder(): array
    {
        $relsXml = $this->readPart('ppt/_rels/presentation.xml.rels');
        $presXml = $this->readPart('ppt/presentation.xml');

        if ($relsXml === null || $presXml === null) {
            return $this->fallbackSlideOrder();
        }

        $rels = [];
        $reader = new XMLReader();
        if (!$reader->XML($relsXml, 'UTF-8', LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING)) {
            return $this->fallbackSlideOrder();
        }
        try {
            while ($reader->read()) {
                if ($reader->nodeType === XMLReader::ELEMENT && $reader->localName === 'Relationship') {
                    $id = $reader->getAttribute('Id');
                    $target = $reader->getAttribute('Target');
                    if ($id !== null && $target !== null) {
                        $rels[$id] = $target;
                    }
                }
            }
        } finally {
            $reader->close();
        }

        $order = [];
        $reader = new XMLReader();
        if (!$reader->XML($presXml, 'UTF-8', LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING)) {
            return $this->fallbackSlideOrder();
        }
        try {
            while ($reader->read()) {
                if ($reader->nodeType === XMLReader::ELEMENT && $reader->localName === 'sldId') {
                    $rid = $reader->getAttributeNs('id', self::RELS_NS);
                    if ($rid !== null && isset($rels[$rid])) {
                        $order[] = 'ppt/' . ltrim($rels[$rid], '/');
                    }
                }
            }
        } finally {
            $reader->close();
        }

        return $order !== [] ? $order : $this->fallbackSlideOrder();
    }

    /**
     * @return string[]
     */
    private function fallbackSlideOrder(): array
    {
        $slides = array_filter(
            $this->listParts('ppt/slides/slide'),
            fn ($p) => str_ends_with($p, '.xml') && !str_contains($p, '_rels/'),
        );
        return array_values($slides);
    }

    private function correspondingNotes(string $slidePath): ?string
    {
        if (!preg_match('#ppt/slides/slide(\d+)\.xml$#', $slidePath, $m)) {
            return null;
        }
        $notes = 'ppt/notesSlides/notesSlide' . $m[1] . '.xml';
        return $this->readPart($notes) !== null ? $notes : null;
    }

    private function extractSlideText(string $xml): string
    {
        return $this->extractTextFromXml(
            $xml,
            textElement: 't',
            blockElements: ['p', 'br'],
            tabElements: [],
        );
    }
}
