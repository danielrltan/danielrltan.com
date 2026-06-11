// Types for the vendored ./AsciiEffect.js. Mirrors
// @types/three/examples/jsm/effects/AsciiEffect.d.ts so the local copy is a
// drop-in for the upstream import.
import { Camera, Scene, WebGLRenderer } from "three";

export interface AsciiEffectOptions {
    resolution?: number;
    scale?: number;
    color?: boolean;
    alpha?: boolean;
    block?: boolean;
    invert?: boolean;
    strResolution?: string;
}

export class AsciiEffect {
    constructor(renderer: WebGLRenderer, charSet?: string, options?: AsciiEffectOptions);
    domElement: HTMLElement;

    render(scene: Scene, camera: Camera): void;
    setSize(width: number, height: number): void;
}
