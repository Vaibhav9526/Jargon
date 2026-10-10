'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { OUTFITS, MOODS } = loadTs('src/renderer/src/tapri/types.ts');
const { drawPerson, drawMoodBubble, personSize } = loadTs('src/renderer/src/tapri/people.ts');

const POSES = ['stand', 'walk', 'sit'];
const TIMES = [0, 1234];

// A ctx stub that only records fillRect calls. Everything people.ts uses is a
// fillRect or a fillStyle assignment, so this is the whole surface under test.
function stubCtx() {
  const rects = [];
  const ctx = {
    fillStyle: '#000000',
    fillRect(x, y, w, h) {
      rects.push({ x, y, w, h, fill: ctx.fillStyle });
    }
  };
  return { ctx, rects };
}

function draw({ outfit = 'me', variant = 0, pose = 'stand', mood = 'neutral', facing = 1, t = 0, x = 100, y = 200, px = 3, talking, chai } = {}) {
  const { ctx, rects } = stubCtx();
  drawPerson(ctx, { outfit, variant }, x, y, { pose, facing, t, mood, px, talking, chai });
  return rects;
}

const key = (r) => `${r.x},${r.y},${r.w},${r.h},${r.fill}`;

test('every outfit x mood x pose draws something and never throws', () => {
  for (const outfit of OUTFITS) {
    for (const mood of MOODS) {
      for (const pose of POSES) {
        for (const t of TIMES) {
          for (const variant of [0, 1, 2]) {
            const rects = draw({ outfit, mood, pose, t, variant, talking: true, chai: true });
            assert.ok(rects.length > 0, `${outfit}/${mood}/${pose}/t=${t}/v=${variant} drew nothing`);
          }
        }
      }
    }
  }
});

test('furious draws a different picture than neutral', () => {
  const neutral = draw({ mood: 'neutral' }).map(key).sort();
  const furious = draw({ mood: 'furious' }).map(key).sort();
  assert.notDeepEqual(furious, neutral);
});

test('every mood changes the picture compared with neutral', () => {
  const neutral = JSON.stringify(draw({ mood: 'neutral' }).map(key).sort());
  for (const mood of MOODS.filter((m) => m !== 'neutral')) {
    assert.notEqual(JSON.stringify(draw({ mood }).map(key).sort()), neutral, mood);
  }
});

test('facing -1 is the exact horizontal mirror of facing 1 around x', () => {
  const x = 100;
  for (const outfit of OUTFITS) {
    for (const mood of MOODS) {
      for (const pose of POSES) {
        const right = draw({ outfit, mood, pose, facing: 1, x }).map((r) => ({
          ...r, x: 2 * x - r.x - r.w, fill: r.fill
        })).map(key).sort();
        const left = draw({ outfit, mood, pose, facing: -1, x }).map(key).sort();
        assert.deepEqual(left, right, `${outfit}/${mood}/${pose}`);
      }
    }
  }
});

test('the body stays within half a standing width of the centre line', () => {
  const px = 3;
  const half = personSize(px).w / 2;
  const x = 100;
  for (const outfit of OUTFITS) {
    for (const mood of MOODS) {
      for (const pose of POSES) {
        for (const facing of [1, -1]) {
          for (const r of draw({ outfit, mood, pose, facing, x, px, t: 77, chai: true })) {
            // Steam sits above the head and is not part of the body width.
            if (mood === 'furious' && r.fill === '#eeeeee') continue;
            assert.ok(r.x >= x - half && r.x + r.w <= x + half,
              `${outfit}/${mood}/${pose}/facing ${facing}: ${JSON.stringify(r)} outside ±${half}`);
          }
        }
      }
    }
  }
});

test('feet land on the anchor: standing bottoms at y, seated at y', () => {
  const y = 200;
  for (const outfit of OUTFITS) {
    for (const pose of POSES) {
      const rects = draw({ outfit, pose, y, t: 5 });
      const bottom = Math.max(...rects.map((r) => r.y + r.h));
      assert.equal(bottom, y, `${outfit}/${pose} bottom edge`);
    }
  }
});

test('a seated person is 28 sprite px tall, a standing one 38', () => {
  const top = (rects) => Math.min(...rects.map((r) => r.y));
  // Neutral mood with t=0 does not breathe or nod, so the head sits on the frame top.
  assert.equal(top(draw({ pose: 'sit', y: 200, t: 0 })), 200 - 28 * 3);
  assert.equal(top(draw({ pose: 'stand', y: 200, t: 0 })), 200 - 38 * 3);
});

test('a walk cycle changes the legs between frames', () => {
  const a = draw({ pose: 'walk', t: 0 }).map(key).sort();
  const b = draw({ pose: 'walk', t: 300 }).map(key).sort();
  assert.notDeepEqual(a, b);
});

test('personSize defaults to 3px per sprite pixel and scales with px', () => {
  assert.deepEqual(personSize(), { w: 54, h: 114 });
  assert.deepEqual(personSize(4), { w: 72, h: 152 });
});

test('neutral has no bubble, every other mood has one', () => {
  const bubble = (mood) => {
    const { ctx, rects } = stubCtx();
    drawMoodBubble(ctx, mood, 100, 100, 0);
    return rects;
  };
  assert.equal(bubble('neutral').length, 0);
  for (const mood of MOODS.filter((m) => m !== 'neutral')) {
    assert.ok(bubble(mood).length > 0, mood);
  }
});

test('the mood bubble bobs with t and never throws for any t', () => {
  const at = (t) => {
    const { ctx, rects } = stubCtx();
    drawMoodBubble(ctx, 'wow', 100, 100, t);
    return rects.map(key).sort();
  };
  const seen = new Set();
  for (let t = 0; t < 2000; t += 130) seen.add(JSON.stringify(at(t)));
  assert.ok(seen.size > 1, 'the bubble moves');
});
