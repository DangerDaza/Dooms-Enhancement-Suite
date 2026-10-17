#!/usr/bin/env node
/**
 * Cut to a quest, the pure parts: the quest list after a cut, the facts of
 * now read from the info box, and the instruction the next reply gets.
 *
 * Usage:  node tools/quest-cut-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 */
import { questText, normalizeQuests, cleanWhen, promoteQuest, sceneFactsFrom, buildQuestCutInstruction, QUEST_CUT_SLOT, MAX_WHEN } from '../src/utils/questCut.js';

let failures = 0;
function check(name, ok, detail = '') {
    if (ok) {
        console.log(`pass  ${name}`);
    } else {
        failures++;
        console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('\n§1 quest text and lists');
check('plain, wrapped and nested entries', questText('Find  the\nwarden') === 'Find the warden' && questText({ value: 'A' }) === 'A' && questText({ value: { value: 'B' } }) === 'B' && questText({ title: 'C' }) === 'C' && questText(null) === '' && questText(7) === '7');
check('normalizeQuests keeps positions and says None', same(normalizeQuests({ main: { value: 'M' }, optional: ['a', '', { value: 'c' }] }), { main: 'M', optional: ['a', '', 'c'] }) && same(normalizeQuests(null), { main: 'None', optional: [] }) && normalizeQuests({ main: '' }).main === 'None');
check('cleanWhen trims, drops brackets and the full stop, and caps', cleanWhen('  by  nightfall. ') === 'by nightfall' && cleanWhen('[soon]') === 'soon' && cleanWhen('x'.repeat(200)).length === MAX_WHEN && cleanWhen(null) === '');

console.log('\n§2 promoteQuest');
{
    const q = { main: 'Find the warden', optional: ['Feed the cat', "Sole's key", 'Fix the roof'] };
    const r = promoteQuest(q, 'optional', 1);
    check('an optional quest becomes the main one and the old main tops the optional list', r.changed && r.quest === "Sole's key" && same(r.quests, { main: "Sole's key", optional: ['Find the warden', 'Feed the cat', 'Fix the roof'] }), JSON.stringify(r));
    check('the input is untouched', q.main === 'Find the warden' && q.optional.length === 3);
    const none = promoteQuest({ main: 'None', optional: ['Only'] }, 'optional', 0);
    check('with no main quest nothing drops down', none.changed && same(none.quests, { main: 'Only', optional: [] }));
    const main = promoteQuest(q, 'main');
    check('the main quest itself: the quest, no change', !main.changed && main.quest === 'Find the warden' && same(main.quests, normalizeQuests(q)));
    check('no main quest: nothing to cut to', promoteQuest({ main: 'None', optional: [] }, 'main').quest === '');
    check('out of range, blank or None: nothing', !promoteQuest(q, 'optional', 9).quest && !promoteQuest({ optional: ['', 'None'] }, 'optional', 0).quest && !promoteQuest({ optional: ['', 'None'] }, 'optional', 1).quest && !promoteQuest(q, 'optional', 'x').quest);
    check('a string index works', promoteQuest(q, 'optional', '2').quest === 'Fix the roof');
    check('wrapped entries', promoteQuest({ main: { value: 'M' }, optional: [{ value: 'O' }] }, 'optional', 0).quests.main === 'O');
}

console.log('\n§3 sceneFactsFrom');
check('nothing', same(sceneFactsFrom(null), { date: '', time: '', location: '' }) && same(sceneFactsFrom(''), { date: '', time: '', location: '' }) && same(sceneFactsFrom('   '), { date: '', time: '', location: '' }));
check('JSON with strings', same(sceneFactsFrom('{"date":"Tuesday, 3 Harvest","time":"dusk → night","location":"The Knife Wall","weather":"rain"}'), { date: 'Tuesday, 3 Harvest', time: 'dusk → night', location: 'The Knife Wall' }));
check('JSON with value objects and a time object', same(sceneFactsFrom('{"date":{"value":"3 Harvest"},"time":{"start":"dusk","end":"night"},"location":{"value":"The Knife Wall"}}'), { date: '3 Harvest', time: 'dusk → night', location: 'The Knife Wall' }));
check('a time object with one end', sceneFactsFrom({ time: { start: 'dawn', end: 'dawn' } }).time === 'dawn' && sceneFactsFrom({ time: { end: 'noon' } }).time === 'noon');
check('an already parsed object', same(sceneFactsFrom({ date: 'D', time: 'T', location: 'L' }), { date: 'D', time: 'T', location: 'L' }));
check('JSON in a fenced block', sceneFactsFrom('```json\n{"date":"D","time":"T","location":"L"}\n```').location === 'L');
check('the older text form', same(sceneFactsFrom('Date: Tuesday\nTime: dusk → night\nLocation: The Knife Wall\nWeather: rain'), { date: 'Tuesday', time: 'dusk → night', location: 'The Knife Wall' }));
check('the emoji text form', same(sceneFactsFrom('📅: Tuesday\n🕒: dusk\n🗺️: The wall'), { date: 'Tuesday', time: 'dusk', location: 'The wall' }));
check('garbage is no fact', same(sceneFactsFrom('{not json'), { date: '', time: '', location: '' }) && same(sceneFactsFrom('just prose'), { date: '', time: '', location: '' }));

console.log('\n§4 the instruction');
{
    const text = buildQuestCutInstruction({ quest: "Sole's key: twelve crowns", userName: 'Jordan', facts: { date: 'Tuesday', time: 'dusk', location: 'The Knife Wall' }, otherQuests: ['Feed the cat', 'None', "Sole's key: twelve crowns", 'Fix the roof'] });
    check('names the player and the quest', text.startsWith('[CUT TO A QUEST: Jordan has chosen to skip ahead to this quest: "Sole\'s key: twelve crowns".') && text.endsWith(']'), text.slice(0, 120));
    check('anchors now', text.includes('from now (Tuesday, dusk, at The Knife Wall)'));
    check('montage first, in summary, never played out', text.includes('a brief montage of a paragraph or two') && text.includes('told in summary and never played out'));
    check('without a when, the AI judges the time', text.includes('yours to judge from the quest: hours or days'));
    check('then the opening beat with the first move the player\'s, never the quest itself', text.includes("stop with the first move still Jordan's") && text.includes('Do not play the quest or resolve any part of it in this reply'));
    check('the other quests ride, without None and without the quest itself', text.includes('The other quests (Feed the cat; Fix the roof) stay as they are'));
    check('the tracker block still follows, moved to where the cut lands', text.includes('the tracker data block and everything else you are required to output still follow as usual') && text.includes('date, time and location moved to where the cut lands') && text.includes('what Jordan carries kept consistent'));
    check('one line', !text.includes('\n'));
    const w = buildQuestCutInstruction({ quest: 'Q', when: ' after the thaw. ' });
    check('a when replaces the judging clause', w.includes('It begins after the thaw.') && !w.includes('yours to judge') && w.includes('the player has chosen') && w.includes("still the player's"));
    const bare = buildQuestCutInstruction({ quest: 'Q' });
    check('no facts, no others: plain clauses', bare.includes('what passes from now until') && !bare.includes('from now (') && !bare.includes('The other quests'));
    check('brackets and quotes in a quest cannot break the tag', !buildQuestCutInstruction({ quest: 'Find ["the"] key' }).includes('["') && buildQuestCutInstruction({ quest: 'Find ["the"] key' }).includes('Find “the” key'));
    check('a very long quest is cut', buildQuestCutInstruction({ quest: 'q'.repeat(400) }).length < 1200);
    check('no quest, no instruction', buildQuestCutInstruction({ quest: '' }) === '' && buildQuestCutInstruction() === '');
    check('the slot name', QUEST_CUT_SLOT === 'dooms-quest-cut');
}

console.log(`\n${failures === 0 ? 'All quest cut checks pass' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
