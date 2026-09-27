// Fixed stages (DESIGN_GUIDE §10, §13). Record mode draws the 1440×810 layout at 1920×1080. Present mode
// is for a projector: the workspace is laid out at no less than 1280×720 CSS px and scaled to the screen,
// so type grows on a big screen and a 1024×768 projector gets the desktop layout at 0.8 instead of the
// stacked one. Phones keep their own layout in present mode. Media queries see the real screen, not the
// stage, so the narrow-screen rules in workspace.css skip a staged page (:root[data-stage='1']).
export const RECORD_STAGE = { w: 1440, h: 810 };
export const PRESENT_STAGE = { w: 1280, h: 720 };
/** Present mode stages the workspace on screens at least this wide. */
export const PRESENT_MIN_W = 768;

export interface Stage {
  zoom: number;
  w: number; // the layout's size in CSS px (before the zoom)
  h: number;
}

/** The stage for this link on a `vw`×`vh` screen, or null when the page lays out at the screen's size. */
export function stageFor(s: { present: boolean; record: boolean }, workspace: boolean, vw: number, vh: number): Stage | null {
  if (!workspace || !(vw > 0) || !(vh > 0)) return null;
  if (s.record) {
    const zoom = Math.min(vw / RECORD_STAGE.w, vh / RECORD_STAGE.h);
    return { zoom, ...RECORD_STAGE };
  }
  if (s.present && vw >= PRESENT_MIN_W) {
    // At least 1280×720, and as much more as the screen's shape leaves: the stage fills the screen.
    const zoom = Math.min(vw / PRESENT_STAGE.w, vh / PRESENT_STAGE.h);
    return { zoom, w: Math.floor(vw / zoom), h: Math.floor(vh / zoom) };
  }
  return null;
}

/** The zoom for a page that scrolls (review, inquiry, changes, about): record as before; present scales
 *  the 1440 px desktop layout up on wider screens and never shrinks it. */
export function pageZoom(s: { present: boolean; record: boolean }, vw: number, vh: number): number | null {
  if (s.record) return Math.min(vw / RECORD_STAGE.w, vh / RECORD_STAGE.h);
  if (s.present && vw > 1440) return vw / 1440;
  return null;
}
