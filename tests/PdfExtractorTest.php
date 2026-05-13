<?php

declare(strict_types=1);

namespace Splitbrain\DocExtract\Tests;

use PHPUnit\Framework\TestCase;
use Splitbrain\DocExtract\Exception\ExtractionException;
use Splitbrain\DocExtract\Extractor\PdfExtractor;

final class PdfExtractorTest extends TestCase
{
    private static string $tmp = '';
    private static string $fixture = '';

    public static function setUpBeforeClass(): void
    {
        self::$tmp = FixtureBuilder::tempDir();
        self::$fixture = self::$tmp . '/sample.pdf';
        FixtureBuilder::buildPdf(self::$fixture, 'Hello PDF world');
    }

    public static function tearDownAfterClass(): void
    {
        FixtureBuilder::cleanup(self::$tmp);
    }

    public function testExtractsText(): void
    {
        $text = (new PdfExtractor())->extract(self::$fixture);
        $this->assertStringContainsString('Hello PDF world', $text);
    }

    public function testMissingFileThrows(): void
    {
        $this->expectException(ExtractionException::class);
        (new PdfExtractor())->extract(self::$tmp . '/nonexistent.pdf');
    }

    public function testSupports(): void
    {
        $e = new PdfExtractor();
        $this->assertTrue($e->supports('foo.pdf'));
        $this->assertTrue($e->supports('foo.PDF'));
        $this->assertFalse($e->supports('foo.docx'));
    }
}
