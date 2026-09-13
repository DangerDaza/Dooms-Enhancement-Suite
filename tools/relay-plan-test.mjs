#!/usr/bin/env node
/** Unit tests for src/systems/relay/relayPlan.js (pure helpers). */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { parseSseData, foldStream, isPrefixOrEmpty, planReplyApply, chatKeyOf, resolveKind, resolveMarker } =
    await import(path.join(here, '..', 'src', 'systems', 'relay', 'relayPlan.js'));

let passed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log(`  ok  ${name}`); }
    catch (e) { console.error(`FAIL  ${name}\n${e?.stack || e}`); process.exitCode = 1; }
}

const openaiDelta = (p, state) => {
    if (p?.reasoning) state.reasoning += p.reasoning;
    return p?.choices?.[0]?.delta?.content ?? '';
};

test('parseSseData ignores comments, keeps order, joins multi-line data', () => {
    const text = ': ping\n\ndata: a\n\n: ping\n\ndata: b\ndata: c\n\nevent: x\ndata: d\n\ndata: [DONE]\n\n';
    assert.deepEqual(parseSseData(text), ['a', 'b\nc', 'd', '[DONE]']);
    assert.deepEqual(parseSseData('data: crlf\r\n\r\ndata: two\r\n\r\n'), ['crlf', 'two']);
    assert.deepEqual(parseSseData(''), []);
});

test('foldStream accumulates deltas, stops at [DONE], surfaces in-band errors', () => {
    const body = ['{"choices":[{"delta":{"content":"Hel"}}]}', 'not json', '{"choices":[{"delta":{"content":"lo"}}],"reasoning":"why"}', '[DONE]', '{"choices":[{"delta":{"content":"IGNORED"}}]}']
        .map(d => `data: ${d}\n\n`).join('');
    const r = foldStream(body, openaiDelta);
    assert.equal(r.text, 'Hello');
    assert.equal(r.reasoning, 'why');
    assert.equal(r.error, null);
    const err = foldStream('data: {"error":{"message":"boom"}}\n\n', openaiDelta);
    assert.equal(err.error, 'boom');
    assert.equal(err.text, '');
});

test('isPrefixOrEmpty', () => {
    assert.equal(isPrefixOrEmpty('', 'full'), true);
    assert.equal(isPrefixOrEmpty('...', 'full'), true);
    assert.equal(isPrefixOrEmpty('fu', 'full'), true);
    assert.equal(isPrefixOrEmpty('fu  ', 'full'), true);
    assert.equal(isPrefixOrEmpty('full', 'full'), false, 'identical is not a prefix (caller treats as present)');
    assert.equal(isPrefixOrEmpty('other', 'full'), false);
    assert.equal(isPrefixOrEmpty(undefined, 'full'), false);
});

const user = (mes) => ({ is_user: true, mes });
const bot = (mes, swipes) => ({ is_user: false, mes, swipes: swipes ?? [mes], swipe_id: swipes ? swipes.indexOf(mes) : 0 });

test('normal: append after the user message, replace partial, keep foreign text', () => {
    assert.deepEqual(planReplyApply({ kind: 'normal', messageIndex: 2 }, [user('a'), user('b')], 'reply'), { action: 'append', index: 2 });
    assert.deepEqual(planReplyApply({ kind: 'normal', messageIndex: 1 }, [user('a'), bot('rep')], 'reply'), { action: 'replace', index: 1 });
    assert.deepEqual(planReplyApply({ kind: 'normal', messageIndex: 1 }, [user('a'), bot('reply')], 'reply'), { action: 'noop', reason: 'present' });
    assert.deepEqual(planReplyApply({ kind: 'regenerate', messageIndex: 1 }, [user('a'), bot('old', ['old', 'reply'])], 'reply'), { action: 'noop', reason: 'present' }, 'already one of the swipes');
    assert.equal(planReplyApply({ kind: 'normal', messageIndex: 1 }, [user('a'), bot('something else')], 'reply').action, 'tray');
    assert.equal(planReplyApply({ kind: 'normal', messageIndex: 1 }, [user('a'), user('b')], 'reply').action, 'tray', 'index points at a user message');
    assert.equal(planReplyApply({ kind: 'normal', messageIndex: 5 }, [user('a')], 'reply').action, 'tray', 'index beyond the chat');
    assert.equal(planReplyApply({ kind: 'normal', messageIndex: 1 }, [user('a')], '   ').action, 'noop');
});

