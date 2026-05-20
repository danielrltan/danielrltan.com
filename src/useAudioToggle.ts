import { useEffect, useState } from "react";
import { startAmbience, stopAmbience } from "./audio";

/**
 * Shared audio on/off state. Module-level so the StatusBar icon and
 * the RoomHUD pill stay in sync — they're two views on the same
 * setting, not independent toggles.
 */
let audioOn = false;
const listeners = new Set<(on: boolean) => void>();

function setAudio(next: boolean) {
  audioOn = next;
  if (next) startAmbience(0.22);
  else stopAmbience();
  listeners.forEach((l) => l(next));
}

export function useAudioToggle() {
  const [on, setOn] = useState(audioOn);
  useEffect(() => {
    listeners.add(setOn);
    return () => {
      listeners.delete(setOn);
    };
  }, []);
  return {
    on,
    toggle: () => setAudio(!audioOn),
  };
}
