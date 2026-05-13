<?php

declare(strict_types=1);

namespace Splitbrain\DocExtract\Tests;

use PHPUnit\Framework\TestCase;
use Splitbrain\DocExtract\Exception\ExtractionException;
use Splitbrain\DocExtract\Exception\UnsupportedFormatException;
use Splitbrain\DocExtract\Extractor\DocxExtractor;
use Splitbrain\DocExtract\Extractor\PdfExtractor;
use Splitbrain\DocExtract\Extractor\PptxExtractor;
use Splitbrain\DocExtract\Extractor\XlsxExtractor;
use Splitbrain\DocExtract\ExtractorFactory;

final class ExtractorFactoryTest extends TestCase
{
    private static string $tmp = '';

    public static function setUpBeforeClass(): void
    {
        self::$tmp = FixtureBuilder::tempDir();
        FixtureBuilder::buildDocx(self::$tmp . '/a.docx');
        FixtureBuilder::buildXlsx(self::$tmp . '/a.xlsx');
        FixtureBuilder::buildPptx(self::$tmp . '/a.pptx');
        FixtureBuilder::buildPdf(self::$tmp . '/a.pdf', 'Round trip PDF');
    }

    public static function tearDownAfterClass(): void
    {
        FixtureBuilder::cleanup(self::$tmp);
    }

    public function testForFileRoutesByExtension(): void
    {
        $this->assertInstanceOf(DocxExtractor::class, ExtractorFactory::forFile('foo.docx'));
        $this->assertInstanceOf(XlsxExtractor::class, ExtractorFactory::forFile('foo.xlsx'));
        $this->assertInstanceOf(PptxExtractor::class, ExtractorFactory::forFile('foo.pptx'));
        $this->assertInstanceOf(PdfExtractor::class, ExtractorFactory::forFile('foo.pdf'));
    }

    public function testForFileIsCaseInsensitive(): void
    {
        $this->assertInstanceOf(DocxExtractor::class, ExtractorFactory::forFile('foo.DOCX'));
        $this->assertInstanceOf(PdfExtractor::class, ExtractorFactory::forFile('FOO.PDF'));
    }

    public function testUnknownExtensionThrows(): void
    {
        $this->expectException(UnsupportedFormatException::class);
        ExtractorFactory::forFile('foo.txt');
    }

    public function testNoExtensionThrows(): void
    {
        $this->expectException(UnsupportedFormatException::class);
        ExtractorFactory::forFile('/tmp/somefile');
    }

    public function testLegacyDocFormatIsUnsupported(): void
    {
        $this->expectException(UnsupportedFormatException::class);
        ExtractorFactory::forFile('legacy.doc');
    }

    public function testExtractConvenienceRoundtripsAllFourFormats(): void
    {
        $this->assertStringContainsString('Hello world from DOCX', ExtractorFactory::extract(self::$tmp . '/a.docx'));
        $this->assertStringContainsString('Hello', ExtractorFactory::extract(self::$tmp . '/a.xlsx'));
        $this->assertStringContainsString('First slide title', ExtractorFactory::extract(self::$tmp . '/a.pptx'));
        $this->assertStringContainsString('Round trip PDF', ExtractorFactory::extract(self::$tmp . '/a.pdf'));
    }

    public function testCorruptDocxRaisesExtractionException(): void
    {
        $bad = self::$tmp . '/bad.docx';
        file_put_contents($bad, 'this is not a zip');
        $this->expectException(ExtractionException::class);
        ExtractorFactory::extract($bad);
    }
}
