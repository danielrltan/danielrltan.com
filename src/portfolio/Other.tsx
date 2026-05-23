import { useEffect, useRef, useState } from "react";
import "./sections.css";
import "./other.css";
import { HobbiesScene } from "../other/HobbiesScene";
import { OtherPhotoTrains } from "../other/OtherPhotoTrains";

/**
 * "Off the clock" / hobbies section. Two interlocked layers in one
 * 100vh band:
 *
 *   Upper half: HTML "photo trains" — 3 horizontal rows of
 *               hobby-related images that slide opposite directions
 *               as the user scrolls.
 *   Lower half: 3D cluster of 10 floating hobby objects, no desk
 *               surface. Hover an object → tooltip with the label.
 *
 * Previously this section was for "accomplishments" / extras —
 * those moved to BitsAndPieces.tsx so this section can BE the hobby
 * showcase as requested.
 */

/**
 * Per-row photo set for the train layer above the desk. Each item is
 * a label that doubles as a placeholder caption until real hobby
 * photos are dropped in /public/images/hobbies/. The trains visually
 * shuffle through these as the user scrolls.
 */
const TRAIN_PHOTOS: { color: string; label: string }[] = [
  { color: "#1a1714", label: "Taekwondo" },
  { color: "#3a2418", label: "Piano" },
  { color: "#5a3a1f", label: "Keys" },
  { color: "#7a4f30", label: "Cars" },
  { color: "#a8c4d0", label: "Skiing" },
  { color: "#e87040", label: "Design" },
  { color: "#262120", label: "Travel" },
  { color: "#c08c6c", label: "Crocheting" },
  { color: "#4a2e1a", label: "Fashion" },
  { color: "#d4a574", label: "Coffee" },
  { color: "#ff5400", label: "Photography" },
  { color: "#9c7c5e", label: "Books" },
];

export function Other() {
  const sectionRef = useRef<HTMLElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || mounted) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setMounted(true);
            io.disconnect();
            return;
          }
        }
      },
      { rootMargin: "75% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [mounted]);

  return (
    <section ref={sectionRef} className="portfolio-section portfolio-other">
      <div className="other-trains-layer">
        <OtherPhotoTrains photos={TRAIN_PHOTOS} sectionRef={sectionRef} />
      </div>
      <div className="other-desk-layer">
        {mounted && <HobbiesScene />}
      </div>
      <div className="portfolio-col other-col">
        <span className="section-marker">04</span>
        <span className="section-index">04 / 06 &middot; Off the clock</span>
        <h2>Things I love.</h2>
        <p className="other-blurb">
          Hover an object to see what it is. The photos above are
          flashes from the time I&apos;m not at the keyboard.
        </p>
      </div>
    </section>
  );
}
