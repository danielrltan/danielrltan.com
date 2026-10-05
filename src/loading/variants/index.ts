import "./variants.css";
import { blueprint } from "./blueprint";
import { cube } from "./cube";
import { gimbal } from "./gimbal";
import { pinscreen } from "./pinscreen";
import { plane } from "./plane";
import { skyline } from "./skyline";
import { windsock } from "./windsock";
import { extrude } from "./extrude";
import { odometer } from "./odometer";
import { planet } from "./planet";
import type { VariantInfo } from "./shared";
import { voxels } from "./voxels";
import { warp } from "./warp";

export type { LoaderVariant, VariantInfo } from "./shared";

export const VARIANTS: VariantInfo[] = [
  odometer, voxels, warp, extrude, blueprint, planet,
  pinscreen, skyline, windsock, gimbal, plane, cube,
];

