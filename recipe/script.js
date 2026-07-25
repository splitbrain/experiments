/**
 * Recipe plugin - page-level ingredient scaler.
 *
 * A page marks its ingredient list with the <recipe N> ... </recipe> wrapper
 * (rendered by syntax.php as div.plugin-recipe with a data-yield). This script:
 *
 *   1. parses the marked ingredient list (authoritative) - every leading amount
 *      is converted to metric and rescaled, and each ingredient NAME is learned
 *      into a per-page dictionary;
 *   2. scans the rest of the page and rescales anything that is either
 *        a) a number followed by a real cooking unit  ("half a cup of butter"), or
 *        b) a number followed by a word from the ingredient dictionary ("one egg");
 *   3. leaves everything else alone - "bake 20 minutes", "350 F", "9 inch pan" -
 *      because those are neither units nor known ingredients.
 *
 * This is plain DOM manipulation (no web component) and degrades gracefully:
 * with JavaScript off the reader still sees the original, server-rendered page.
 *
 * @license GPL 2 http://www.gnu.org/licenses/gpl-2.0.html
 * @author  Andreas Gohr <gohr@cosmocode.de>
 */
(function () {
    'use strict';

    /* ================================================================== *
     * Amounts: fractions, words and unit definitions
     * ================================================================== */

    var UNICODE_FRACTIONS = {
        '\u00BC': 0.25, '\u00BD': 0.5, '\u00BE': 0.75,
        '\u2153': 1 / 3, '\u2154': 2 / 3,
        '\u2155': 0.2, '\u2156': 0.4, '\u2157': 0.6, '\u2158': 0.8,
        '\u2159': 1 / 6, '\u215A': 5 / 6,
        '\u2150': 1 / 7, '\u215B': 0.125, '\u215C': 0.375, '\u215D': 0.625, '\u215E': 0.875,
        '\u2151': 1 / 9, '\u2152': 0.1
    };
    var UNI = '\u00BC\u00BD\u00BE\u2153\u2154\u2155\u2156\u2157\u2158\u2159\u215A\u2150\u215B\u215C\u215D\u215E\u2151\u2152';

    // Spelled-out amounts commonly found in prose ("stir in half a cup ...").
    var WORD_NUMBERS = {
        'a': 1, 'an': 1, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
        'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10, 'eleven': 11,
        'twelve': 12, 'half': 0.5, 'quarter': 0.25, 'third': 1 / 3
    };
    // Fraction words that may carry a leading article we should swallow
    // ("a third of a cup" -> the whole thing, not "a" + "79 ml").
    var FRACTION_WORDS = {'half': 1, 'quarter': 1, 'third': 1};

    // Cooking units. type: 'v' volume (ml base), 'w' weight (g base).
    var UNIT_DEFS = [
        {type: 'v', factor: 236.588, names: ['cup', 'cups']},
        {type: 'v', factor: 14.7868, names: ['tablespoon', 'tablespoons', 'tbsp', 'tbs', 'tbl', 'tblsp', 'el']},
        {type: 'v', factor: 4.92892, names: ['teaspoon', 'teaspoons', 'tsp', 'tspn', 'tl']},
        {type: 'v', factor: 29.5735, names: ['floz']},
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

    // Words that are never the head noun of an ingredient - kept out of the
    // learned dictionary so they can't accidentally trigger count scaling.
    var STOP_WORDS = {};
    ('of or and the a an to in on for with plus about approx approximately room ' +
     'temperature taste optional finely freshly roughly thinly coarsely well ' +
     'chopped minced diced sliced grated shredded crushed ground melted softened ' +
     'beaten peeled seeded cored cubed drained rinsed cooked uncooked raw fresh ' +
     'dried frozen canned large medium small ripe warm cold hot extra virgin ' +
     'boneless skinless unsalted salted whole halved quartered pinch dash bunch ' +
     'handful piece pieces can cans jar jars package packet packets more into your'
    ).split(' ').forEach(function (w) { STOP_WORDS[w] = 1; });

    /* ---- amount regex fragments ---- */

    var AMOUNT =
        '(?:' +
            '\\d+\\s+\\d+\\s*\\/\\s*\\d+' +   // 1 1/2
            '|\\d+\\s*[' + UNI + ']' +         // 1\u00BD
            '|\\d+\\s*\\/\\s*\\d+' +           // 1/2
            '|\\d+(?:[.,]\\d+)?' +             // 2, 2.5, 2,5
            '|[' + UNI + ']' +                 // \u00BD
        ')';
    var WORDNUM_ALT = Object.keys(WORD_NUMBERS)
        .sort(function (a, b) { return b.length - a.length; })
        .join('|');
    var AMT = '(?:' + AMOUNT + '|' + WORDNUM_ALT + ')';
    var SEP = '\\s*(?:-|\u2013|\u2014|to)\\s*';

    // Unit surface forms for the regex: multiword ones first, then single words
    // longest-first so "tablespoon" wins over "tbl", "ounces" over "oz", etc.
    var SINGLE = [];
    UNIT_DEFS.forEach(function (d) { d.names.forEach(function (n) { if (SINGLE.indexOf(n) < 0) SINGLE.push(n); }); });
    SINGLE.sort(function (a, b) { return b.length - a.length; });
    var UNITSURF = '(?:fl\\s*oz|fluid\\s+ounces?|' + SINGLE.join('|') + ')';

    // A candidate amount anywhere in a run of text.
    var CAND = new RegExp(AMT, 'gi');
    // A unit (with optional "of a"/"a"/"an" filler) right after an amount.
    var UNIT_AFTER = new RegExp('^(\\s*(?:of\\s+)?(?:an?\\s+)?)(' + UNITSURF + ')(?![A-Za-z])', 'i');
    // A range tail: "- 3", "to 3".
    var RANGE_AFTER = new RegExp('^(' + SEP + ')(' + AMT + ')', 'i');
    // A noun right after an amount (for dictionary matching).
    var NOUN_AFTER = new RegExp('^\\s+(?:of\\s+)?(?:an?\\s+)?([A-Za-z\u00C0-\u017F]+)', 'i');
    // Leading amount of a marked ingredient line.
    var LEAD = new RegExp('^(\\s*)(' + AMT + ')(?:' + SEP + '(' + AMT + '))?', 'i');

    /* ================================================================== *
     * Amount evaluation
     * ================================================================== */

    function evalAmount(str) {
        str = str.trim();
        var m;
        if ((m = str.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/))) {
            return parseInt(m[1], 10) + parseInt(m[2], 10) / parseInt(m[3], 10);
        }
        if ((m = str.match(new RegExp('^(\\d+)\\s*([' + UNI + '])$')))) {
            return parseInt(m[1], 10) + UNICODE_FRACTIONS[m[2]];
        }
        if ((m = str.match(/^(\d+)\s*\/\s*(\d+)$/))) {
            return parseInt(m[1], 10) / parseInt(m[2], 10);
        }
        if (UNICODE_FRACTIONS[str] !== undefined) return UNICODE_FRACTIONS[str];
        return parseFloat(str.replace(',', '.'));
    }

    /** Evaluate an amount token that may be digits or a spelled-out word. */
    function amtVal(tok) {
        if (tok == null) return null;
        var w = WORD_NUMBERS[tok.toLowerCase()];
        if (w !== undefined) return w;
        return evalAmount(tok);
    }

    function normUnit(s) { return s.toLowerCase().replace(/[\s.]/g, ''); }

    /* ================================================================== *
     * Number formatting
     * ================================================================== */

    var DECIMAL = '.';

    function fmtNum(v) { return String(Math.round(v * 100) / 100).replace('.', DECIMAL); }

    function roundBase(v) { return v >= 10 ? Math.round(v) : Math.round(v * 2) / 2; }

    var COUNT_FRACTIONS = [
        [0.125, '\u215B'], [0.25, '\u00BC'], [1 / 3, '\u2153'], [0.5, '\u00BD'],
        [2 / 3, '\u2154'], [0.75, '\u00BE'], [0.875, '\u215E']
    ];

    function fmtCount(v) {
        if (v < 0) return fmtNum(v);
        var whole = Math.floor(v + 1e-6), frac = v - whole;
        for (var i = 0; i < COUNT_FRACTIONS.length; i++) {
            if (Math.abs(frac - COUNT_FRACTIONS[i][0]) < 0.03) {
                return (whole > 0 ? whole : '') + COUNT_FRACTIONS[i][1];
            }
        }
        if (frac < 0.03) return String(whole);
        return fmtNum(v);
    }

    function metricStr(lo, hi, type, unitFactor) {
        var baseLo = lo * unitFactor, baseHi = hi !== null ? hi * unitFactor : null;
        var ref = baseHi !== null ? baseHi : baseLo, big = ref >= 1000;
        function one(v) {
            if (type === 'w') return big ? fmtNum(v / 1000) + ' kg' : fmtNum(roundBase(v)) + ' g';
            return big ? fmtNum(v / 1000) + ' l' : fmtNum(roundBase(v)) + ' ml';
        }
        return baseHi !== null ? one(baseLo) + '\u2013' + one(baseHi) : one(baseLo);
    }

    /** Text for one amount record at the given scale factor. */
    function displayAmount(item, factor) {
        var lo = item.min * factor, hi = item.max !== null ? item.max * factor : null;
        if (item.type) return metricStr(lo, hi, item.type, item.factor);
        return hi !== null ? fmtCount(lo) + '\u2013' + fmtCount(hi) : fmtCount(lo);
    }

    /* ================================================================== *
     * Ingredient dictionary (learned from the marked list)
     * ================================================================== */

    function singular(w) {
        if (/ies$/.test(w)) return w.slice(0, -3) + 'y';
        if (/(ches|shes|xes|zes|ses|oes)$/.test(w)) return w.slice(0, -2);
        if (/ss$/.test(w)) return w;
        if (/s$/.test(w)) return w.slice(0, -1);
        return w;
    }

    function learnName(name, dict) {
        name.split(/[^A-Za-z\u00C0-\u017F]+/).forEach(function (raw) {
            var w = raw.toLowerCase();
            if (w.length < 3 || STOP_WORDS[w]) return;
            dict[w] = 1;
            dict[singular(w)] = 1;
        });
    }

    function knownNoun(w, dict) {
        w = w.toLowerCase();
        return !!(dict[w] || dict[singular(w)]);
    }

    /* ================================================================== *
     * Text scanning
     * ================================================================== */

    /**
     * Find scalable amounts in a run of text.
     * @param {string} text
     * @param {object} dict learned ingredient dictionary
     * @return {Array} matches {start, end, min, max, type, factor, original}
     */
    function scanText(text, dict) {
        var out = [];
        CAND.lastIndex = 0;
        var m;
        while ((m = CAND.exec(text))) {
            var idx = m.index;
            // left boundary: must not sit inside a longer word/number
            if (idx > 0 && /[A-Za-z\u00C0-\u017F0-9]/.test(text.charAt(idx - 1))) continue;

            var tok = m[0];
            var v1 = amtVal(tok);
            if (v1 == null || isNaN(v1)) continue;

            var pos = idx + tok.length;
            var v2 = null;
            var rm = RANGE_AFTER.exec(text.slice(pos));
            if (rm) { v2 = amtVal(rm[2]); if (isNaN(v2)) v2 = null; pos += rm[1].length + rm[2].length; }

            var rest = text.slice(pos);
            var numeric = /[\d\u00BD\u00BC\u00BE\u2153\u2154\u2155\u2156\u2157\u2158\u2159\u215A\u2150\u215B\u215C\u215D\u215E\u2151\u2152]/.test(tok);

            // (1) a real unit right after -> convert + scale
            var um = UNIT_AFTER.exec(rest);
            if (um && (numeric || /\s/.test(um[1]))) {
                var def = UNIT_MAP[normUnit(um[2])];
                if (def) {
                    var end = pos + um[0].length;
                    var start = swallowArticle(text, idx, tok);
                    out.push({start: start, end: end, min: v1, max: v2,
                        type: def.type, factor: def.factor, original: text.slice(start, end)});
                    CAND.lastIndex = end;
                    continue;
                }
            }

            // (2) a known ingredient noun right after -> scale the count only
            var nm = NOUN_AFTER.exec(rest);
            if (nm && knownNoun(nm[1], dict)) {
                var start2 = swallowArticle(text, idx, tok);
                out.push({start: start2, end: pos, min: v1, max: v2,
                    type: null, factor: null, original: text.slice(start2, pos)});
                CAND.lastIndex = pos;
                continue;
            }
        }
        return out;
    }

    /** Extend a match start backwards over a leading article ("a third" -> whole). */
    function swallowArticle(text, idx, tok) {
        if (!FRACTION_WORDS[tok.toLowerCase()]) return idx;
        var before = text.slice(0, idx);
        var bm = before.match(/(?:^|\s)(an?)\s+$/i);
        if (!bm) return idx;
        var lead = /^\s/.test(bm[0]) ? 1 : 0;
        return idx - (bm[0].length - lead);
    }

    /* ================================================================== *
     * DOM handling
     * ================================================================== */

    var STATE = {orig: 1, current: 1, amounts: [], showOriginal: true, labels: {}};

    function sprintf1(tpl, value) { return String(tpl).replace(/%[ds]/, value); }

    /** Create the amount span for a match and register it for rescaling. */
    function makeSpan(item) {
        var span = document.createElement('span');
        span.className = 'recipe-amount';
        var rec = {span: span, min: item.min, max: item.max,
            type: item.type, factor: item.factor, original: item.original};
        STATE.amounts.push(rec);
        return span;
    }

    /** Replace the matched slices of a text node with amount spans. */
    function rewriteTextNode(node, matches) {
        var text = node.nodeValue;
        var frag = document.createDocumentFragment();
        var pos = 0;
        matches.forEach(function (mt) {
            if (mt.start > pos) frag.appendChild(document.createTextNode(text.slice(pos, mt.start)));
            frag.appendChild(makeSpan(mt));
            pos = mt.end;
        });
        if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
        node.parentNode.replaceChild(frag, node);
    }

    var SKIP_TAGS = {SCRIPT: 1, STYLE: 1, CODE: 1, PRE: 1, TEXTAREA: 1, NOSCRIPT: 1, KBD: 1};

    /** Walk visible text nodes under root, skipping code, the control and done spans. */
    function eachTextNode(root, fn) {
        var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode: function (node) {
                if (!node.nodeValue || !/\S/.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
                var p = node.parentNode;
                while (p && p !== root.parentNode) {
                    if (SKIP_TAGS[p.nodeName]) return NodeFilter.FILTER_REJECT;
                    if (p.classList && (p.classList.contains('recipe-amount') ||
                        p.classList.contains('recipe-controls'))) return NodeFilter.FILTER_REJECT;
                    p = p.parentNode;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        }, false);
        var nodes = [], n;
        while ((n = walker.nextNode())) nodes.push(n);
        nodes.forEach(fn);
    }

    /**
     * Parse the marked ingredient list: wrap the leading amount of each item
     * (bare counts allowed here, this list is authoritative) and learn the
     * ingredient names into the dictionary.
     */
    function parseIngredientList(wrapper, dict) {
        var items = wrapper.querySelectorAll('li');
        items.forEach(function (li) {
            var box = li.querySelector(':scope > .li') || li;
            var text = box.textContent;

            var lead = LEAD.exec(text);
            if (!lead || !lead[2]) { learnName(text, dict); return; }

            var min = amtVal(lead[2]);
            if (min == null || isNaN(min)) { learnName(text, dict); return; }
            var max = lead[3] ? amtVal(lead[3]) : null;
            if (max !== null && isNaN(max)) max = null;

            var rest = text.slice(lead[0].length);
            var um = UNIT_AFTER.exec(rest);
            var type = null, factor = null, prefixLen = lead[0].length;
            if (um) {
                var def = UNIT_MAP[normUnit(um[2])];
                if (def) { type = def.type; factor = def.factor; prefixLen += um[0].length; }
            }
            // trailing space after the amount/unit belongs to the prefix
            prefixLen += (text.slice(prefixLen).match(/^\s*/)[0]).length;

            learnName(text.slice(prefixLen), dict);

            stripLeadingChars(box, prefixLen);
            var span = makeSpan({min: min, max: max, type: type, factor: factor,
                original: text.slice(0, prefixLen).trim()});
            box.insertBefore(document.createTextNode(' '), box.firstChild);
            box.insertBefore(span, box.firstChild);
        });
    }

    function stripLeadingChars(el, n) {
        var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
        var node;
        while (n > 0 && (node = walker.nextNode())) {
            var len = node.nodeValue.length;
            if (len <= n) { n -= len; node.nodeValue = ''; }
            else { node.nodeValue = node.nodeValue.slice(n); n = 0; }
        }
    }

    /* ---- servings control ---- */

    function fmtServings(v) { return (v === Math.round(v)) ? String(v) : String(Math.round(v * 100) / 100); }

    function buildControls(wrapper) {
        var bar = document.createElement('div');
        bar.className = 'recipe-controls';

        var label = document.createElement('label');
        label.className = 'recipe-servings-label';
        label.textContent = STATE.labels.servings;

        var input = document.createElement('input');
        input.type = 'number';
        input.className = 'recipe-yield';
        input.min = '0.1';
        input.step = '1';
        input.value = fmtServings(STATE.current);
        input.setAttribute('aria-label', STATE.labels.servings);
        label.appendChild(input);

        var dec = stepButton('\u2212', '-1');
        var inc = stepButton('+', '+1');
        var reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'recipe-reset';
        reset.textContent = STATE.labels.reset;

        var note = document.createElement('span');
        note.className = 'recipe-note';
        note.textContent = sprintf1(STATE.labels.note, fmtServings(STATE.orig));

        dec.addEventListener('click', function () { setYield(STATE.current - 1); });
        inc.addEventListener('click', function () { setYield(STATE.current + 1); });
        reset.addEventListener('click', function () { setYield(STATE.orig); });
        input.addEventListener('change', function () { setYield(parseFloat(input.value.replace(',', '.'))); });
        input.addEventListener('input', function () { setYield(parseFloat(input.value.replace(',', '.')), true); });

        bar.appendChild(label);
        bar.appendChild(dec);
        bar.appendChild(inc);
        bar.appendChild(reset);
        bar.appendChild(note);

        STATE.input = input;
        STATE.reset = reset;

        var title = wrapper.querySelector(':scope > .recipe-title');
        if (title) title.insertAdjacentElement('afterend', bar);
        else wrapper.insertBefore(bar, wrapper.firstChild);
    }

    function stepButton(glyph, aria) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'recipe-step';
        b.textContent = glyph;
        b.setAttribute('aria-label', aria);
        return b;
    }

    function setYield(value, fromInput) {
        if (isNaN(value) || value <= 0) return;
        value = Math.round(value * 100) / 100;
        STATE.current = value;
        if (!fromInput && STATE.input) STATE.input.value = fmtServings(value);
        if (STATE.reset) STATE.reset.disabled = (value === STATE.orig);
        update();
    }

    function update() {
        var factor = STATE.current / STATE.orig;
        var changed = Math.abs(factor - 1) > 1e-6;
        STATE.amounts.forEach(function (a) {
            a.span.textContent = displayAmount(a, factor);
            if (STATE.showOriginal && a.original) a.span.title = sprintf1(STATE.labels.original, a.original);
            a.span.classList.toggle('recipe-changed', changed);
        });
    }

    /* ================================================================== *
     * Init
     * ================================================================== */

    function findRoot(wrapper) {
        return wrapper.closest('#dokuwiki__content') ||
            wrapper.closest('.dokuwiki') ||
            document.querySelector('#dokuwiki__content') ||
            document.body;
    }

    function init() {
        var wrapper = document.querySelector('.plugin-recipe');
        if (!wrapper || wrapper._recipeReady) return;
        wrapper._recipeReady = true;

        var orig = parseFloat((wrapper.getAttribute('data-yield') || '1').replace(',', '.'));
        if (!(orig > 0)) orig = 1;
        STATE.orig = orig;
        STATE.current = orig;
        DECIMAL = wrapper.getAttribute('data-decimal') || '.';
        STATE.showOriginal = wrapper.getAttribute('data-show-original') !== '0';
        STATE.labels = {
            servings: wrapper.getAttribute('data-label-servings') || 'Servings',
            reset: wrapper.getAttribute('data-label-reset') || 'Reset',
            note: wrapper.getAttribute('data-label-note') || 'Original recipe makes %d servings',
            original: wrapper.getAttribute('data-label-original') || 'Original amount: %s'
        };

        var dict = {};
        try {
            parseIngredientList(wrapper, dict);
            var root = findRoot(wrapper);
            eachTextNode(root, function (node) {
                var matches = scanText(node.nodeValue, dict);
                if (matches.length) rewriteTextNode(node, matches);
            });
            buildControls(wrapper);
            setYield(STATE.current);
        } catch (e) {
            if (window.console) console.error('recipe plugin:', e);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    if (typeof globalThis !== 'undefined' && globalThis.__RECIPE_TEST__) {
        globalThis.__RECIPE_TEST__ = {
            scanText: scanText, displayAmount: displayAmount, evalAmount: evalAmount,
            amtVal: amtVal, learnName: learnName, knownNoun: knownNoun,
            singular: singular, setDecimal: function (d) { DECIMAL = d; }
        };
    }
})();
