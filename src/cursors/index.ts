import { gimbal } from "./variants/gimbal";
import { dart } from "./variants/dart";
import { die } from "./variants/die";
import { voxelArrow } from "./variants/voxelArrow";
import { jelly } from "./variants/jelly";
import { compass } from "./variants/compass";
import { pinwheel } from "./variants/pinwheel";
import { orbit } from "./variants/orbit";
import { rope } from "./variants/rope";
import { cloth } from "./variants/cloth";
import { hourglass } from "./variants/hourglass";
import { paddle } from "./variants/paddle";
import { flock } from "./variants/flock";
import { ink } from "./variants/ink";
import { fire } from "./variants/fire";
import { snake } from "./variants/snake";
import { pen } from "./variants/pen";
import { scope } from "./variants/scope";
import { eyes } from "./variants/eyes";
import { xray } from "./variants/xray";
import { filings } from "./variants/filings";
import { gravity } from "./variants/gravity";
import { shadows } from "./variants/shadows";
import { rulers } from "./variants/rulers";
import type { CursorInfo } from "./kit";

export { mountCursor, type CursorInfo } from "./kit";

/** The cursor lab's 24 designs, in lab order (ids 1..24). */
export const CURSORS: CursorInfo[] = [
  gimbal, dart, die, voxelArrow, jelly, compass, pinwheel, orbit, rope, cloth, hourglass, paddle, flock, ink, fire, snake, pen, scope, eyes, xray, filings, gravity, shadows, rulers,
];
