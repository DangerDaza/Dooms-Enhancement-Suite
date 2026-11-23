#!/usr/bin/env node
/**
 * Who the player is playing (src/utils/activeUser.js, D226, D230).
 *
 * Usage:  node tools/active-user-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 */
import { strict as assert } from 'node:assert';
import { pickActiveUser, setStoryAnchor, getStoryAnchor, userOfCard, cardsOf, setCardsOf, cardOptions } from '../src/utils/activeUser.js';

let failures = 0;
let passes = 0;
function test(name, fn) {
    try { setStoryAnchor(); fn(); passes++; } catch (e) { failures++; console.error(`FAIL: ${name}\n  ${e?.message || e}`); }
}

const JACK_CARD = 'Nightcity - Narrator.png';
const ELI_CARD = 'Nightcity - Minotaur Narrator.png';
const users = {
    Jack: { linkedPersona: 'jack.png', cards: [JACK_CARD] },
    'Eli Vega': { linkedPersona: '1795401718528-EliVega.png', cards: [ELI_CARD, ' ', ELI_CARD] },
    Eli: { linkedPersona: 'eli-neverdark.png' },
    Loose: {},
};

test('the card is the anchor: a chat on a tied card is played as its user character, whatever persona is in use or picked', () => {
    assert.equal(pickActiveUser({ userCharacters: users, cards: [ELI_CARD], avatar: 'jack.png', pin: 'Jack' }), 'Eli Vega');
    assert.equal(pickActiveUser({ userCharacters: users, cards: [JACK_CARD], avatar: '1795401718528-EliVega.png', story: 'Eli Vega', pin: 'Loose' }), 'Jack');
});
test('the story\'s narrator card comes before the chat\'s own card', () => {
    assert.equal(pickActiveUser({ userCharacters: users, cards: [JACK_CARD, ELI_CARD] }), 'Jack');
    assert.equal(pickActiveUser({ userCharacters: users, cards: ['scene-card.png', ELI_CARD] }), 'Eli Vega');
});
test('a card tied to no one: the player the story remembers', () => {
    assert.equal(pickActiveUser({ userCharacters: users, cards: ['scene-card.png'], story: 'eli vega', avatar: 'jack.png', pin: 'Jack' }), 'Eli Vega');
});
test('no tie and no story: the persona in use, before the hand pick', () => {
    assert.equal(pickActiveUser({ userCharacters: users, cards: ['other.png'], avatar: '1795401718528-EliVega.png', pin: 'Jack' }), 'Eli Vega');
});
test('the anchor set by the hub is used when none is handed in', () => {
    setStoryAnchor({ player: '  Jack  ', cards: ['', ELI_CARD, ELI_CARD, null] });
    assert.deepEqual(getStoryAnchor(), { player: 'Jack', cards: [ELI_CARD] });
    assert.equal(pickActiveUser({ userCharacters: users, pin: 'Loose' }), 'Eli Vega');
    setStoryAnchor({ player: 'Jack' });
    assert.equal(pickActiveUser({ userCharacters: users, avatar: 'eli-neverdark.png', pin: 'Loose' }), 'Jack');
    setStoryAnchor();
    assert.deepEqual(getStoryAnchor(), { player: '', cards: [] });
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
test('the user character tied to a card; the cards of one, each once', () => {
    assert.equal(userOfCard(users, ELI_CARD), 'Eli Vega');
    assert.equal(userOfCard(users, 'nobody.png'), '');
    assert.equal(userOfCard(users, ''), '');
    assert.equal(userOfCard(null, ELI_CARD), '');
    assert.deepEqual(cardsOf(users['Eli Vega']), [ELI_CARD]);
    assert.deepEqual(cardsOf({ cards: 'x' }), []);
    assert.deepEqual(cardsOf(null), []);
});

test('saving a user character\'s cards: kept when any, dropped when none, and a card taken is let go by whoever had it', () => {
    const map = { Jack: { cards: [JACK_CARD, 'shared.png'] }, 'Eli Vega': {}, Loose: { cards: ['shared.png'] } };
    assert.deepEqual(setCardsOf(map, 'Eli Vega', [ELI_CARD, 'shared.png', ELI_CARD, '']), [ELI_CARD, 'shared.png']);
    assert.deepEqual(map['Eli Vega'].cards, [ELI_CARD, 'shared.png']);
    assert.deepEqual(map.Jack.cards, [JACK_CARD]);
    assert.equal('cards' in map.Loose, false);
    assert.deepEqual(setCardsOf(map, 'Eli Vega', []), []);
    assert.equal('cards' in map['Eli Vega'], false);
    assert.deepEqual(map.Jack.cards, [JACK_CARD]);
    assert.deepEqual(setCardsOf(map, 'Nobody', [ELI_CARD]), []);
    assert.equal(userOfCard(map, ELI_CARD), '');
});
test('the cards the Workshop offers: the ones already had left out, another\'s said to be, two of one name told apart', () => {
    const choices = [{ avatar: 'a.png', name: 'Narrator' }, { avatar: 'b.png', name: 'Narrator' }, { avatar: JACK_CARD, name: 'Nightcity - Narrator' }, { avatar: ELI_CARD, name: 'Nightcity - Minotaur Narrator' }, { avatar: '', name: 'No file' }, null];
    assert.deepEqual(cardOptions(choices, users, 'Eli Vega', [ELI_CARD]), [
        { avatar: 'a.png', label: 'Narrator (a.png)' },
        { avatar: 'b.png', label: 'Narrator (b.png)' },
        { avatar: JACK_CARD, label: 'Nightcity - Narrator (played as Jack)' },
    ]);
    assert.deepEqual(cardOptions(choices, users, 'Jack', [JACK_CARD]).map(o => o.label), ['Narrator (a.png)', 'Narrator (b.png)', 'Nightcity - Minotaur Narrator (played as Eli Vega)']);
    assert.deepEqual(cardOptions(null, users, 'Jack'), []);
});

console.log(`active-user-test: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
