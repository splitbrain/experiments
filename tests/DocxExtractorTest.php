<?php

declare(strict_types=1);

namespace Splitbrain\DocExtract\Tests;

use PHPUnit\Framework\TestCase;
use Splitbrain\DocExtract\Extractor\DocxExtractor;

final class DocxExtractorTest extends TestCase
{
    private static string $tmp = '';
    private static string $fixture = '';

    public static function setUpBeforeClass(): void
    {
        self::$tmp = FixtureBuilder::tempDir();
        self::$fixture = self::$tmp . '/sample.docx';
        FixtureBuilder::buildDocx(self::$fixture);
    }

    public static function tearDownAfterClass(): void
    {
        FixtureBuilder::cleanup(self::$tmp);
    }

    public function testExtractsParagraphText(): void
    {
        $text = (new DocxExtractor())->extract(self::$fixture);
        $this->assertStringContainsString('Hello world from DOCX', $text);
        $this->assertStringContainsString('Tab', $text);
        $this->assertStringContainsString('separated', $text);
        $this->assertStringContainsString('line two', $text);
    }

    public function testTabAndBreakProduceWhitespace(): void
    {
        $text = (new DocxExtractor())->extract(self::$fixture);
        $this->assertStringContainsString("Tab\tseparated", $text);
        $this->assertStringContainsString("Line one\nline two", $text);
    }

    public function testParagraphBoundariesProduceNewlines(): void
    {
        $text = (new DocxExtractor())->extract(self::$fixture);
        $lines = explode("\n", $text);
        $this->assertGreaterThanOrEqual(3, count($lines));
        $this->assertSame('Hello world from DOCX', $lines[0]);
    }

    public function testSupports(): void
    {
        $e = new DocxExtractor();
        $this->assertTrue($e->supports('foo.docx'));
        $this->assertTrue($e->supports('foo.DOCX'));
        $this->assertFalse($e->supports('foo.pdf'));
    }
}
