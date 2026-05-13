<?php

declare(strict_types=1);

namespace Splitbrain\DocExtract\Extractor;

use FilesystemIterator;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use Splitbrain\DocExtract\Exception\ExtractionException;
use Splitbrain\DocExtract\Extractor;
use splitbrain\PHPArchive\Zip;
use XMLReader;

abstract class AbstractOoxmlExtractor implements Extractor
{
    private string $tempDir = '';

    abstract protected function extension(): string;

    abstract protected function extractText(): string;

    public function supports(string $path): bool
    {
        return strtolower(pathinfo($path, PATHINFO_EXTENSION)) === $this->extension();
    }

    public function extract(string $path): string
    {
        if (!is_file($path)) {
            throw new ExtractionException("File not found: $path");
        }

        $this->tempDir = $this->makeTempDir();
        try {
            $zip = new Zip();
            $zip->open($path);
            $zip->extract($this->tempDir);
            $zip->close();

            return $this->extractText();
        } catch (ExtractionException $e) {
            throw $e;
        } catch (\Throwable $e) {
            throw new ExtractionException(
                "Failed to extract text from $path: " . $e->getMessage(),
                0,
                $e,
            );
        } finally {
            if ($this->tempDir !== '') {
                $this->cleanup($this->tempDir);
                $this->tempDir = '';
            }
        }
    }

    protected function readPart(string $internalPath): ?string
    {
        $full = $this->tempDir . '/' . ltrim($internalPath, '/');
        if (!is_file($full)) {
            return null;
        }
        $data = file_get_contents($full);
        return $data === false ? null : $data;
    }

    /**
     * @return string[] internal paths (relative to archive root) matching the prefix
     */
    protected function listParts(string $prefix): array
    {
        if (!is_dir($this->tempDir)) {
            return [];
        }
        $base = $this->tempDir . '/';
        $results = [];
        $it = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($this->tempDir, FilesystemIterator::SKIP_DOTS),
        );
        foreach ($it as $file) {
            if (!$file->isFile()) {
                continue;
            }
            $rel = str_replace('\\', '/', substr($file->getPathname(), strlen($base)));
            if (str_starts_with($rel, $prefix)) {
                $results[] = $rel;
            }
        }
        sort($results, SORT_NATURAL);
        return $results;
    }

    /**
     * Stream-parse XML and concatenate text from elements matching $textElement.
     * Block elements emit a newline; tab elements emit a tab.
     */
    protected function extractTextFromXml(
        string $xml,
        string $textElement,
        array $blockElements = [],
        array $tabElements = [],
    ): string {
        $reader = new XMLReader();
        if (!$reader->XML($xml, 'UTF-8', LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING)) {
            throw new ExtractionException('Failed to parse XML');
        }
        try {
            $out = '';
            $blocks = array_flip($blockElements);
            $tabs = array_flip($tabElements);
            while ($reader->read()) {
                if ($reader->nodeType !== XMLReader::ELEMENT) {
                    continue;
                }
                $local = $reader->localName;
                if ($local === $textElement) {
                    $out .= $reader->readString();
                } elseif (isset($blocks[$local])) {
                    if ($out !== '' && !str_ends_with($out, "\n")) {
                        $out .= "\n";
                    }
                } elseif (isset($tabs[$local])) {
                    $out .= "\t";
                }
            }
            return $out;
        } finally {
            $reader->close();
        }
    }

    private function makeTempDir(): string
    {
        $dir = sys_get_temp_dir() . '/doc-extract-' . bin2hex(random_bytes(8));
        if (!@mkdir($dir, 0700, true) && !is_dir($dir)) {
            throw new ExtractionException("Could not create temp dir: $dir");
        }
        return $dir;
    }

    private function cleanup(string $dir): void
    {
        if (!is_dir($dir)) {
            return;
        }
        $it = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS),
            RecursiveIteratorIterator::CHILD_FIRST,
        );
        foreach ($it as $file) {
            if ($file->isDir()) {
                @rmdir($file->getPathname());
            } else {
                @unlink($file->getPathname());
            }
        }
        @rmdir($dir);
    }
}
