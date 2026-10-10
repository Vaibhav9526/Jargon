'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { VEHICLE_KINDS } = loadTs('src/renderer/src/tapri/types.ts');
const { drawVehicle, vehicleSize, drawSmallProps } = loadTs('src/renderer/src/tapri/vehicles.ts');

const PROPS = ['crow', 'dog', 'cow', 'pigeon'];
const TOLERANCE_PX = 9; // a few sprite units: exhaust puffs and the road shadow

// A stub context that records every rect the drawing code asks for.
function stub() {
  const rects = [];
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    textAlign: 'left',
    fillRect(x, y, w, h) { rects.push({ x, y, w, h, fill: this.fillStyle }); },
    strokeRect() {},
    fillText() {},
    save() {},
    restore() {},
    translate() {},
    scale() {},
  };
  return { ctx, rects };
}

function extents(rects) {
  const minX = Math.min(...rects.map((r) => r.x));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
}

test('every vehicle kind draws in both facings without throwing', () => {
  for (const kind of VEHICLE_KINDS) {
    for (const facing of [1, -1]) {
      const { ctx, rects } = stub();
      assert.doesNotThrow(() => drawVehicle(ctx, kind, 400, 300, { facing, t: 0 }), kind);
      assert.ok(rects.length > 0, `${kind} drew nothing`);
    }
  }
});

test('every vehicle kind accepts a variant and a custom px', () => {
  for (const kind of VEHICLE_KINDS) {
    for (let variant = 0; variant < 4; variant++) {
      const { ctx, rects } = stub();
      drawVehicle(ctx, kind, 0, 0, { facing: 1, t: 123, variant, px: 2 });
      assert.ok(rects.length > 0, `${kind} variant ${variant}`);
    }
  }
});

test('vehicleSize matches the drawn extents within a few px', () => {
  for (const kind of VEHICLE_KINDS) {
    const px = 3;
    const x = 400;
    const y = 300;
    const { ctx, rects } = stub();
    drawVehicle(ctx, kind, x, y, { facing: 1, t: 0, px });
    const size = vehicleSize(kind, px);
    const e = extents(rects);
    assert.ok(Math.abs(e.w - size.w) <= TOLERANCE_PX, `${kind} width ${e.w} vs ${size.w}`);
    assert.ok(Math.abs(e.h - size.h) <= TOLERANCE_PX, `${kind} height ${e.h} vs ${size.h}`);
    // Tyres touch the road: nothing sits more than the 1px shadow below the ground point.
    assert.ok(e.maxY <= y + px, `${kind} drops below the road (${e.maxY} > ${y + px})`);
    // Centred on x: the bottom-centre is the anchor.
    assert.ok(Math.abs((e.minX + e.maxX) / 2 - x) <= TOLERANCE_PX / 2, `${kind} is off-centre`);
  }
});

test('mirroring keeps the footprint and flips it about the anchor', () => {
  for (const kind of VEHICLE_KINDS) {
    const right = stub();
    const left = stub();
    drawVehicle(right.ctx, kind, 400, 300, { facing: 1, t: 60 });
    drawVehicle(left.ctx, kind, 400, 300, { facing: -1, t: 60 });
    const r = extents(right.rects);
    const l = extents(left.rects);
    assert.equal(r.w, l.w, `${kind} width changes when mirrored`);
    assert.ok(Math.abs(r.minX + l.maxX - 800) <= 1, `${kind} mirror axis is off`);
  }
});

test('vehicles are scene-sized: car ~230px wide at px 5, bus ~330px at px 4', () => {
  const car = vehicleSize('car', 5).w;
  const bus = vehicleSize('bus', 4).w;
  assert.ok(car >= 210 && car <= 250, `car ${car}px`);
  assert.ok(bus >= 310 && bus <= 350, `bus ${bus}px`);
});

test('vehicle frames animate: different t gives different pixels', () => {
  for (const kind of VEHICLE_KINDS) {
    const frames = new Set();
    for (const t of [0, 37, 150, 450, 1000]) {
      const { ctx, rects } = stub();
      drawVehicle(ctx, kind, 400, 300, { facing: 1, t });
      frames.add(JSON.stringify(rects));
    }
    assert.ok(frames.size > 1, `${kind} never changes between frames`);
  }
});

test('every small prop draws, does not throw, and animates', () => {
  for (const prop of PROPS) {
    for (const facing of [1, -1]) {
      const { ctx, rects } = stub();
      assert.doesNotThrow(() => drawSmallProps(ctx, prop, 200, 300, 0, facing), prop);
      assert.ok(rects.length > 0, `${prop} drew nothing`);
    }
    const frames = new Set();
    for (const t of [0, 37, 150, 250, 450, 1000]) {
      const { ctx, rects } = stub();
      drawSmallProps(ctx, prop, 200, 300, t, 1);
      frames.add(JSON.stringify(rects));
    }
    assert.ok(frames.size > 1, `${prop} never changes between frames`);
  }
});

test('small props stay on the road and are small', () => {
  for (const prop of PROPS) {
    const { ctx, rects } = stub();
    drawSmallProps(ctx, prop, 200, 300, 0, 1);
    const e = extents(rects);
    assert.ok(e.maxY <= 300 + 3, `${prop} sinks below the ground`);
    assert.ok(e.h <= 20 * 3, `${prop} is ${e.h}px tall`);
  }
});

test('the default px is 3', () => {
  assert.deepEqual(vehicleSize('auto'), { w: 26 * 3, h: 18 * 3 });
});
