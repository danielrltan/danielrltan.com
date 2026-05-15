interface Props {
  /** Spotify playlist (or album/track) ID — the bit after `/playlist/`. */
  playlistId: string;
}

/**
 * Spotify playlist embed. Just the iframe — no bg-matching wrapper.
 * The parent widget renders its own card surface underneath; the
 * iframe sits on top with its own rounded corners and the parent's
 * surface shows through wherever the embed doesn't paint.
 */
export function SpotifyWidget({ playlistId }: Props) {
  const src = `https://open.spotify.com/embed/playlist/${playlistId}?utm_source=generator&theme=0`;
  return (
    <iframe
      src={src}
      title={`Spotify playlist ${playlistId}`}
      loading="lazy"
      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
      style={{
        width: "100%",
        height: "100%",
        border: "none",
        display: "block",
      }}
    />
  );
}
