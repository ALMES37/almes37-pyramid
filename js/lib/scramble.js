// Эффект «перебора символов» для текста интерфейса.
// onTick вызывается, когда очередная буква «встала на место» — для звука клавиш.
const GLYPHS = "ABCDEFGHKMNPRSTXZ0123456789#%/<>+=";
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const running = new WeakMap();

export function scramble(el, text = el.dataset.text ?? el.textContent, duration = 900, onTick) {
  if (!el) return;
  el.dataset.text = text;
  if (reduced) { el.textContent = text; return; }
  cancelAnimationFrame(running.get(el));
  const start = performance.now();
  const order = Array.from(text, (_, i) => i / text.length * 0.6 + Math.random() * 0.4);
  let resolved = 0;

  const tick = (now) => {
    const t = Math.min(1, (now - start) / duration);
    let out = "";
    let count = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === " " || ch === "\n" || t >= order[i]) { out += ch; count++; }
      else out += GLYPHS[(Math.random() * GLYPHS.length) | 0];
    }
    el.textContent = out;
    if (onTick && count > resolved) onTick();
    resolved = count;
    if (t < 1) running.set(el, requestAnimationFrame(tick));
  };
  running.set(el, requestAnimationFrame(tick));
}

// Числа, которые «дышат» — для HUD
export function jitterNumber(base, spread, digits = 2) {
  return (base + (Math.random() - 0.5) * spread).toFixed(digits);
}
