import { useEffect, useMemo } from 'react';
import { TEMPLATES } from '@engine/templates';
import type { TemplateId } from '@engine/types';
import { Drawer } from './components/Drawer';
import { DrawerCtx } from './components/ui';
import { TopBar, type Crumb } from './components/workspace/TopBar';
import { linkAssumptions, useAudit } from './lib/audit';
import { useBoil } from './lib/craft';
import { BLOCKS } from './lib/data';
import { contextFor, lotKey, parcelByLot, useLotModel } from './lib/model';
import { defaultGroup, lotsLabel, scenarioPatch } from './lib/scenario';
import { useTheme } from './lib/theme';
import { hoodIgnored, useUrlState, WORKSPACE_VIEWS } from './lib/url';
import { loadCityData } from './components/city/cityData';
import { pageZoom, stageFor } from './components/workspace/stage';
import { UrlNotice } from './components/workspace/UrlNotice';
import { AboutView } from './views/AboutView';
import { ChangesView } from './views/ChangesView';
import { InquiryView } from './views/InquiryView';
import { ReviewView } from './views/ReviewView';
import { defaultCanvas, WorkspaceView } from './views/WorkspaceView';
import type { ViewProps } from './views/types';

export function App() {
  const [s, update, ignored] = useUrlState();
  const auditApi = useAudit();
  const { entries, add } = auditApi;
  const audit = useMemo(() => [...entries, ...linkAssumptions(s.assume)], [entries, s.assume.join(',')]);
  const block = BLOCKS[s.block];
  const model = useLotModel(s.view === 'lot' || s.view === 'inquiry' ? block : undefined, s, audit);
  const [theme, setTheme] = useTheme(s.theme);
  const workspace = WORKSPACE_VIEWS.includes(s.view);

  // Theme, presentation and record modes live on <html>. Light (paper) unless the link or this
  // browser's toggle says dark; the OS setting is not consulted (spec §0.15).
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.present = s.present ? '1' : '0';
    root.dataset.record = s.record ? '1' : '0';
    root.dataset.workspace = workspace ? '1' : '0';
    // Record and present draw a fixed stage scaled to the screen (workspace/stage.ts); pages scroll.
    const fit = () => {
      const st = stageFor(s, workspace, window.innerWidth, window.innerHeight);
      const z = st?.zoom ?? pageZoom(s, window.innerWidth, window.innerHeight);
      root.dataset.stage = st ? '1' : '0';
      if (st) {
        root.style.setProperty('--stage-w', `${st.w}px`);
        root.style.setProperty('--stage-h', `${st.h}px`);
      } else {
        root.style.removeProperty('--stage-w');
        root.style.removeProperty('--stage-h');
      }
      if (z != null) root.style.setProperty('zoom', String(z));
      else root.style.removeProperty('zoom');
    };
    fit();
    if (!s.present && !s.record) return;
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [theme, s.present, s.record, workspace]);

  // A neighbourhood the citywide file doesn't name is ignored and said so, not read as "0 runs".
  useEffect(() => {
    if (!workspace || !s.hood) return;
    let alive = true;
    const hood = s.hood;
    loadCityData().then((d) => {
      if (!alive || d.state !== 'ready') return;
      const x = hoodIgnored(hood, [...d.hoods.map((h) => h.name), ...d.lots.map((l) => l.hood ?? '')]);
      if (x) {
        ignored.add(x);
        update({ hood: null });
      }
    });
    return () => {
      alive = false;
    };
  }, [workspace, s.hood]);

  // Ready signal for screenshots and recordings: fonts loaded and first render done.
  useEffect(() => {
    let alive = true;
    document.fonts.ready.then(() =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (alive) document.documentElement.dataset.ready = '1';
        }),
      ),
    );
    return () => {
      alive = false;
    };
  }, []);

  const boil = useBoil(!s.still);
  const open = (ref: string) => update({ drawer: ref });
  const sel = block && (s.view === 'lot' || s.view === 'inquiry') ? parcelByLot(block, s.lot) : undefined;

  // The lot group a multi-lot building type uses (the top bar's type switch on the lot view).
  const group = useMemo(() => (s.view === 'lot' && block && model && sel ? defaultGroup(model, block, sel.pin) : null), [s.view, block, model?.ctx, sel?.pin]);
  const onType = (t: TemplateId) => {
    if (s.view === 'lot' && block && group) update({ ...scenarioPatch(t, block, group) }, { push: true });
    else update({ type: t }, { push: true });
  };
  const typeTitle = (t: TemplateId) => (s.view === 'lot' && block && group && TEMPLATES[t].multi_lot ? `${TEMPLATES[t].name} on ${lotsLabel(block, group)}` : TEMPLATES[t].name);

  const cityCrumbs: Crumb[] = [
    { label: 'Pittsburgh', href: '?view=city' },
    ...(s.view === 'city' && s.hood ? [{ label: s.hood, href: `?view=city&hood=${encodeURIComponent(s.hood)}` }] : []),
    ...(s.view === 'city' && s.layer === 'assemble' ? [{ label: 'Combine to fit', href: `?view=city&type=${s.type}&layer=assemble` }] : []),
    ...(s.view === 'city' && s.pin && !s.run ? [{ label: 'City lot' }] : []),
    // "Lot group", as the workspace names them (the inspector's title gives its County block and lots).
    ...(s.view === 'city' && s.layer === 'assemble' && s.run ? [{ label: 'Lot group' }] : []),
  ];
  const crumbs: Crumb[] =
    s.view === 'review'
      ? [{ label: 'Pittsburgh', href: '?view=city' }, { label: 'Rules' }, { label: s.district ?? 'RM-M' }]
      : s.view === 'changes'
        ? [{ label: 'Pittsburgh', href: '?view=city' }, { label: 'What changed' }]
        : s.view === 'about'
          ? [{ label: 'Pittsburgh', href: '?view=city' }, ...(block && s.block ? [{ label: block.meta.name.replace(/-/g, '‑'), href: `?view=block&block=${block.meta.id}` }] : []), { label: 'About' }]
          : s.view === 'city'
            ? cityCrumbs
            : [
                { label: 'Pittsburgh', href: '?view=city' },
                ...(block ? [{ label: block.meta.neighborhood, href: `?view=city&hood=${encodeURIComponent(block.meta.neighborhood)}` }, { label: block.meta.name.replace(/-/g, '‑'), href: `?view=block&block=${block.meta.id}&type=${s.type}` }] : []),
                ...(sel && s.view === 'inquiry' ? [{ label: `Lot ${lotKey(sel)}`, href: `?view=lot&block=${block!.meta.id}&lot=${lotKey(sel)}&type=${s.type}${s.lots.length > 1 ? `&lots=${s.lots.join(',')}` : ''}` }, { label: 'Letters' }] : []),
              ];
  const rsForDrawer = model?.ctx.rs ?? contextFor(block ?? Object.values(BLOCKS)[0], s.district ?? sel?.zone ?? 'RM-M', audit, s.tol).rs;
  const rulesHref = `?view=review&district=${sel?.zone ?? s.district ?? 'RM-M'}`;
  const aboutHref = block && s.view !== 'city' ? `?view=about&block=${block.meta.id}` : '?view=about';
  const vp: ViewProps = { s, update, block, model, audit, auditApi };

  return (
    <DrawerCtx.Provider value={open}>
      <div className={`app ${workspace ? 'is-ws' : 'is-page'} ${s.record ? 'is-record' : ''} ${s.still ? 'is-still' : ''}`}>
        <a className="skip" href="#main">
          Skip to the {workspace ? 'workspace' : 'page'}
        </a>
        <TopBar
          s={s}
          update={update}
          crumbs={crumbs}
          theme={theme}
          setTheme={setTheme}
          workspace={workspace}
          canvas={s.canvas ?? defaultCanvas(s.view)}
          onType={onType}
          typeTitle={typeTitle}
          rulesHref={rulesHref}
          aboutHref={aboutHref}
        />
        <UrlNotice api={ignored} />
        {workspace ? (
          <WorkspaceView {...vp} />
        ) : (
          (() => {
            switch (s.view) {
              case 'review':
                return <ReviewView {...vp} />;
              case 'inquiry':
                return <InquiryView {...vp} />;
              case 'changes':
                return <ChangesView {...vp} />;
              default:
                return <AboutView {...vp} />;
            }
          })()
        )}
        <Drawer
          refId={s.drawer}
          onClose={() => update({ drawer: null })}
          block={block ?? Object.values(BLOCKS)[0]}
          rs={rsForDrawer}
          result={model?.result ?? null}
          money={model?.money ?? null}
          addAudit={(e) => add(e)}
          setProposal={(k, v) => update({ [k]: v } as never)}
          present={s.present}
        />
        <svg className="grain" aria-hidden="true" width="0" height="0">
          {/* Boiling pencil for HTML text and marks: 8 re-seeds a second, deterministic seeds. */}
          {[0, 1, 2, 3, 4].map((i) => (
            <filter key={i} id={`boil-t-${i}`} x="-2%" y="-10%" width="104%" height="120%">
              <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves={2} seed={i * 11 + boil} />
              <feDisplacementMap in="SourceGraphic" scale="1.3" />
            </filter>
          ))}
          <filter id="grain-f">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={3} stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
        </svg>
        <div className="grain-layer" aria-hidden="true" />
      </div>
    </DrawerCtx.Provider>
  );
}
