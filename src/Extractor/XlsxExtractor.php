<?php

declare(strict_types=1);

namespace Splitbrain\DocExtract\Extractor;

use Splitbrain\DocExtract\Exception\ExtractionException;
use XMLReader;

final class XlsxExtractor extends AbstractOoxmlExtractor
{
    protected function extension(): string
    {
        return 'xlsx';
    }

    protected function extractText(): string
    {
        $sharedStrings = $this->loadSharedStrings();
        $sheetNames = $this->loadSheetNames();

        $sheetPaths = array_filter(
            $this->listParts('xl/worksheets/sheet'),
            fn ($p) => str_ends_with($p, '.xml'),
        );
        if ($sheetPaths === []) {
            throw new ExtractionException('Not a valid XLSX file: no worksheets found');
        }

        $out = [];
        $i = 0;
        foreach ($sheetPaths as $path) {
            $xml = $this->readPart($path);
            if ($xml === null) {
                continue;
            }
            $name = $sheetNames[$i] ?? ('Sheet' . ($i + 1));
            $i++;
            $body = $this->extractSheet($xml, $sharedStrings);
            $out[] = "=== Sheet: $name ===\n" . $body;
        }

        return trim(implode("\n", $out));
    }

    /**
     * @return string[]
     */
    private function loadSharedStrings(): array
    {
        $xml = $this->readPart('xl/sharedStrings.xml');
        if ($xml === null) {
            return [];
        }
        $strings = [];
        $reader = new XMLReader();
        if (!$reader->XML($xml, 'UTF-8', LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING)) {
            return [];
        }
        try {
            while ($reader->read()) {
                if ($reader->nodeType === XMLReader::ELEMENT && $reader->localName === 'si') {
                    $strings[] = $reader->readString();
                }
            }
        } finally {
            $reader->close();
        }
        return $strings;
    }

    /**
     * @return string[] sheet display names in workbook order
     */
    private function loadSheetNames(): array
    {
        $xml = $this->readPart('xl/workbook.xml');
        if ($xml === null) {
            return [];
        }
        $names = [];
        $reader = new XMLReader();
        if (!$reader->XML($xml, 'UTF-8', LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING)) {
            return [];
        }
        try {
            while ($reader->read()) {
                if ($reader->nodeType === XMLReader::ELEMENT && $reader->localName === 'sheet') {
                    $name = $reader->getAttribute('name');
                    if ($name !== null) {
                        $names[] = $name;
                    }
                }
            }
        } finally {
            $reader->close();
        }
        return $names;
    }

    /**
     * @param string[] $sharedStrings
     */
    private function extractSheet(string $xml, array $sharedStrings): string
    {
        $reader = new XMLReader();
        if (!$reader->XML($xml, 'UTF-8', LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING)) {
            throw new ExtractionException('Failed to parse sheet XML');
        }
        try {
            $out = '';
            $rowFirst = true;
            $cellFirst = true;
            while ($reader->read()) {
                if ($reader->nodeType !== XMLReader::ELEMENT) {
                    continue;
                }
                $local = $reader->localName;
                if ($local === 'row') {
                    if (!$rowFirst) {
                        $out .= "\n";
                    }
                    $rowFirst = false;
                    $cellFirst = true;
                } elseif ($local === 'c') {
                    $type = $reader->getAttribute('t') ?? '';
                    if (!$cellFirst) {
                        $out .= "\t";
                    }
                    $cellFirst = false;
                    $value = $this->readCellValue($reader);
                    if ($type === 's' && is_numeric($value)) {
                        $idx = (int) $value;
                        $value = $sharedStrings[$idx] ?? '';
                    }
                    $out .= $value;
                }
            }
            return $out;
        } finally {
            $reader->close();
        }
    }

    private function readCellValue(XMLReader $reader): string
    {
        if ($reader->isEmptyElement) {
            return '';
        }
        $value = '';
        while ($reader->read()) {
            $nt = $reader->nodeType;
            $ln = $reader->localName;
            if ($nt === XMLReader::ELEMENT && ($ln === 'v' || $ln === 't')) {
                $value .= $reader->readString();
            } elseif ($nt === XMLReader::END_ELEMENT && $ln === 'c') {
                break;
            }
        }
        return $value;
    }
}
