#!/usr/bin/env node
/**
 * Fixture test for BunnyMo sheet detection + parsing.
 *
 * Detection must accept every official BunnyMo template shape (headers below
 * are VERBATIM from the lorebook JSONs, versions V2 through V3.0) plus
 * plausible AI drift, and must reject ordinary RPG prose that the pre-2.4
 * heuristic false-positived on (HP/MP stat blocks, day counters).
 *
 * Usage:  node tools/sheet-detect-test.mjs     (from the repo root)
 * Exit:   0 = all fixtures pass, 1 = failure (table printed)
 *
 * Run together with tools/load-check.mjs before every push that touches
 * detection or the parser.
 */
import { messageHasFullSheet } from '../src/systems/ui/fullsheetButtons.js';

const MUST_MATCH = [
    ['V3.0 fullsheet (verbatim, /14, emoji after colon)', `
## SECTION 1/14: 🆔 **Core Identity & Context**
**Name:** [Luna]
---
## SECTION 2/14: 👁️**Physical Manifestation**
stuff
---
## SECTION 3/14: 🧠 **Psyche & Behavioral Matrix**
stuff`],
    ['V3.0 quicksheet (verbatim, /8, title line)', `
# 🎯 QUICKSHEET CHARACTER ANALYSIS 🎯
## SECTION 1/8: 🆔 **Core Identity**
stuff
## SECTION 2/8: 👁️ **Physical & Aesthetic**
stuff`],
    ['V2 fullsheet (plain, no emoji/bold)', `
## SECTION 1/8: Core Identity & Context
stuff
## SECTION 2/8: Psychological Architecture
stuff`],
    ['V2.9 fullsheet (/13)', `
## SECTION 1/13: 🆔 **Core Identity & Context**
stuff
## SECTION 13/13: 🤫**Hidden Depths & Secret Architecture**
stuff`],
    ['V2.8 sloppy spacing + malformed last header', `
## SECTION 7/8:👗**Aesthetic Expression & Style Philosophy**
stuff
## SECTION 8/8: Origin Story
stuff`],
    ['drift: ### hashes', `
### SECTION 1/14: Core Identity
stuff
### SECTION 2/14: Physical
stuff`],
    ['drift: emoji token before SECTION', `
## 🥕 SECTION 1/8: Core Identity
stuff
## 🥕 SECTION 2/8: Psyche
stuff`],
    ['drift: indented headers', `
  ## SECTION 1/8: Core
stuff
  ## SECTION 2/8: Psyche
stuff`],
    ['drift: <summary>-wrapped headers', `
<details><summary>SECTION 1/8: Core Identity</summary>stuff</details>
<details><summary>SECTION 2/8: Psyche</summary>stuff</details>`],
    ['drift: fullwidth slash', `
## SECTION 1／8: Core
stuff
## SECTION 2／8: Psyche
stuff`],
    ['continuation message (sections 5-8, no low N)', `
## SECTION 5/8: Psychology & Conflict
stuff
## SECTION 6/8: Background
stuff
## SECTION 7/8: Behavioral Patterns
stuff`],
    ['BunnymoTags block alone (truncation-proof marker)', `
Here is the analysis.
<BunnymoTags><SPECIES:CAT>, <GENDER:FEMALE>, <GENRE:BAD_ROMANCE></BunnymoTags>`],
    ['3+ machine tags without wrapper (verbatim tag shapes)', `
**🏷️ TAG:** <BOUNDARIES:POROUS>
**🏷️ TAG:** <GENRE:BAD_ROMANCE>
**🏷️ TAG:** <SPECIES:BLANK>`],
    ['drifted quicksheet: title + bold blocks, unnumbered', `
# 🐰 QUICK SHEET: Luna
**Physical:** Silver hair, violet eyes, petite frame with a dancer's poise and a wardrobe of moonlight silks.
**Personality:** Sharp-tongued but secretly sentimental; collects grudges and seashells with equal devotion.
**Speech:** Clipped sentences that melt into rambling when she's flustered or talking about the sea.`],
];

const MUST_NOT_MATCH = [
    ['HP/MP stat block', 'HP 45/100\nMP 30/50\nThe battle continues...'],
    ['Day/Round counters (different denominators)', 'Day 3/10 of the voyage.\nRound 2/5 begins.'],
    ['two same-M day mentions (no low N, only 2)', 'Day 6/10 passed quietly.\nLater...\nDay 7/10 arrived with rain.'],
    ['dates', '07/18 was the date.\n08/19 came later.'],
    ['single truncated section (button arrives after Continue)', '## SECTION 1/14: 🆔 **Core Identity & Context**\n**Name:** [Luna]'],
    ['prose mentioning quicksheet', 'Want me to put together a quicksheet for her? Just say the word and **I will**.'],
    ['angle-bracket URLs are not machine tags', 'See <https://example.com/a>, <https://example.com/b>, and <https://example.com/c> for details.'],
    ['plain prose', 'She smiled and waved at the crowd.'],
    ['empty', ''],
];

let failures = 0;
for (const [label, text] of MUST_MATCH) {
    const got = messageHasFullSheet(text);
    if (!got) { failures++; console.log(`FAIL (expected match):    ${label}`); }
    else console.log(`pass  match:              ${label}`);
}
for (const [label, text] of MUST_NOT_MATCH) {
    const got = messageHasFullSheet(text);
    if (got) { failures++; console.log(`FAIL (expected no-match): ${label}`); }
    else console.log(`pass  no-match:           ${label}`);
}

if (failures) {
    console.error(`\n${failures} fixture(s) failed`);
    process.exit(1);
}
console.log('\nAll sheet-detection fixtures pass');
