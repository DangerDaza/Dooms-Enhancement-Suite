#!/usr/bin/env node
/**
 * Example dialogue for the Workshop's characters (docs/long-shot-plan.md
 * D212): what a card keeps, who the tracker has in the scene with some,
 * and the block that is sent with a reply.
 *
 * Usage:  node tools/example-dialogue-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 */
import { DIALOGUE, dialogueConfig, cleanDialogue, dialogueOf, dialogueCard, dialogueText, presentWithDialogue, buildDialogueBlock } from '../src/utils/exampleDialogue.js';

let failures = 0;
const check = (label, cond, extra = '') => {
    if (cond) console.log(`pass  ${label}`);
    else { console.error(`FAIL  ${label}${extra ? '\n      ' + extra : ''}`); failures++; }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('the setting');
check('on unless switched off, four messages from the end, as the system', same(dialogueConfig({}), { enabled: true, depth: 4, role: 'system' }) && same(dialogueConfig(null), { enabled: true, depth: 4, role: 'system' }));
check('off by exactly that; the depth kept between 0 and 20; a voice it does not know is the system\'s', dialogueConfig({ exampleDialogue: { enabled: false } }).enabled === false && dialogueConfig({ exampleDialogue: { enabled: 'no' } }).enabled === true && dialogueConfig({ exampleDialogue: { depth: 99 } }).depth === 20 && dialogueConfig({ exampleDialogue: { depth: -3 } }).depth === 0 && dialogueConfig({ exampleDialogue: { depth: 'x' } }).depth === 4 && dialogueConfig({ exampleDialogue: { role: 'user' } }).role === 'user' && dialogueConfig({ exampleDialogue: { role: 'narrator' } }).role === 'system');

console.log('\nwhat a card keeps');
check('the text as typed: line ends made one kind, space at a line\'s end gone, blank lines inside kept, none at either end', cleanDialogue('\r\n"Late again."  \r\n\r\n"Sit."\t\n\n') === '"Late again."\n\n"Sit."');
check('nothing is nothing', cleanDialogue('') === '' && cleanDialogue(null) === '' && cleanDialogue('  \n \n') === '');
check('a card holds so much and no more', cleanDialogue('x'.repeat(DIALOGUE.stored + 500)).length === DIALOGUE.stored);
const store = { Kiyoha: { description: 'A fighter.', lorebook: '', dialogue: '"You are late."\n"Sit. Eat. Then talk."' }, 'Old Marit': { description: 'Keeps the Anchor.', lorebook: '' }, Lysandra: { dialogue: '   ' }, Broken: 'not an entry' };
check('a character\'s example dialogue is read from their Workshop entry, whatever the case of the name', dialogueOf(store, 'Kiyoha') === '"You are late."\n"Sit. Eat. Then talk."' && dialogueOf(store, 'kiyoha') === dialogueOf(store, 'Kiyoha'));
check('the card is named in its own spelling', same(dialogueCard(store, 'KIYOHA'), { name: 'Kiyoha', dialogue: '"You are late."\n"Sit. Eat. Then talk."' }) && dialogueCard(store, 'Old Marit') === null);
check('a character with none, with only space, with a broken entry, or not in the Workshop, has none', dialogueOf(store, 'Old Marit') === '' && dialogueOf(store, 'Lysandra') === '' && dialogueOf(store, 'Broken') === '' && dialogueOf(store, 'Nobody') === '' && dialogueOf(null, 'Kiyoha') === '' && dialogueOf(store, '') === '');

console.log('\nthe text as it is sent');
check('SillyTavern\'s marks are read as its own example dialogue reads them: the character, the player, a break between examples', dialogueText('<START>\n{{user}}: Where were you?\n{{char}}: "Out."\n<start>\n{{Char}}: "Sit."', { name: 'Kiyoha', player: 'Jordan' }) === 'Jordan: Where were you?\nKiyoha: "Out."\n\nKiyoha: "Sit."');
check('with no names to put in, it says who is meant', dialogueText('{{char}} to {{user}}') === 'the character to the player');
const long = Array.from({ length: 40 }, (x, k) => `"Line number ${k + 1} of what she says, at some length."`).join('\n');
const cut = dialogueText(long, { name: 'Kiyoha', max: 400 });
check('too long, it is cut at the end of a line, never in the middle of one', cut.length <= 400 && cut.endsWith('at some length."') && long.startsWith(cut));
check('one line longer than the room is cut and marked as cut', dialogueText('x'.repeat(900), { max: 300 }).length === 300 && dialogueText('x'.repeat(900), { max: 300 }).endsWith('…'));

console.log('\nwho is in the scene with some');
const tracker = JSON.stringify({ characters: [
    { name: 'Lysandra', thoughts: { content: 'Cold hands.' } },
    { name: 'Kiyoha', thoughts: { content: 'Late again.' } },
    { name: 'Old Marit', thoughts: { content: 'Off-scene: at the Anchor' } },
    { name: 'Jordan', thoughts: { content: '' } },
    { name: 'The Gardener', thoughts: '' },
] });
const book = { ...store, 'Old Marit': { dialogue: '"Mind the nets."' }, Gardener: { dialogue: '"The roses know."' }, Jordan: { dialogue: '"I am the player."' }, Absent: { dialogue: '"Not here."' } };
const got = presentWithDialogue(tracker, book, { resolve: (n) => (n === 'The Gardener' ? 'Gardener' : n), players: ['Jordan'] });
check('the characters the tracker has present, who have example dialogue, in the tracker\'s order', same(got.map(x => x.name), ['Kiyoha', 'Gardener']), JSON.stringify(got.map(x => x.name)));
check('not one the tracker marks as off the scene, not one who is not there, never the player, and not one with nothing written', !got.some(x => ['Old Marit', 'Absent', 'Jordan', 'Lysandra'].includes(x.name)));
check('the tracker\'s name for someone is turned into the Workshop\'s, and their card found under it', got[1].dialogue === '"The roses know."');
check('a card under the tracker\'s own name is found too when the turned name has none', same(presentWithDialogue(JSON.stringify([{ name: 'Kiyoha' }]), store, { resolve: () => 'Somebody Else' }).map(x => x.dialogue), ['"You are late."\n"Sit. Eat. Then talk."']));
check('someone listed twice is sent once', presentWithDialogue(JSON.stringify([{ name: 'Kiyoha' }, { name: 'kiyoha' }]), store).length === 1);
check('they are named as their card names them, whatever the tracker\'s spelling', same(presentWithDialogue(JSON.stringify([{ name: 'KIYOHA' }]), store).map(x => x.name), ['Kiyoha']));
check('no tracker, no one present, no Workshop: no one', same(presentWithDialogue(null, book), []) && same(presentWithDialogue('{"characters":[]}', book), []) && same(presentWithDialogue(tracker, null), []) && same(presentWithDialogue(tracker, {}), []));
const crowd = Array.from({ length: 12 }, (x, k) => ({ name: `Person ${k + 1}` }));
check('a crowd: the first eight the tracker lists', presentWithDialogue(JSON.stringify(crowd), Object.fromEntries(crowd.map(c => [c.name, { dialogue: 'x' }]))).length === DIALOGUE.people);

console.log('\nthe block that is sent');
const block = buildDialogueBlock(got, { player: 'Jordan' });
check('it says what the lines are for and that they are not to be repeated, then each character\'s under their name', block.startsWith('[How the people in this scene speak. Below are example lines for each of them: they show that person\'s voice') && /Write what they say in that voice\. The lines are examples and were never said in this story: do not repeat or quote them\.\]\n/.test(block) && block.endsWith('Kiyoha:\n"You are late."\n"Sit. Eat. Then talk."\n\nGardener:\n"The roses know."'), block);
check('for one character it says so', buildDialogueBlock(got.slice(0, 1)).includes('example lines for one of them'));
check('no one with any: nothing is sent', buildDialogueBlock([]) === '' && buildDialogueBlock(null) === '' && buildDialogueBlock([{ name: 'Kiyoha', dialogue: '' }, { name: '', dialogue: 'x' }]) === '');
const heavy = Array.from({ length: 8 }, (x, k) => ({ name: `Person ${k + 1}`, dialogue: `"${'word '.repeat(280)}"` }));
const big = buildDialogueBlock(heavy);
const sent = (big.match(/^Person \d+:$/gm) || []).length;
check('everyone\'s together is held to its room: the first ones whole, the rest left out, none cut to a stub', sent >= 4 && sent < 8 && big.length < DIALOGUE.total + 600 && big.split('\n\n').slice(1).every(p => p.length > 1000), `${sent} sent, ${big.length} characters`);
check('one character\'s alone is held to its own room', buildDialogueBlock([{ name: 'Kiyoha', dialogue: long.repeat(3) }]).length < DIALOGUE.perChar + 400);
check('the marks are read in the block as well', buildDialogueBlock([{ name: 'Kiyoha', dialogue: '{{char}}: "Sit, {{user}}."' }], { player: 'Jordan' }).endsWith('Kiyoha:\nKiyoha: "Sit, Jordan."'));

console.log(failures ? `\n${failures} FAILED` : '\nall pass');
process.exit(failures ? 1 : 0);
