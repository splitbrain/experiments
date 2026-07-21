<?php

/**
 * DokuWiki Plugin recipe (Syntax Component)
 *
 * Wraps a standard DokuWiki list of ingredients into a <recipe-card> custom
 * element. All the interesting behaviour (unit detection, metric conversion
 * and serving rescaling) lives in the accompanying web component (script.js);
 * this class is only responsible for emitting the wrapper markup around the
 * list that DokuWiki renders for us.
 *
 * @license GPL 2 http://www.gnu.org/licenses/gpl-2.0.html
 * @author  Andreas Gohr <gohr@cosmocode.de>
 */

use dokuwiki\Extension\SyntaxPlugin;

class syntax_plugin_recipe extends SyntaxPlugin
{
    /** @inheritDoc */
    public function getType()
    {
        return 'container';
    }

    /** @inheritDoc */
    public function getPType()
    {
        return 'block';
    }

    /**
     * The list markup that lives inside the wrapper is parsed by the regular
     * DokuWiki modes, so we have to allow them to run within our container.
     *
     * @inheritDoc
     */
    public function getAllowedTypes()
    {
        return ['container', 'formatting', 'substition', 'protected', 'disabled', 'paragraphs'];
    }

    /** @inheritDoc */
    public function getSort()
    {
        return 195;
    }

    /** @inheritDoc */
    public function connectTo($mode)
    {
        // only open the mode when a matching close tag exists (dotall lexer)
        $this->Lexer->addEntryPattern('<recipe\b.*?>(?=.*?</recipe>)', $mode, 'plugin_recipe');
    }

    /** @inheritDoc */
    public function postConnect()
    {
        $this->Lexer->addExitPattern('</recipe>', 'plugin_recipe');
    }

    /** @inheritDoc */
    public function handle($match, $state, $pos, Doku_Handler $handler)
    {
        switch ($state) {
            case DOKU_LEXER_ENTER:
                return [$state, $this->parseTag($match)];
            case DOKU_LEXER_UNMATCHED:
                return [$state, $match];
            case DOKU_LEXER_EXIT:
                return [$state, ''];
        }
        return [$state, ''];
    }

    /** @inheritDoc */
    public function render($format, Doku_Renderer $renderer, $data)
    {
        if ($format !== 'xhtml') {
            return false;
        }

        [$state, $payload] = $data;

        switch ($state) {
            case DOKU_LEXER_ENTER:
                $renderer->nocache();
                $renderer->doc .= $this->openTag($payload);
                break;

            case DOKU_LEXER_UNMATCHED:
                // whitespace / stray text between the tag and the list
                $renderer->doc .= $renderer->_xmlEntities($payload);
                break;

            case DOKU_LEXER_EXIT:
                $renderer->doc .= '</recipe-card>';
                break;
        }

        return true;
    }

    /**
     * Parse the attributes of the opening <recipe ...> tag.
     *
     * Supported syntax:
     *   <recipe>              default number of servings
     *   <recipe 4>            4 servings
     *   <recipe 4 title="Pancakes">
     *   <recipe title="Cake" 12>
     *
     * @param string $match the full opening tag
     * @return array{yield: float, title: string}
     */
    protected function parseTag($match)
    {
        // strip "<recipe" and the trailing ">"
        $str = trim(substr($match, 7, -1));

        $title = '';
        if (preg_match('/\btitle\s*=\s*(["\'])(.*?)\1/i', $str, $m)) {
            $title = $m[2];
            $str = str_replace($m[0], '', $str);
        }

        $yield = (float) $this->getConf('defaultservings');
        if (preg_match('/(\d+(?:[.,]\d+)?)/', $str, $m)) {
            $yield = (float) str_replace(',', '.', $m[1]);
        }
        if ($yield <= 0) {
            $yield = 1;
        }

        return ['yield' => $yield, 'title' => $title];
    }

    /**
     * Build the opening markup for the web component.
     *
     * Localised labels are handed to the component through data attributes so
     * that the JavaScript stays free of any translation logic.
     *
     * @param array{yield: float, title: string} $data
     * @return string
     */
    protected function openTag($data)
    {
        // render whole numbers without a trailing ".0"
        $yield = $data['yield'];
        $yield = ($yield == (int) $yield) ? (string) (int) $yield : rtrim(rtrim(sprintf('%.2f', $yield), '0'), '.');

        $html = '<recipe-card';
        $html .= ' data-yield="' . hsc($yield) . '"';
        $html .= ' data-show-original="' . ($this->getConf('showoriginal') ? '1' : '0') . '"';
        $html .= ' data-decimal="' . hsc($this->getLang('decimal')) . '"';
        $html .= ' data-label-servings="' . hsc($this->getLang('servings')) . '"';
        $html .= ' data-label-reset="' . hsc($this->getLang('reset')) . '"';
        $html .= ' data-label-note="' . hsc($this->getLang('note')) . '"';
        $html .= ' data-label-original="' . hsc($this->getLang('original')) . '"';
        $html .= '>';

        if ($data['title'] !== '') {
            $html .= '<div class="recipe-title">' . hsc($data['title']) . '</div>';
        }

        return $html;
    }
}
