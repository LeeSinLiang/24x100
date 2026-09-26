// Hand-made media, all deterministic: seeded by id, never Math.random().
import { useEffect, useRef, useState } from 'react';
import { resample } from '@engine/geom';
import type { Pt, Ring } from '@engine/types';

/** 32-bit FNV-1a hash of a string. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Small seeded PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** The boiling step: 8 re-seeds a second, shared by every pencil element on the page. */
export function useBoil(enabled: boolean): number {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!enabled || prefersReducedMotion()) return;
    const id = window.setInterval(() => setStep((s) => (s + 1) % 1000), 125);
    return () => window.clearInterval(id);
  }, [enabled]);
  return step;
}

/** Midpoint displacement, `levels` deep, seeded: a hand-tinted edge for a polygon (feet). */
export function deform(ring: Ring, seed: number, amp: number, levels = 3): Ring {
  const r = rng(seed);
  let pts: Pt[] = ring.map((p) => [p[0], p[1]]);
  let a = amp;
  for (let l = 0; l < levels; l++) {
    const next: Pt[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      next.push(p);
      const mx = (p[0] + q[0]) / 2;
      const my = (p[1] + q[1]) / 2;
      const dx = q[0] - p[0];
      const dy = q[1] - p[1];
      const len = Math.hypot(dx, dy) || 1;
      const off = (r() - 0.5) * 2 * a;
      next.push([mx + (-dy / len) * off, my + (dx / len) * off]);
    }
    pts = next;
    a *= 0.55;
  }
  return pts;
}

const N = 48;
function ease(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/** Envelope reflow: tween a polygon in place over `ms`, resampled to 48 points. */
export function useTweenRing(target: Ring, ms: number, anchor?: Pt): Ring {
  const [shown, setShown] = useState<Ring>(target);
  const from = useRef<Ring>(target);
  const raf = useRef(0);
  const key = target.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ');
  useEffect(() => {
    if (target.length < 3 || ms <= 0 || prefersReducedMotion()) {
      from.current = target;
      setShown(target);
      return;
    }
    const a = from.current.length >= 3 ? resample(from.current, N, anchor) : resample(target, N, anchor);
    const b = resample(target, N, anchor);
    const t0 = performance.now();
    cancelAnimationFrame(raf.current);
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      const e = ease(t);
      const cur: Ring = a.map((p, i) => [p[0] + (b[i][0] - p[0]) * e, p[1] + (b[i][1] - p[1]) * e]);
      from.current = cur;
      setShown(t < 1 ? cur : target);
      if (t < 1) raf.current = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ms]);
  return shown;
}

/** Count a number to its new value over `ms`. */
export function useCountTo(value: number, ms: number): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (ms <= 0 || prefersReducedMotion() || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const a = from.current;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      const v = a + (value - a) * ease(t);
      setShown(t < 1 ? v : value);
      from.current = t < 1 ? v : value;
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

export function ringPath(r: Ring): string {
  if (!r.length) return '';
  return `M${r.map((p) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join('L')}Z`;
}

export function cssVar(name: string, el: Element = document.documentElement): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}
