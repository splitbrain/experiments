/**
 * Recipe plugin web component.
 *
 * Enhances the ingredient list wrapped by <recipe-card> (emitted by
 * syntax.php). It parses each list item, detects the amount and its unit,
 * converts imperial/US units to metric and lets the reader rescale the whole
 * recipe to a different number of servings.
 *
 * The component works standalone (no framework, no shadow DOM so it inherits
 * the wiki template styles) and degrades gracefully: without JavaScript the
 * reader still sees the plain, server rendered ingredient list.
 *
 * @license GPL 2 http://www.gnu.org/licenses/gpl-2.0.html
 * @author  Andreas Gohr <gohr@cosmocode.de>
 */
(function () {
    'use strict';

    /* ------------------------------------------------------------------ *
     * Amount parsing helpers
     * ------------------------------------------------------------------ */

    // Unicode vulgar fractions and their numeric value.
    var UNICODE_FRACTIONS = {
        '¼': 0.25, '½': 0.5, '¾': 0.75,
        '⅓': 1 / 3, '⅔': 2 / 3,
        '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8,
        '⅙': 1 / 6, '⅚': 5 / 6,
        '⅐': 1 / 7, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
        '⅑': 1 / 9, '⅒': 0.1
    };
    var UNI = '¼½¾⅓⅔⅕⅖⅗⅘⅙⅚⅐⅛⅜⅝⅞⅑⅒';

    // Unit definitions. type: 'v' = volume (base millilitre), 'w' = weight (base gram).
    // A handful of German abbreviations (el, tl) are included since they are
    // common in the kind of recipes this plugin is written for.
    var UNIT_DEFS = [
        {type: 'v', factor: 236.588, names: ['cup', 'cups']},
        {type: 'v', factor: 14.7868, names: ['tablespoon', 'tablespoons', 'tbsp', 'tbs', 'tbl', 'tblsp', 'el']},
        {type: 'v', factor: 4.92892, names: ['teaspoon', 'teaspoons', 'tsp', 'tspn', 'tl']},
        {type: 'v', factor: 29.5735, names: ['floz', 'fluidounce', 'fluidounces']},
        {type: 'v', factor: 473.176, names: ['pint', 'pints', 'pt']},
        {type: 'v', factor: 946.353, names: ['quart', 'quarts', 'qt']},
        {type: 'v', factor: 3785.41, names: ['gallon', 'gallons', 'gal']},
        {type: 'v', factor: 1, names: ['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres']},
        {type: 'v', factor: 10, names: ['cl', 'centiliter', 'centiliters', 'centilitre', 'centilitres']},
        {type: 'v', factor: 100, names: ['dl', 'deciliter', 'deciliters', 'decilitre', 'decilitres']},
        {type: 'v', factor: 1000, names: ['l', 'liter', 'liters', 'litre', 'litres']},
        {type: 'w', factor: 28.3495, names: ['oz', 'ounce', 'ounces']},
        {type: 'w', factor: 453.592, names: ['lb', 'lbs', 'pound', 'pounds']},
        {type: 'w', factor: 1, names: ['g', 'gr', 'gram', 'grams', 'gramme', 'grammes']},
        {type: 'w', factor: 1000, names: ['kg', 'kilo', 'kilos', 'kilogram', 'kilograms', 'kilogramme', 'kilogrammes']},
        {type: 'w', factor: 0.001, names: ['mg', 'milligram', 'milligrams']}
    ];

    var UNIT_MAP = {};
    UNIT_DEFS.forEach(function (def) {
        def.names.forEach(function (n) { UNIT_MAP[n] = def; });
    });

    // A single amount: mixed number, fraction, decimal, integer or a unicode fraction.
    var AMOUNT =
        '(?:' +
            '\\d+\\s+\\d+\\s*\\/\\s*\\d+' +   // 1 1/2
            '|\\d+\\s*[' + UNI + ']' +         // 1½
            '|\\d+\\s*\\/\\s*\\d+' +           // 1/2
            '|\\d+(?:[.,]\\d+)?' +             // 2  or  2.5  or  2,5
            '|[' + UNI + ']' +                 // ½
        ')';
    // Leading amount, optionally a range (2-3, 2 to 3), plus trailing whitespace.
    var LEADING = new RegExp(
        '^\\s*(' + AMOUNT + ')\\s*(?:(?:-|–|—|to)\\s*(' + AMOUNT + '))?\\s*'
    );
    var WORD = /^[A-Za-zÀ-ſ.]+/;

    /**
     * Turn a single amount token into a number.
     * @param {string} str
     * @return {number}
     */
    function evalAmount(str) {
        str = str.trim();
        var m;
        if ((m = str.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/))) {          // 1 1/2
            return parseInt(m[1], 10) + parseInt(m[2], 10) / parseInt(m[3], 10);
        }
        if ((m = str.match(new RegExp('^(\\d+)\\s*([' + UNI + '])$')))) { // 1½
            return parseInt(m[1], 10) + UNICODE_FRACTIONS[m[2]];
        }
        if ((m = str.match(/^(\d+)\s*\/\s*(\d+)$/))) {                  // 1/2
            return parseInt(m[1], 10) / parseInt(m[2], 10);
        }
        if (UNICODE_FRACTIONS[str] !== undefined) {                    // ½
            return UNICODE_FRACTIONS[str];
        }
        return parseFloat(str.replace(',', '.'));                      // 2.5 / 2,5
    }

    function normUnit(s) {
        return s.toLowerCase().replace(/\./g, '');
    }

    /**
     * Detect a known unit at the beginning of the given string.
     * Tries a two word unit ("fluid ounce", "fl oz") before a single word one.
     * @param {string} str
     * @return {?{def: object, consumed: number}}
     */
    function matchUnit(str) {
        var m2 = str.match(/^([A-Za-zÀ-ſ.]+)\s+([A-Za-zÀ-ſ.]+)/);
        if (m2) {
            var def2 = UNIT_MAP[normUnit(m2[1] + m2[2])];
            if (def2) {
                var c2 = m2[0].length;
                c2 += str.slice(c2).match(/^\s*/)[0].length;
                return {def: def2, consumed: c2};
            }
        }
        var m1 = str.match(WORD);
        if (m1) {
            var def1 = UNIT_MAP[normUnit(m1[0])];
            if (def1) {
                var c1 = m1[0].length;
                c1 += str.slice(c1).match(/^\s*/)[0].length;
                return {def: def1, consumed: c1};
            }
        }
        return null;
    }

    /**
     * Parse an ingredient line into its scalable amount and unit.
     * @param {string} text
     * @return {?{min:number, max:?number, type:?string, factor:?number, prefixLen:number, original:string}}
     */
    function parseLine(text) {
        var lead = LEADING.exec(text);
        if (!lead || !lead[1]) return null;

        var min = evalAmount(lead[1]);
        if (isNaN(min)) return null;
        var max = lead[2] ? evalAmount(lead[2]) : null;
        if (max !== null && isNaN(max)) max = null;

        var rest = text.slice(lead[0].length);
        var unit = matchUnit(rest);
        var prefixLen = lead[0].length + (unit ? unit.consumed : 0);

        return {
            min: min,
            max: max,
            type: unit ? unit.def.type : null,
            factor: unit ? unit.def.factor : null,
            prefixLen: prefixLen,
            original: text.slice(0, prefixLen).trim()
        };
    }

    /* ------------------------------------------------------------------ *
     * Number formatting
     * ------------------------------------------------------------------ */

    // Decimal separator used when writing amounts back out. Set per card in setup().
    var DECIMAL = '.';

    /** Format a number with up to two decimals, no trailing zeros. */
    function fmtNum(v) {
        return String(Math.round(v * 100) / 100).replace('.', DECIMAL);
    }

    /** Round a base amount (g / ml) coarsely: cooking never needs sub-gram precision. */
    function roundBase(v) {
        return v >= 10 ? Math.round(v) : Math.round(v * 2) / 2;
    }

    var COUNT_FRACTIONS = [
        [0.125, '⅛'], [0.25, '¼'], [1 / 3, '⅓'], [0.5, '½'],
        [2 / 3, '⅔'], [0.75, '¾'], [0.875, '⅞']
    ];

    /** Format a plain count, preferring nice fractions (1½ instead of 1.5). */
    function fmtCount(v) {
        if (v < 0) return fmtNum(v);
        var whole = Math.floor(v + 1e-6);
        var frac = v - whole;
        for (var i = 0; i < COUNT_FRACTIONS.length; i++) {
            if (Math.abs(frac - COUNT_FRACTIONS[i][0]) < 0.03) {
                return (whole > 0 ? whole : '') + COUNT_FRACTIONS[i][1];
            }
        }
        if (frac < 0.03) return String(whole);
        return fmtNum(v);
    }

    /** Build the metric string for a (possibly ranged) converted amount. */
    function metricStr(lo, hi, type, unitFactor) {
        var baseLo = lo * unitFactor;
        var baseHi = hi !== null ? hi * unitFactor : null;
        var ref = baseHi !== null ? baseHi : baseLo;
        var big = ref >= 1000;

        function one(v) {
            if (type === 'w') return big ? fmtNum(v / 1000) + ' kg' : fmtNum(roundBase(v)) + ' g';
            return big ? fmtNum(v / 1000) + ' l' : fmtNum(roundBase(v)) + ' ml';
        }

        return baseHi !== null ? one(baseLo) + '–' + one(baseHi) : one(baseLo);
    }

    /** Full display string (amount + unit) for an item at the given scale factor. */
    function displayAmount(item, factor) {
        var lo = item.min * factor;
        var hi = item.max !== null ? item.max * factor : null;
        if (item.type) {
            return metricStr(lo, hi, item.type, item.factor);
        }
        return hi !== null ? fmtCount(lo) + '–' + fmtCount(hi) : fmtCount(lo);
    }

    /* ------------------------------------------------------------------ *
     * DOM helpers
     * ------------------------------------------------------------------ */

    /** Remove the first `n` characters of text from an element, across text nodes. */
    function stripLeadingChars(el, n) {
        var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
        var node;
        while (n > 0 && (node = walker.nextNode())) {
            var len = node.nodeValue.length;
            if (len <= n) {
                n -= len;
                node.nodeValue = '';
            } else {
                node.nodeValue = node.nodeValue.slice(n);
                n = 0;
            }
        }
    }

    function sprintf1(tpl, value) {
        return String(tpl).replace(/%[ds]/, value);
    }

    /* ------------------------------------------------------------------ *
     * The custom element
     * ------------------------------------------------------------------ */

    class RecipeCard extends HTMLElement {
        connectedCallback() {
            if (this._initialised) return;
            this._initialised = true;
            try {
                this.setup();
            } catch (e) {
                // Never break the page: leave the plain list in place.
                if (window.console) console.error('recipe plugin:', e);
            }
        }

        setup() {
            var orig = parseFloat((this.getAttribute('data-yield') || '1').replace(',', '.'));
            if (!(orig > 0)) orig = 1;
            this._orig = orig;
            this._current = orig;
            this._showOriginal = this.getAttribute('data-show-original') !== '0';
            DECIMAL = this.getAttribute('data-decimal') || '.';
            this._labels = {
                servings: this.getAttribute('data-label-servings') || 'Servings',
                reset: this.getAttribute('data-label-reset') || 'Reset',
                note: this.getAttribute('data-label-note') || 'Original recipe makes %d servings',
                original: this.getAttribute('data-label-original') || 'Original amount: %s'
            };

            this.collectItems();
            if (!this._items.length) return; // nothing looked like an ingredient

            this.buildControls();
            this.setYield(this._current); // initialises amounts and control state
        }

        /** Find the ingredient list items and pre-parse each one. */
        collectItems() {
            this._items = [];
            var self = this;
            var lis = this.querySelectorAll('li');
            lis.forEach(function (li) {
                var target = li.querySelector(':scope > .li') || li;
                if (target.querySelector && target !== li && target.querySelector('ul, ol')) return;
                var text = target.textContent;
                var parsed = parseLine(text);
                if (!parsed) return;

                stripLeadingChars(target, parsed.prefixLen);
                var space = document.createTextNode(' ');
                var span = document.createElement('span');
                span.className = 'recipe-amount';
                target.insertBefore(space, target.firstChild);
                target.insertBefore(span, space);

                parsed.span = span;
                self._items.push(parsed);
            });
        }

        /** Build the servings control bar and prepend it to the card. */
        buildControls() {
            var self = this;

            var bar = document.createElement('div');
            bar.className = 'recipe-controls';

            var label = document.createElement('label');
            label.className = 'recipe-servings-label';
            label.textContent = this._labels.servings;

            var dec = document.createElement('button');
            dec.type = 'button';
            dec.className = 'recipe-step recipe-dec';
            dec.textContent = '−';
            dec.setAttribute('aria-label', '-1');

            var input = document.createElement('input');
            input.type = 'number';
            input.className = 'recipe-yield';
            input.min = '0.1';
            input.step = '1';
            input.value = this.fmtServings(this._current);
            input.setAttribute('aria-label', this._labels.servings);
            label.appendChild(input);

            var inc = document.createElement('button');
            inc.type = 'button';
            inc.className = 'recipe-step recipe-inc';
            inc.textContent = '+';
            inc.setAttribute('aria-label', '+1');

            var reset = document.createElement('button');
            reset.type = 'button';
            reset.className = 'recipe-reset';
            reset.textContent = this._labels.reset;

            var note = document.createElement('span');
            note.className = 'recipe-note';
            note.textContent = sprintf1(this._labels.note, this.fmtServings(this._orig));

            dec.addEventListener('click', function () { self.setYield(self._current - 1); });
            inc.addEventListener('click', function () { self.setYield(self._current + 1); });
            reset.addEventListener('click', function () { self.setYield(self._orig); });
            input.addEventListener('change', function () { self.setYield(parseFloat(input.value.replace(',', '.'))); });
            input.addEventListener('input', function () { self.setYield(parseFloat(input.value.replace(',', '.')), true); });

            bar.appendChild(label);
            bar.appendChild(dec);
            bar.appendChild(inc);
            bar.appendChild(reset);
            bar.appendChild(note);

            this._input = input;
            this._reset = reset;

            var title = this.querySelector(':scope > .recipe-title');
            if (title) {
                title.insertAdjacentElement('afterend', bar);
            } else {
                this.insertBefore(bar, this.firstChild);
            }
        }

        fmtServings(v) {
            return (v === Math.round(v)) ? String(v) : String(Math.round(v * 100) / 100);
        }

        /**
         * Change the target number of servings.
         * @param {number} value
         * @param {boolean} [fromInput] true while the user types (don't rewrite the field)
         */
        setYield(value, fromInput) {
            if (isNaN(value) || value <= 0) {
                if (!fromInput) return;
                return; // ignore incomplete/invalid input
            }
            value = Math.round(value * 100) / 100;
            this._current = value;
            if (!fromInput && this._input) this._input.value = this.fmtServings(value);
            if (this._reset) this._reset.disabled = (value === this._orig);
            this.update();
        }

        /** Recompute and write all ingredient amounts. */
        update() {
            var factor = this._current / this._orig;
            for (var i = 0; i < this._items.length; i++) {
                var item = this._items[i];
                item.span.textContent = displayAmount(item, factor);
                if (this._showOriginal && item.original) {
                    item.span.title = sprintf1(this._labels.original, item.original);
                }
            }
            this.classList.toggle('recipe-scaled', Math.abs(factor - 1) > 1e-6);
        }
    }

    if (window.customElements && !customElements.get('recipe-card')) {
        customElements.define('recipe-card', RecipeCard);
    }

    // Test seam: only active when a test harness sets the flag, no-op in the wiki.
    if (typeof globalThis !== 'undefined' && globalThis.__RECIPE_TEST__) {
        globalThis.__RECIPE_TEST__ = {
            parseLine: parseLine,
            evalAmount: evalAmount,
            displayAmount: displayAmount,
            fmtNum: fmtNum,
            fmtCount: fmtCount
        };
    }
})();
