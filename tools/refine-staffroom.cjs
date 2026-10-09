'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const file = path.join(root, 'src/renderer/src/assets/maps/staffroom.tmj');
const map = JSON.parse(fs.readFileSync(file, 'utf8'));
const layer = (name) => map.layers.find((l) => l.name === name);
const spawns = layer('spawn-points').objects;
const furniture = ['furniture-below', 'furniture-above', 'collision'].map(layer);
const targets = process.argv.includes('--restore')
  ? [[4, 13], [10, 13], [16, 13], [22, 13], [28, 13]]
  : [[11, 9], [17, 9], [23, 9], [14, 13], [20, 13]];
const stamps = targets.map((_, i) => {
  const seat = spawns.find((s) => s.name === `pc-${i + 1}`);
  const x = Math.floor(seat.x / 16);
  const y = Math.floor(seat.y / 16);
  const cells = [];
  for (const l of furniture) {
    for (let dy = -2; dy <= 0; dy++) {
      for (let dx = 0; dx <= 2; dx++) {
        const index = (y + dy) * map.width + x + dx;
        cells.push({ l, dx, dy, gid: l.data[index] });
        l.data[index] = 0;
      }
    }
  }
  return { seat, cells };
});
stamps.forEach(({ seat, cells }, i) => {
  const [x, y] = targets[i];
  for (const { l, dx, dy, gid } of cells) l.data[(y + dy) * map.width + x + dx] = gid;
  seat.x = x * 16 + 8;
  seat.y = y * 16 + 8;
});
const atlas = JSON.parse(fs.readFileSync(path.join(__dirname, 'gen/staffroom-assets/school-atlas.json'), 'utf8'));
const floor = layer('floor').data;
const fillFloor = (name, x, y, w, h) => {
  const gid = 2449 + atlas.props[name].gid;
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) floor[(y + dy) * map.width + x + dx] = gid;
  }
};
fillFloor('floor-study', 10, 6, 17, 9);
fillFloor('floor-lounge', 1, 15, 7, 5);
fillFloor('floor-office', 2, 5, 6, 5);
fillFloor('floor-office', 28, 16, 6, 6);
for (const [name, x, y] of [
  ['sign-study', 16, 5], ['sign-meeting', 2, 4],
  ['sign-lounge', 2, 14], ['sign-principal', 29, 15]
]) {
  const prop = atlas.props[name];
  for (let dx = 0; dx < prop.w; dx++) {
    layer('furniture-above').data[y * map.width + x + dx] = 2449 + prop.gid + dx;
  }
}
map.tilesets = map.tilesets.filter((t) => t.firstgid !== 2449);
map.tilesets.push({
  firstgid: 2449, columns: atlas.columns, image: '../tilesets/school-props.png',
  imageheight: 160, imagewidth: 256, margin: 0, name: 'school-props', spacing: 0,
  tilecount: atlas.tilecount, tileheight: 16, tilewidth: 16
});
const collision = layer('collision').data;
const entrance = spawns.find((s) => s.name === 'entrance');
const start = Math.floor(entrance.y / 16) * map.width + Math.floor(entrance.x / 16);
const reached = new Set([start]);
const queue = [start];
for (const index of queue) {
  const x = index % map.width;
  const y = Math.floor(index / map.width);
  for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
    const next = ny * map.width + nx;
    if (nx < 0 || nx >= map.width || ny < 0 || ny >= map.height || collision[next] || reached.has(next)) continue;
    reached.add(next);
    queue.push(next);
  }
}
for (const spawn of spawns) {
  const index = Math.floor(spawn.y / 16) * map.width + Math.floor(spawn.x / 16);
  if (!reached.has(index)) throw new Error(`Unreachable spawn: ${spawn.name}`);
}
fs.writeFileSync(file, JSON.stringify(map));
console.log('Refined student desk clusters; all spawn points reachable from entrance.');
