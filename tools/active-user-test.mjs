#!/usr/bin/env node
/**
 * Who the player is playing (src/utils/activeUser.js, D226).
 *
 * Usage:  node tools/active-user-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 */
import { strict as assert } from 'node:assert';
import { pickActiveUser, setStoryPlayer, getStoryPlayer } from '../src/utils/activeUser.js';

let failures = 0;
let passes = 0;
function test(name, fn) {
    try { setStoryPlayer(''); fn(); passes++; } catch (e) { failures++; console.error(`FAIL: ${name}\n  ${e?.message || e}`); }
}

const users = {
    Jack: { linkedPersona: 'jack.png' },
    'Eli Vega': { linkedPersona: '1795401718528-EliVega.png' },
    Eli: { linkedPersona: 'eli-neverdark.png' },
    Loose: {},
};

test('the persona in use beats the hand pick', () => {
    assert.equal(pickActiveUser({ userCharacters: users, avatar: '1795401718528-EliVega.png', pin: 'Jack' }), 'Eli Vega');
});
test('the persona in use beats the story in front', () => {
    assert.equal(pickActiveUser({ userCharacters: users, avatar: 'jack.png', story: 'Eli Vega', pin: '' }), 'Jack');
});
test('with no linked persona the story in front beats the hand pick', () => {
    assert.equal(pickActiveUser({ userCharacters: users, avatar: 'someone-else.png', story: 'eli vega', pin: 'Jack' }), 'Eli Vega');
});
test('the story player set by the hub is used when none is handed in', () => {
    setStoryPlayer('  Jack  ');
    assert.equal(getStoryPlayer(), 'Jack');
    assert.equal(pickActiveUser({ userCharacters: users, pin: 'Loose' }), 'Jack');
});
test('a story player who is no user character is passed over', () => {
    assert.equal(pickActiveUser({ userCharacters: users, story: 'Stranger', pin: 'Loose' }), 'Loose');
});
test('the hand pick where nothing else says', () => {
    assert.equal(pickActiveUser({ userCharacters: users, pin: 'Jack' }), 'Jack');
});
test('a hand pick that is gone is passed over', () => {
    assert.equal(pickActiveUser({ userCharacters: users, pin: 'Gone' }), '');
});
test('the only user character', () => {
    assert.equal(pickActiveUser({ userCharacters: { Solo: {} } }), 'Solo');
});
test('nothing to go on', () => {
    assert.equal(pickActiveUser({ userCharacters: users }), '');
    assert.equal(pickActiveUser({ userCharacters: null }), '');
    assert.equal(pickActiveUser(), '');
});
test('a name that only resembles another is not it ("Eli" is not "Eli Vega")', () => {
    assert.equal(pickActiveUser({ userCharacters: users, story: 'Eli' }), 'Eli');
});

console.log(`active-user-test: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
