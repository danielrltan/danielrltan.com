/**
 * `?tune=<scene>` dev switch. When the URL names a scene ("mac", "keypad") that
 * scene skips its scroll pin, frees its camera (OrbitControls) and shows a
 * tuning HUD so a new framing can be dialled in and copied back into code.
 */
export function isTuneMode(scene: string): boolean {
  return (
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("tune") === scene
  );
}
