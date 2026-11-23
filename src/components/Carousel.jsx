import { useEffect, useRef } from "react";

// Horizontal scroll-snap carousel with prev/next buttons and optional auto-advance (pauses on hover/focus).
export default function Carousel({ children, label = "carousel", auto = 0 }) {
  const ref = useRef(null);
  const paused = useRef(false);
  const by = dir => { const el = ref.current; if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" }); };
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => {
      const el = ref.current;
      if (!el || paused.current) return;
      if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 8) el.scrollTo({ left: 0, behavior: "smooth" });
      else by(1);
    }, auto);
    return () => clearInterval(id);
  }, [auto]);
  return <div className="fh-carousel" onMouseEnter={() => { paused.current = true; }} onMouseLeave={() => { paused.current = false; }} onFocus={() => { paused.current = true; }} onBlur={() => { paused.current = false; }}>
    <button type="button" className="fh-car-btn left" aria-label={`${label}: previous`} onClick={() => by(-1)}>‹</button>
    <div className="fh-car-track" ref={ref} role="list" aria-label={label}>{children}</div>
    <button type="button" className="fh-car-btn right" aria-label={`${label}: next`} onClick={() => by(1)}>›</button>
  </div>;
}
