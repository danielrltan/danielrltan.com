import "./variants.css";
import { blueprint } from "./blueprint";
import { extrude } from "./extrude";
import { odometer } from "./odometer";
import { planet } from "./planet";
import type { VariantInfo } from "./shared";
import { voxels } from "./voxels";
import { warp } from "./warp";

export type { LoaderVariant, VariantInfo } from "./shared";

export const VARIANTS: VariantInfo[] = [odometer, voxels, warp, extrude, blueprint, planet];

