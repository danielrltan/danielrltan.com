import { useEffect, useState } from "react";
import { MQ } from "./motion";

/** Live media-query match (re-checks after mount, follows resize / rotation). Queries live in motion.ts MQ. */
export function useMedia(query: string) {
  const [match, setMatch] = useState(() =>
    typeof window === "undefined" || !window.matchMedia ? false : window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatch(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return match;
}

/** A real mouse or trackpad: custom cursors and hover-only effects mount only when this is true. */
export const useFinePointer = () => useMedia(MQ.finePointer);
