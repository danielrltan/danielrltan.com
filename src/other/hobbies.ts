/**
 * The ten interests shown in the Play section. One roster feeds both the
 * accessible list in Other.tsx (label + caption) and the 3D cluster in
 * HobbiesScene.tsx (id + file).
 *
 * `id` is an opaque, STABLE key (it drives HobbiesScene's LAYOUT /
 * POS_PORTRAIT lookups) and deliberately does NOT have to match `file`:
 * belt→glove.glb (Kickboxing), shoe→boot.glb (Fashion) and yarn→donut.glb
 * (3D Modelling) were re-modelled from new .blend drops and keeping the ids
 * avoided churning the layout maps.
 */
export interface Hobby {
  id: string;
  /** GLB under /public/hobbies/. */
  file: string;
  label: string;
  /** One-line note, carried by the sr-only accessible list. */
  caption: string;
}

export const HOBBIES: readonly Hobby[] = [
  { id: "belt",     file: "glove.glb",    label: "Kickboxing",   caption: "gloves up, the discipline of throwing a clean combination and taking the hit." },
  { id: "piano",    file: "piano.glb",    label: "Piano",        caption: "an hour at the keys before anyone else is up." },
  { id: "pc",       file: "gpu.glb",      label: "Workstation",  caption: "the desk is the workshop is the lab is the rabbit hole." },
  { id: "shoe",     file: "boot.glb",     label: "Fashion",      caption: "a fit is a sentence. Punctuation matters." },
  { id: "keyboard", file: "keyboard.glb", label: "Keyboards",    caption: "tactile under the fingers, loud in the room. on purpose." },
  { id: "cursor",   file: "cursor.glb",   label: "Design",       caption: "obsession over the line weight no one will ever notice." },
  { id: "car",      file: "car.glb",      label: "Cars",         caption: "spool, whistle, dump: the soundtrack of a good morning." },
  { id: "yarn",     file: "donut.glb",    label: "3D Modelling", caption: "started with the Blender donut, stayed for the topology." },
  { id: "luggage",  file: "luggage.glb",  label: "Travel",       caption: "the carry-on is packed by Thursday for a Saturday I haven't booked." },
  { id: "ski",      file: "ski.glb",      label: "Skiing",       caption: "blue light, edges biting, the mountain quiet under it all." },
];
