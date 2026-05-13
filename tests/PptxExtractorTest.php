<?php

declare(strict_types=1);

namespace Splitbrain\DocExtract\Tests;

use PHPUnit\Framework\TestCase;
use Splitbrain\DocExtract\Extractor\PptxExtractor;

final class PptxExtractorTest extends TestCase
{
    private static string $tmp = '';
    private static string $fixture = '';

    public static function setUpBeforeClass(): void
    {
        self::$tmp = FixtureBuilder::tempDir();
        self::$fixture = self::$tmp . '/sample.pptx';
        FixtureBuilder::buildPptx(self::$fixture);
    }

    public static function tearDownAfterClass(): void
    {
        FixtureBuilder::cleanup(self::$tmp);
    }

    public function testExtractsBothSlides(): void
    {
        $text = (new PptxExtractor())->extract(self::$fixture);
        $this->assertStringContainsString('First slide title', $text);
        $this->assertStringContainsString('Second slide', $text);
    }

    public function testHonoursSldIdLstOrder(): void
    {
        // Fixture's sldIdLst points rId2 (slide1.xml = "First slide title") FIRST,
        // then rId1 (slide2.xml = "Second slide"). Display order must reflect that.
        $text = (new PptxExtractor())->extract(self::$fixture);
        $posFirst = strpos($text, 'First slide title');
        $posSecond = strpos($text, 'Second slide');
        $this->assertNotFalse($posFirst);
        $this->assertNotFalse($posSecond);
        $this->assertLessThan($posSecond, $posFirst);
    }

    public function testSlideHeaders(): void
    {
        $text = (new PptxExtractor())->extract(self::$fixture);
        $this->assertStringContainsString('=== Slide 1 ===', $text);
        $this->assertStringContainsString('=== Slide 2 ===', $text);
    }

    public function testSupports(): void
    {
        $e = new PptxExtractor();
        $this->assertTrue($e->supports('foo.pptx'));
        $this->assertFalse($e->supports('foo.xlsx'));
    }
}
