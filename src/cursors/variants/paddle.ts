import { CHAR, ORANGE, WHITE, clamp, damp, hotspot, layerCanvas, spring, type CursorInfo } from "../kit";

/**
 * 12 · Poddle paddle. The pointer is a pickleball paddle (the hotspot is the
 * sweet spot) keeping a pixel ball up under real gravity. Hits are proper
 * collisions with the paddle's moving, tilted face: the paddle's velocity
 * transfers into the ball, tilt (from your sideways speed) deflects it, so
 * lifting the mouse volleys it and a flick smashes it. A rally counter ticks
 * per hit; drop it and a new ball serves in from above. Press swings for a
 * smash; over a button the ball parks on the paddle; idle, it settles there.
 * The hotspot is the middle of the face's top edge.
 */
const FACE_W = 26, FACE_H = 30, BALL_R = 4;
const G = 1700;

export const paddle: CursorInfo = {
  id: 12,
  name: "Poddle paddle",
  family: "physics",
  blurb:
    "A pickleball paddle keeping a pixel ball up under real gravity: your paddle's speed and tilt go into every hit, flicks smash, a rally counter ticks, dropped balls re-serve, and over a button the ball parks on the paddle.",
  create(env, reduced) {
    const cv = layerCanvas(env.layer);
    const ball = { x: 0, y: 0, vx: 0, vy: 0, spin: 0 };
    let init = false;
    let resting = false;
    let rally = 0;
    let best = 0;
    let serveIn = 0; // seconds until a new serve
    const swing = { x: 0, v: 0 };
    let tilt = 0;
    let flash = 0;
    let prevLocal = 99;

    const serve = (s: { x: number; y: number }) => {
      ball.x = s.x;
      ball.y = s.y - 90;
      ball.vx = 0;
      ball.vy = 0;
      resting = false;
      prevLocal = 99;
    };

    return {
      frame(s) {
        const { ctx } = cv;
        cv.clear();
        const dt = Math.min(s.dt, 1 / 50);
        if (!init) {
          init = true;
          ball.x = s.x;
          ball.y = s.y - FACE_H / 2 - BALL_R;
          resting = true;
        }
        tilt = damp(tilt, clamp(s.vx / 1400, -0.6, 0.6), 14, dt);
        let busy = spring(swing, s.down ? -0.9 : 0, dt, s.down ? 900 : 260, 0.5);
        const ang = tilt + swing.x;
        // Paddle face: a segment across the top of the paddle head, normal n.
        const nx = Math.sin(ang), ny = -Math.cos(ang);
        const tx = Math.cos(ang), ty = Math.sin(ang);
        // The hotspot is the top edge of the face (so the paddle hangs below the
        // point and never covers what you're aiming at).
        const fx = s.x, fy = s.y;
        const hx = s.x - nx * (FACE_H / 2), hy = s.y - ny * (FACE_H / 2);
        const pvx = s.vx + (s.down ? -swing.v * 30 * -ny : 0), pvy = s.vy + (s.down ? swing.v * 30 * nx : 0);
        const park = s.hover.kind === "click" || reduced;

        if (serveIn > 0) {
          serveIn -= dt;
          if (serveIn <= 0) serve(s);
          busy = true;
        } else if (resting || park) {
          ball.x = fx + nx * BALL_R;
          ball.y = fy + ny * BALL_R;
          ball.vx = s.vx;
          ball.vy = s.vy;
          // a flick upward (or a press) launches a resting ball
          if (!park && (s.pressed || -(s.vx * nx + s.vy * ny) < -500 || s.vx * nx + s.vy * ny > 520)) {
            resting = false;
            ball.vx = s.vx + nx * 420;
            ball.vy = s.vy + ny * 520;
          }
          if (park) resting = true;
        } else {
          ball.vy += G * dt;
          ball.x += ball.vx * dt;
          ball.y += ball.vy * dt;
          ball.spin += ball.vx * dt * 0.05;
          busy = true;
          // collision in the paddle's frame
          const lx = (ball.x - fx) * tx + (ball.y - fy) * ty;
          const ly = (ball.x - fx) * nx + (ball.y - fy) * ny; // >0 above the face
          const relx = ball.vx - pvx, rely = ball.vy - pvy;
          const vn = relx * nx + rely * ny;
          if (Math.abs(lx) < FACE_W / 2 + BALL_R && ly < BALL_R && prevLocal >= -BALL_R * 2 && vn < 0) {
            const e = s.down ? 1.25 : 0.72;
            ball.vx -= (1 + e) * vn * nx;
            ball.vy -= (1 + e) * vn * ny;
            ball.x = fx + tx * lx + nx * BALL_R;
            ball.y = fy + ty * lx + ny * BALL_R;
            if (Math.abs(vn) > 140) {
              rally++;
              best = Math.max(best, rally);
              flash = 1;
            } else {
              // dead bounce: let it sit on the paddle
              resting = true;
            }
          }
          prevLocal = ly;
          // cap speed, keep it on the layer's sides
          const sp = Math.hypot(ball.vx, ball.vy);
          if (sp > 2600) { ball.vx *= 2600 / sp; ball.vy *= 2600 / sp; }
          if (ball.x < BALL_R) { ball.x = BALL_R; ball.vx = Math.abs(ball.vx) * 0.7; }
          if (ball.x > s.w - BALL_R) { ball.x = s.w - BALL_R; ball.vx = -Math.abs(ball.vx) * 0.7; }
          if (ball.y < BALL_R && ball.vy < 0) { ball.y = BALL_R; ball.vy = Math.abs(ball.vy) * 0.6; }
          // dropped: below the paddle and falling away
          if (ball.y > s.y + 140 || ball.y > s.h + 20) {
            rally = 0;
            serveIn = 0.45;
          }
        }
        flash = Math.max(0, flash - dt * 4);

        // Shadow of the ball on the page, under it.
        if (!resting && serveIn <= 0) {
          ctx.fillStyle = "rgba(27,27,31,0.16)";
          const sh = clamp(1 - (s.y - ball.y) / 300, 0.3, 1);
          ctx.fillRect(Math.round(ball.x - 4 * sh), Math.round(s.y + FACE_H + 18), Math.round(8 * sh), 2);
        }

        // Paddle: rounded head + handle, rotated; charcoal with a white edge
        // guard so it reads on white and orange alike.
        ctx.save();
        ctx.translate(hx, hy);
        ctx.rotate(ang);
        ctx.fillStyle = WHITE;
        ctx.beginPath();
        ctx.roundRect(-FACE_W / 2 - 1.5, -FACE_H / 2 - 1.5, FACE_W + 3, FACE_H + 3, 9);
        ctx.fill();
        ctx.fillRect(-3.5, FACE_H / 2 - 1, 7, 14);
        ctx.fillStyle = CHAR;
        ctx.beginPath();
        ctx.roundRect(-FACE_W / 2, -FACE_H / 2, FACE_W, FACE_H, 8);
        ctx.fill();
        ctx.fillRect(-2.5, FACE_H / 2 - 1, 5, 13);
        // face graphic: orange stripe + "P"
        ctx.fillStyle = ORANGE;
        ctx.fillRect(-FACE_W / 2 + 3, -3, FACE_W - 6, 6);
        ctx.restore();

        // Ball: pickleball yellow with holes, flashes white on a hit.
        if (serveIn <= 0) {
          ctx.save();
          ctx.translate(ball.x, ball.y);
          ctx.rotate(ball.spin);
          ctx.fillStyle = CHAR;
          ctx.beginPath();
          ctx.arc(0, 0, BALL_R + 1.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = flash > 0.5 ? WHITE : "#ffe14d";
          ctx.beginPath();
          ctx.arc(0, 0, BALL_R, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#c2a000";
          ctx.fillRect(-2, -2, 1.3, 1.3);
          ctx.fillRect(1, -1, 1.3, 1.3);
          ctx.fillRect(-1, 1.5, 1.3, 1.3);
          ctx.restore();
        }

        // Rally counter.
        if (rally > 0 || best > 0) {
          ctx.font = "16px VT323, monospace";
          ctx.textBaseline = "middle";
          const txt = rally > 0 ? `${rally}` : `best ${best}`;
          const w = Math.ceil(ctx.measureText(txt).width) + 8;
          const bx = Math.round(hx + FACE_W / 2 + 8), by = Math.round(hy + 4);
          ctx.fillStyle = flash > 0 ? ORANGE : CHAR;
          ctx.fillRect(bx, by - 8, w, 16);
          ctx.fillStyle = WHITE;
          ctx.fillText(txt, bx + 4, by + 0.5);
        }
        hotspot(ctx, s.x, s.y, 4);
        return busy || flash > 0;
      },
      destroy() {
        cv.destroy();
      },
    };
  },
};
