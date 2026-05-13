<?php

declare(strict_types=1);

namespace Splitbrain\DocExtract;

interface Extractor
{
    /**
     * Extract plain text from the given file.
     *
     * @throws Exception\ExtractionException on I/O or parse failure
     */
    public function extract(string $path): string;

    /**
     * Whether this extractor can handle the given file (based on extension).
     */
    public function supports(string $path): bool;
}
