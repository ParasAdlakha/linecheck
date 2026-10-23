// What the caller sees on FaceTime: an inspection reticle whose colour shows what LineCheck is doing.
// Plain JavaScript, one RGBA frame per call, no dependencies.
export const WIDTH = 640;
export const HEIGHT = 360;
export const FPS = 12;

export const STATE_COLORS = {
  listening: [120, 170, 220], // steel blue
  speaking: [235, 240, 245],  // white
  looking: [255, 176, 60],    // amber: capturing and analysing a frame
  searching: [150, 210, 160], // green: manuals, ADs, SDRs
  finding: [230, 80, 60],     // red: a finding worth attention was logged
};

const BG = [14, 20, 28], GRID = [28, 38, 50];

export function drawScope(tick, state = 'listening', level = 0) {
  const px = new Uint8Array(WIDTH * HEIGHT * 4);
  const ink = STATE_COLORS[state] || STATE_COLORS.listening;
  const cx = WIDTH / 2, cy = HEIGHT / 2;
  const pulse = state === 'speaking' ? 8 * level : 3 * Math.sin(tick * 0.25);
  const r1 = 110 + pulse, r2 = 70;
  const sweep = (tick * 0.12) % (Math.PI * 2);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      let c = (x % 40 === 0 || y % 40 === 0) ? GRID : BG;
      const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
      if (Math.abs(d - r1) < 2 || Math.abs(d - r2) < 1.2) c = ink;
      if ((Math.abs(dx) < 1.2 && d > 20 && d < r1 + 30) || (Math.abs(dy) < 1.2 && d > 20 && d < r1 + 30)) c = ink;
      if (state === 'looking' || state === 'searching') {
        let a = Math.atan2(dy, dx) - sweep;
        a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        if (d < r1 && a < 0.5) c = c.map((v, i) => Math.round(v + (ink[i] - v) * (1 - a / 0.5) * 0.35));
      }
      // corner brackets, like a viewfinder
      const bx = Math.min(x, WIDTH - 1 - x), by = Math.min(y, HEIGHT - 1 - y);
      if ((bx < 46 && by > 14 && by < 18) || (by < 46 && bx > 14 && bx < 18)) c = ink;
      const i = (y * WIDTH + x) * 4;
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
    }
  }
  return px;
}
