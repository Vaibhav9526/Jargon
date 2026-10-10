// Tapri scene renderer: draws a World onto a canvas. Kept apart from the React shell so the
// same code can be rendered headlessly (screenshots) and imported without React.
import { drawPerson } from './people';
import { drawMoodIcon } from './moodIcons';
import { drawSmallProps, drawVehicle } from './vehicles';
import { H, OWNER_CLIP_Y, W, type World } from './sim';

/** Sprite scale: patrons are drawn at 4 so faces and moods read; the chai-wala sits further
 *  back behind the counter, so he stays at 3 and fits under the stall sign. */
export const PX = 4;
export const OWNER_PX = 3;
/** Per-kind scale so an auto reads about as tall as a person while a bus does not swallow the road. */
export const VEHICLE_PX: Record<string, number> = { auto: 6, rickshaw: 6, taxi: 5, car: 5, bike: 6, scooter: 6, bus: 4 };
export const PROP_PX = 5;
/** Counter strip redrawn over the chai-wala so he stands behind the jars, not on them. */
export const OWNER_COVER = { x: 1040, y: 352, w: 170, h: 52 };
export const pxFor = (role: string): number => (role === 'owner' ? OWNER_PX : PX);
export const SIT_ROWS = 28;
export const STAND_ROWS = 38;

/* ── canvas drawing ───────────────────────────────────────────────────────── */

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width > maxW && cur) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = `${lines[maxLines - 1].replace(/\s*\S*$/, '')}…`; }
  return lines;
}

function drawBubble(ctx: CanvasRenderingContext2D, text: string, cx: number, headY: number): void {
  ctx.font = '600 15px "Segoe UI", system-ui, sans-serif';
  const lines = wrap(ctx, text, 250, 4);
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 20;
  const h = lines.length * 19 + 14;
  const x = Math.max(8, Math.min(W - w - 8, cx - w / 2));
  const y = Math.max(8, headY - h - 14);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.roundRect(x + 3, y + 4, w, h, 10); ctx.fill();
  ctx.fillStyle = '#fffbea';
  ctx.strokeStyle = '#3a2412';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 10); ctx.fill(); ctx.stroke();
  const tx = Math.max(x + 14, Math.min(x + w - 14, cx));
  ctx.beginPath(); ctx.moveTo(tx - 7, y + h - 1); ctx.lineTo(tx + 3, y + h + 11); ctx.lineTo(tx + 8, y + h - 1); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fffbea';
  ctx.fillRect(tx - 6, y + h - 3, 13, 4);
  ctx.fillStyle = '#2a190c';
  ctx.textAlign = 'left';
  lines.forEach((l, i) => ctx.fillText(l, x + 10, y + 22 + i * 19));
}

function drawNameTag(ctx: CanvasRenderingContext2D, name: string, cx: number, y: number): void {
  if (!name) return;
  ctx.font = '700 12px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  const w = ctx.measureText(name).width + 12;
  ctx.fillStyle = 'rgba(30,18,8,0.72)';
  ctx.beginPath(); ctx.roundRect(cx - w / 2, y, w, 17, 6); ctx.fill();
  ctx.fillStyle = '#ffe9b8';
  ctx.fillText(name, cx, y + 13);
  ctx.textAlign = 'left';
}

export function renderTapri(
  main: CanvasRenderingContext2D, buf: HTMLCanvasElement, bg: HTMLImageElement | null,
  world: World, cw: number, ch: number, dpr: number,
): void {
  const g = buf.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, W, H);
  if (bg) g.drawImage(bg, 0, 0, W, H);
  else { g.fillStyle = '#6b4a2a'; g.fillRect(0, 0, W, H); }

  type Item = { y: number; draw: () => void };
  const items: Item[] = [];
  const t = world.t;
  for (const p of world.people) {
    if (p.mode === 'hidden') continue;
    items.push({
      y: p.y, draw: () => {
        const opts = { pose: p.pose, facing: p.facing, t: t + (p.x * 7) % 900, mood: p.mood, talking: p.talking, chai: p.chai, px: pxFor(p.role) } as const;
        const x = Math.round(p.x); const y = Math.round(p.y);
        if (p.role === 'owner') {
          g.save(); g.beginPath(); g.rect(x - 60, 0, 120, OWNER_CLIP_Y); g.clip();
          drawPerson(g, p.style, x, y, opts); g.restore();
        } else drawPerson(g, p.style, x, y, opts);
      },
    });
  }
  for (const v of world.vehicles) {
    items.push({ y: v.y, draw: () => drawVehicle(g, v.kind, Math.round(v.x), Math.round(v.y), { facing: v.facing, t, px: VEHICLE_PX[v.kind] ?? 5, variant: v.variant }) });
  }
  for (const pr of world.props) {
    items.push({ y: pr.y, draw: () => drawSmallProps(g, pr.kind, Math.round(pr.x), Math.round(pr.y), t, pr.facing, PROP_PX) });
  }
  items.sort((a, b) => a.y - b.y);
  for (const it of items) it.draw();
  // The chai-wala works INSIDE the stall: put the counter jars back in front of him.
  if (bg) g.drawImage(bg, OWNER_COVER.x, OWNER_COVER.y, OWNER_COVER.w, OWNER_COVER.h, OWNER_COVER.x, OWNER_COVER.y, OWNER_COVER.w, OWNER_COVER.h);

  // Fit the 1600x900 frame to the window ("contain"), crisp when scaling up.
  main.setTransform(1, 0, 0, 1, 0, 0);
  main.fillStyle = '#1a1209';
  main.fillRect(0, 0, cw * dpr, ch * dpr);
  const s = Math.min(cw / W, ch / H) * dpr;
  const ox = (cw * dpr - W * s) / 2;
  const oy = (ch * dpr - H * s) / 2;
  // Letterbox bars show a soft blur of the scene instead of a flat colour.
  if (bg && (ox > 1 || oy > 1)) {
    main.filter = 'blur(18px)';
    const k = Math.max(cw * dpr / W, ch * dpr / H);
    main.drawImage(bg, (cw * dpr - W * k) / 2, (ch * dpr - H * k) / 2, W * k, H * k);
    main.filter = 'none';
    main.fillStyle = 'rgba(20,12,4,0.35)';
    main.fillRect(0, 0, cw * dpr, ch * dpr);
  }
  main.imageSmoothingEnabled = s < 1;
  main.drawImage(buf, ox, oy, W * s, H * s);

  // Text at native resolution: names and speech.
  main.setTransform(s, 0, 0, s, ox, oy);
  for (const p of world.people) {
    if (p.mode === 'hidden' || p.role === 'passer') continue;
    const name = p.name;
    if (!p.leaving) drawNameTag(main, name, Math.round(p.x), Math.round(p.y) + 4);
  }
  for (const p of world.people) {
    if (p.mode === 'hidden' || p.role === 'passer' || p.say || p.leaving) continue;
    drawMoodIcon(main, p.mood, Math.round(p.x), p.y - (p.pose === 'sit' ? SIT_ROWS : STAND_ROWS) * pxFor(p.role), t, 5);
  }
  for (const p of world.people) {
    if (!p.say) continue;
    const top = p.y - (p.pose === 'sit' ? SIT_ROWS : STAND_ROWS) * pxFor(p.role);
    drawBubble(main, p.say.text, p.x, top);
  }
}

