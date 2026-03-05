#!/usr/bin/env node

const assert = require('assert');
const {
    parseSessionTurns,
    selectRelevantTurns,
    buildPrefetchBlock,
} = require('../dist/lib/openviking-prefetch.js');

const fixture = `# TinyClaw Session (@assistant)

- started_at: 2026-02-21T06:24:44.461Z
------

## Turn 2026-02-21T06:24:44.461Z

- message_id: diag5_1771655068
- source: external

### User

please remember: user_name=cheng; favorite=db

------

[OpenViking Retrieved Context]

- turn: 2026-02-21T06:20:46.699Z | message_id: diag3_1771654833
  user: please remember: user_name=cheng; favorite=db
  assistant: Got it! I've remembered user_name=cheng; favorite=db
[End OpenViking Context]

### Assistant

I see from the retrieved context that I've already stored this information.
------

## Turn 2026-02-21T06:25:23.382Z

- message_id: diag6_1771655118
- source: external

### User

user_name=cheng; favorite=?

------

[OpenViking Retrieved Context]

- turn: 2026-02-21T06:24:44.461Z | message_id: diag5_1771655068
  user: please remember: user_name=cheng; favorite=db
  assistant: I see from the retrieved context that I've already stored this information.
[End OpenViking Context]

### Assistant

Based on what I remember:
user_name=cheng; favorite=db
`;

const turns = parseSessionTurns(fixture);
assert.strictEqual(turns.length, 2, `expected 2 turns, got ${turns.length}`);
assert.match(turns[0].user, /please remember: user_name=cheng; favorite=db/);
assert.doesNotMatch(turns[0].user, /\[OpenViking Retrieved Context\]/);
assert.match(turns[1].user, /favorite=\?/);

const selected = selectRelevantTurns(turns, 'user_name=cheng; favorite=?', 3);
assert.ok(selected.length >= 1, 'expected at least one selected turn');
const block = buildPrefetchBlock(selected, 2800);
assert.match(block, /\[OpenViking Retrieved Context\]/);
assert.match(block, /favorite=db/);

console.log('ok - openviking prefetch parser regression test passed');
