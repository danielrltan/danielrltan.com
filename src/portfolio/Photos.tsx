import { useEffect, useRef, useState } from "react";
import "./sections.css";
import "./photos.css";
import { PhotosCarousel } from "../photos/PhotosCarousel";

/**
 * Photos section — a slow 3D carousel of photos hanging on a
 * vertical axis. The carousel rotates as the user scrolls through
 * the section. Replaces the old "Play" hobby grid.
 *
 * Section is 100vh tall. The carousel canvas takes the left half
 * on desktop; the section's right-column content (section marker,
 * heading, one-line intro) shares the layout with the rest of the
 * sections to keep visual rhythm with About/Skills/Work.
 */

const PHOTOS: PhotoItem[] = [
  { title: "Taekwondo", meta: "Black Belt 2nd Dan", color: "#ff7842" },
  { title: "Piano", meta: "12+ years · RCM 9", color: "#7a4f30" },
  { title: "Mechanical Keyboards", meta: "& speed typing", color: "#3a2418" },
  { title: "Skiing", color: "#a8c4d0" },
  { title: "Cars & Driving", color: "#5a3a1f" },
  { title: "Travel", color: "#d4a574" },
  { title: "Fashion", color: "#262120" },
  { title: "Crocheting", color: "#c08c6c" },
];

export interface PhotoItem {
  title: string;
  meta?: string;
  /** Hex color used for the placeholder gradient; swap for real image URL once available. */
  color: string;
  /** Optional image URL — when set, used as a texture on the carousel plane. */
  src?: string;
}

export function Photos() {
  const sectionRef = useRef<HTMLElement>(null);
  // Carousel canvas is lazy-mounted via IntersectionObserver — same
  // pattern as Keypad — so the second WebGL context only spins up
  // when the user is approaching the section.
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
    <section ref={sectionRef} className="portfolio-section portfolio-photos">
      <div className="portfolio-col">
        <span className="section-marker">05</span>
        <span className="section-index">05 / 07 &middot; Photos</span>
        <h2>Off the clock.</h2>
        <p className="photos-blurb">
          A turning carousel of the stuff outside the keyboard.
          Scroll to rotate, click a photo to enlarge.
        </p>
      </div>
      <div className="photos-stage">
        {mounted && <PhotosCarousel photos={PHOTOS} sectionRef={sectionRef} />}
      </div>
    </section>
  );
}
