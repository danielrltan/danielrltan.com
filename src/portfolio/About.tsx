import "./sections.css";

export function About() {
  return (
    <section className="portfolio-section">
      <div className="portfolio-col">
        <span className="eyebrow">About</span>
        <h2>Who I am</h2>
        <p>
          I’m a software engineer who builds full-stack web applications and
          interactive 3D experiences. I care about details that most people
          don’t notice — the easing curve on a hover, the inertia of a drag,
          the latency between a click and a frame.
        </p>
        <p>
          The room you’re looking at is a hand-modelled likeness of where I
          work. The keyboard types when you type. The mouse follows your
          cursor. Yank the PC tower; throw the cat. It’s a website that’s
          also a toy.
        </p>
        <p>
          I work in React, TypeScript, three.js / R3F, Rapier physics,
          shaders, and a steady rotation of backend stacks depending on
          what a project actually needs.
        </p>
      </div>
    </section>
  );
}