test('regenerate: old reply still there becomes a new swipe, never overwritten', () => {
    assert.deepEqual(planReplyApply({ kind: 'regenerate', messageIndex: 1 }, [user('a'), bot('old reply')], 'new reply'), { action: 'swipe-add', index: 1 });
    assert.deepEqual(planReplyApply({ kind: 'regenerate', messageIndex: 1 }, [user('a')], 'new reply'), { action: 'append', index: 1 });
    assert.equal(planReplyApply({ kind: 'regenerate', messageIndex: 1 }, [user('a'), bot('old'), user('later')], 'new').action, 'tray', 'not the last message any more');
});

test('swipe: fills the pending slot, replaces a partial, otherwise adds', () => {
    const m = bot('first', ['first']);
    assert.deepEqual(planReplyApply({ kind: 'swipe', messageIndex: 1, swipeId: 1 }, [user('a'), m], 'second'), { action: 'swipe-add', index: 1 });
    const partial = { is_user: false, mes: 'sec', swipes: ['first', 'sec'], swipe_id: 1 };
    assert.deepEqual(planReplyApply({ kind: 'swipe', messageIndex: 1, swipeId: 1 }, [user('a'), partial], 'second'), { action: 'swipe-replace', index: 1, swipeId: 1 });
    const present = { is_user: false, mes: 'second', swipes: ['first', 'second'], swipe_id: 1 };
    assert.equal(planReplyApply({ kind: 'swipe', messageIndex: 1, swipeId: 1 }, [user('a'), present], 'second').action, 'noop');
    assert.equal(planReplyApply({ kind: 'swipe', messageIndex: 0, swipeId: 1 }, [user('a'), m], 'x').action, 'tray', 'user message');
    assert.equal(planReplyApply({ kind: 'swipe', messageIndex: 1, swipeId: 1 }, [user('a'), m, user('b')], 'x').action, 'tray', 'not last');
});

test('other kinds go to the tray', () => {
    for (const kind of ['quiet', 'continue', 'impersonate', 'raw', 'des-tracker', undefined]) {
        assert.equal(planReplyApply({ kind, messageIndex: 1 }, [user('a')], 'x').action, 'tray', String(kind));
    }
});

test('chatKeyOf and resolveKind', () => {
    assert.equal(chatKeyOf({ groupId: 'g1', characterAvatar: 'a.png', chatId: 'c' }), null);
    assert.equal(chatKeyOf({ characterAvatar: 'a.png', chatId: 'c' }), 'c:a.png:c');
    assert.equal(chatKeyOf({ characterAvatar: 'a.png' }), null);
    const now = 1000000;
    assert.equal(resolveKind({ now }), 'raw');
    assert.equal(resolveKind({ started: { type: undefined, at: now - 10 }, now }), 'normal');
    assert.equal(resolveKind({ started: { type: 'swipe', at: now - 10 }, now }), 'swipe');
    assert.equal(resolveKind({ tagged: { kind: 'des-tracker', at: now - 10 }, now }), 'des-tracker');
    assert.equal(resolveKind({ started: { type: 'normal', at: now - 50 }, tagged: { kind: 'des-tracker', at: now - 10 }, now }), 'des-tracker', 'newer marker wins');
    assert.equal(resolveKind({ started: { type: 'normal', at: now - 10 }, tagged: { kind: 'des-tracker', at: now - 50 }, now }), 'normal');
    assert.equal(resolveKind({ started: { type: 'normal', at: now - 500000 }, now }), 'raw', 'stale marker ignored');
    assert.deepEqual(resolveMarker({ started: { type: 'normal', at: now - 50 }, tagged: { kind: 'des-internal', at: now - 10 }, now }), { kind: 'des-internal', from: 'tagged' });
    assert.deepEqual(resolveMarker({ started: { type: 'swipe', at: now - 10 }, now }), { kind: 'swipe', from: 'started' });
    assert.deepEqual(resolveMarker({ now }), { kind: 'raw', from: null });
});

console.log(process.exitCode ? `\n${passed} passed, some FAILED` : `\nALL ${passed} PASSED`);
