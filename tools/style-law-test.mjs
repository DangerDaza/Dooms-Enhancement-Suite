#!/usr/bin/env node
/**
 * The style law (docs/long-shot-plan.md D179), pure: the narrator's own
 * texts of a chat, what recurs in them (the ways of addressing someone,
 * the phrases), how often is too often, and the list held against the
 * scenes that follow.
 *
 * Usage:  node tools/style-law-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 */
import { narratorTexts, countStyle, phraseCount, normalizeStyle, applyStyle, styleLawText, STYLE_MAX_BANS, STYLE_LAPSE, STYLE_SHOWN, STYLE_TICKED } from '../src/utils/styleLaw.js';

let failures = 0;
function check(name, cond, detail = '') {
    if (cond) console.log(`pass  ${name}`);
    else { failures++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('\n§1 the narrator\'s own words');
{
    const chat = [
        { is_user: false, mes: 'The stair goes down. <think>plan the scene</think> *Kiyoha* laughs.', swipes: ['A take that was passed over, sweetheart.', 'Another, sweetheart.'] },
        { is_user: true, mes: 'I go down, sweetheart.' },
        { is_user: false, is_system: true, mes: 'A picture.' },
        { is_user: false, mes: '```json\n{"a":1}\n```\n"Careful, sweetheart," she says. [ITEM: rope] <trackers>x</trackers>' },
        { is_user: false, mes: '   ' }, null, { is_user: false },
    ];
    const t = narratorTexts(chat);
    check('the assistant\'s messages as they stand: no player\'s, no system\'s, no swipes; thinking, blocks, tags and markup taken out', t.length === 2 && t[0] === 'The stair goes down.   Kiyoha  laughs.'.replace(/\s+/g, ' ') || (t.length === 2 && !/think|plan the scene|\*/.test(t[0]) && /Kiyoha/.test(t[0]) && !/json|ITEM|trackers|passed over/.test(t.join(' ')) && /Careful, sweetheart/.test(t[1])), JSON.stringify(t));
    check('nothing in, nothing out', same(narratorTexts(null), []) && same(narratorTexts([]), []));
}

console.log('\n§2 what recurs');
{
    // Thirty messages of a narrator with habits: everyone says "sweetheart", everyone has "a slight knowing smile", "nine years" keeps coming up.
    const who = ['Kiyoha', 'Lysandra', 'Dagger', 'Solveig'];
    const nouns = 'ash brine cinder dew ember frost gravel husk iron jasper kelp lichen moss nettle oak pitch quartz rust slate tallow umber vellum wax yarrow zinc amber birch chalk dross flint'.split(' ');
    const verbs = 'settles gathers cools beads glows creeps shifts rattles groans gleams sways spreads thickens stings creaks hardens glints flakes cracks gutters stains curls drips wilts dulls clouds peels crumbles pools sparks'.split(' ');
    const smiles = ['gives a slight knowing smile', 'turns with a slight knowing smile', 'answers with a slight knowing smile', 'hides a slight knowing smile', 'wears a slight knowing smile'];
    const years = ['It has been nine years', 'Nobody came back in nine years', 'For nine years the door stayed shut', 'She waited nine years', 'After nine years the ink still held', 'They said nine years ago'];
    const calls = ['Careful', 'Come along', 'Easy now', 'Step lightly', 'Mind the edge', 'Not that way', 'Hold the lamp', 'Stay close'];
    const texts = [];
    for (let i = 0; i < 30; i++) {
        const w = who[i % 4];
        const parts = [`${w} waits.`];
        if (i % 2 === 0) parts.push(`"${calls[(i / 2) % calls.length]}, sweetheart," ${w} says.`);
        if (i % 3 === 0) parts.push(`${w} ${smiles[(i / 3) % smiles.length]}.`);
        if (i % 5 === 0) parts.push(`${years[i / 5]}.`);
        if (i % 7 === 0) parts.push(`"Well, I think so," ${w} says. "Come here, ${w}."`);
        if (i === 4) parts.push('"Not tonight, little demon."');
        if (i === 6 || i === 12) parts.push('"Sweetheart, look at this."');
        parts.push(`The ${nouns[i]} ${verbs[i]}.`);    // prose that repeats nothing
        texts.push(parts.join(' '));
    }
    const c = countStyle(texts, { names: who });
    const by = Object.fromEntries(c.phrases.map(p => [p.phrase, p]));
    check('the scene\'s narrator messages are counted', c.messages === 30);
    check('a way of addressing someone that recurs in speech is found, with how often and in how many messages (said first in a speech, too, once it is met after a comma)', !!by.sweetheart && by.sweetheart.kind === 'address' && by.sweetheart.count === 17 && by.sweetheart.inMessages === 15, JSON.stringify(by.sweetheart));
    check('a call or a warning before the comma is no way of addressing anyone: "Careful, sweetheart"', !by.careful && !by['easy now'] && !by['careful sweetheart'] && c.phrases.filter(p => p.kind === 'address').length === 1, JSON.stringify(c.phrases.filter(p => p.kind === 'address')));
    check('a stock phrase is found whole, not as its parts', !!by['slight knowing smile'] && by['slight knowing smile'].kind === 'phrase' && by['slight knowing smile'].count === 10 && !by['slight knowing'] && !by['knowing smile'], JSON.stringify(c.phrases.map(p => p.phrase)));
    check('a short phrase that keeps coming up is found', !!by['nine years'] && by['nine years'].count === 6);
    check('a name is no habit: nobody\'s name is in any phrase, and a name is no way of addressing someone to be counted', c.phrases.every(p => !who.some(n => p.phrase.includes(n.toLowerCase()))));
    check('a word that only ties a sentence together is no way of addressing anyone: "well", "I think so"', !by.well && !by['i think so'] && !by['think so']);
    check('said once, a pet name is not a habit', !by['little demon']);
    check('no phrase begins or ends with a word that carries nothing', c.phrases.every(p => !/^(the|a|of|and|at|it|has|been)\b/.test(p.phrase) && !/\b(the|a|of|and|at|it|and)$/.test(p.phrase)), JSON.stringify(c.phrases.map(p => p.phrase)));
    check('the weightiest come first, a dozen at the most, and the worst are chosen by themselves: every recurring way of addressing someone, and phrases well past the mark', c.phrases.length <= STYLE_SHOWN && c.phrases[0].phrase === 'sweetheart' && by.sweetheart.ticked && by['slight knowing smile'].ticked && c.phrases.filter(p => p.ticked).length <= STYLE_TICKED, JSON.stringify(c.phrases.map(p => [p.phrase, p.count, p.ticked])));
    check('prose with no habits reports none', countStyle(['The cart came up the hill at dawn.', 'Rain had got into the flour sacks overnight.', 'She paid the toll with a bent coin.', 'Two crows fought over a rind by the well.', 'The miller would not open his door.', 'By noon the road was dry again.', 'A child sold them apples at the ford.', 'The inn had one bed and no fire.', 'Somebody had chalked a fish on the gatepost.', 'They slept badly and left before light.']).phrases.length === 0);
    check('a short scene needs three uses at least; nothing and no one in, nothing out', countStyle(['"Come, pet."', '"Sit, pet."']).phrases.length === 0 && countStyle(['"Come, pet."', '"Sit, pet."', '"Stay, pet."']).phrases.some(p => p.phrase === 'pet' && p.kind === 'address') && same(countStyle(null), { messages: 0, phrases: [] }));
    check('how often a phrase turns up: whole words, whatever the case', phraseCount(texts, 'Sweetheart') === 17 && phraseCount(texts, 'nine years') === 6 && phraseCount(texts, 'sweet') === 0 && phraseCount(texts, '') === 0 && phraseCount(null, 'x') === 0);
}

console.log('\n§3 the list held against the scenes that follow');
{
    const scene1 = ['"Careful, sweetheart." A slight knowing smile.', '"Come, sweetheart."', 'Nine years. "Now, sweetheart."'];
    let law = applyStyle(null, { texts: scene1, chosen: [{ phrase: 'Sweetheart', kind: 'address', count: 3 }, { phrase: 'slight knowing smile' }], scene: 's1' });
    check('the phrases chosen at an End are the law: as counted, with the scene they were first held from', same(law.bans.map(b => [b.phrase, b.kind, b.count, b.since, b.idle]), [['sweetheart', 'address', 3, 's1', 0], ['slight knowing smile', 'phrase', 1, 's1', 0]]));
    const text = styleLawText(law);
    check('the narrator is told it in a line: each phrase, a way of addressing someone said to be one, and that no pet name or gesture is shared', text.startsWith('Style law:') && text.includes('"sweetheart" as a way of addressing anyone') && text.includes('"slight knowing smile"') && /no pet name or gesture is shared between them/.test(text) && styleLawText(null) === '' && styleLawText({ bans: [] }) === '');
    law = applyStyle(law, { texts: ['The gate. "Careful, sweetheart."', 'Fog.'], chosen: [], scene: 's2' });
    check('a phrase that turned up again despite the law stays, with its new count; one that did not has been idle a scene', same(law.bans.map(b => [b.phrase, b.count, b.idle]), [['sweetheart', 1, 0], ['slight knowing smile', 1, 1]]));
    law = applyStyle(law, { texts: ['Fog.'], chosen: [], scene: 's3' });
    law = applyStyle(law, { texts: ['Fog.'], chosen: [], scene: 's4' });
    check(`a phrase not seen for ${STYLE_LAPSE} scenes drops off by itself`, !law.bans.some(b => b.phrase === 'slight knowing smile') && law.bans.some(b => b.phrase === 'sweetheart' && b.idle === 2));
    law = applyStyle(law, { texts: ['Fog.'], chosen: [], scene: 's5' });
    check('and so the list empties when the habits are gone', law.bans.length === 0);
    const many = applyStyle(null, { texts: [], chosen: Array.from({ length: 15 }, (_, i) => ({ phrase: `stock phrase number ${String.fromCharCode(97 + i)}`, count: 15 - i })), scene: 's1' });
    check(`the list holds ${STYLE_MAX_BANS} at the most, the most used kept`, many.bans.length === STYLE_MAX_BANS && many.bans[0].count === 15 && many.bans[STYLE_MAX_BANS - 1].count === 6);
    check('a stored law is made safe: no doubles, no junk, within the limit', same(normalizeStyle({ bans: [{ phrase: ' Sweetheart ' }, { phrase: 'sweetheart', kind: 'address' }, null, { phrase: '' }, { phrase: 'nine  years', count: -2, idle: 'x', kind: 'what' }] }).bans, [{ phrase: 'sweetheart', kind: 'phrase', count: 0, since: '', idle: 0 }, { phrase: 'nine years', kind: 'phrase', count: 0, since: '', idle: 0 }]) && same(normalizeStyle(null), { bans: [] }) && same(normalizeStyle(JSON.parse(JSON.stringify(law))), law));
    check('a long law is cut to its length by dropping the last phrases, never mid-phrase', (() => { const t = styleLawText(many, { max: 260 }); return t.length <= 260 && t.startsWith('Style law:') && /shared between them\.$/.test(t); })());
}

console.log(failures ? `\n${failures} failure(s)` : '\nall pass');
process.exit(failures ? 1 : 0);
