<?php

declare(strict_types=1);

namespace Splitbrain\DocExtract\Tests;

use PHPUnit\Framework\TestCase;
use Splitbrain\DocExtract\Extractor\XlsxExtractor;

final class XlsxExtractorTest extends TestCase
{
    private static string $tmp = '';
    private static string $fixture = '';

    public static function setUpBeforeClass(): void
    {
        self::$tmp = FixtureBuilder::tempDir();
        self::$fixture = self::$tmp . '/sample.xlsx';
        FixtureBuilder::buildXlsx(self::$fixture);
    }

    public static function tearDownAfterClass(): void
    {
        FixtureBuilder::cleanup(self::$tmp);
    }

    public function testIncludesSheetHeader(): void
    {
        $text = (new XlsxExtractor())->extract(self::$fixture);
        $this->assertStringContainsString('=== Sheet: Data ===', $text);
    }

    public function testResolvesSharedStrings(): void
    {
        $text = (new XlsxExtractor())->extract(self::$fixture);
        $this->assertStringContainsString("Hello\tWorld", $text);
    }

    public function testIncludesRawAndInlineValues(): void
    {
        $text = (new XlsxExtractor())->extract(self::$fixture);
        $this->assertStringContainsString("42\tinline", $text);
    }

    public function testSupports(): void
    {
        $e = new XlsxExtractor();
        $this->assertTrue($e->supports('foo.xlsx'));
        $this->assertFalse($e->supports('foo.docx'));
    }
}
