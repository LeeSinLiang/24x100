import { useEffect, useMemo } from 'react';
import { Drawer } from './components/Drawer';
import { Header } from './components/Header';
import { DrawerCtx } from './components/ui';
import { linkAssumptions, useAudit } from './lib/audit';
import { BLOCKS } from './lib/data';
import { contextFor, lotKey, parcelByLot, useLotModel } from './lib/model';
import { useUrlState } from './lib/url';
import { AboutView } from './views/AboutView';
import { BlockView } from './views/BlockView';
import { ChangesView } from './views/ChangesView';
import { CityView } from './views/CityView';
import { InquiryView } from './views/InquiryView';
import { LotView } from './views/LotView';
import { ReviewView } from './views/ReviewView';
import type { ViewProps } from './views/types';

export function App() {
  const [s, update] = useUrlState();
  const auditApi = useAudit();
  const { entries, add } = auditApi;
  const audit = useMemo(() => [...entries, ...linkAssumptions(s.assume)], [entries, s.assume.join(',')]);
  const block = BLOCKS[s.block];
  const model = useLotModel(s.view === 'lot' || s.view === 'inquiry' ? block : undefined, s, audit);

  // Theme, presentation and record modes live on <html>.
  useEffect(() => {
    const root = document.documentElement;
    if (s.theme) root.dataset.theme = s.theme;
    else delete root.dataset.theme;
    root.dataset.present = s.present ? '1' : '0';
    root.dataset.record = s.record ? '1' : '0';
    if (s.record) {
      const fit = () => {
        root.style.setProperty('zoom', String(Math.min(window.innerWidth / 1440, window.innerHeight / 810)));
      };
      fit();
      window.addEventListener('resize', fit);
      return () => window.removeEventListener('resize', fit);
    }
    root.style.removeProperty('zoom');
  }, [s.theme, s.present, s.record]);

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

  const open = (ref: string) => update({ drawer: ref });
  const sel = block && (s.view === 'lot' || s.view === 'inquiry') ? parcelByLot(block, s.lot) : undefined;
  const crumbs = [
    { label: 'Pittsburgh', href: '?view=city' },
    ...(block && s.view !== 'city' ? [{ label: block.meta.neighborhood }, { label: block.meta.name.replace('Block ', 'Block '), href: `?view=lot&block=${block.meta.id}&lot=${s.lot}` }] : []),
    ...(sel ? [{ label: sel.addr.replace(' (no number)', ` · lot ${lotKey(sel)}`) }] : []),
  ];
  const rsForDrawer = model?.ctx.rs ?? contextFor(block ?? Object.values(BLOCKS)[0], s.district ?? 'RM-M', audit, s.tol).rs;

  return (
    <DrawerCtx.Provider value={open}>
      <div className={`app ${s.record ? 'is-record' : ''}`}>
        <a className="skip" href="#main">
          Skip to the lot
        </a>
        <Header crumbs={crumbs} s={s} update={update} />
        {s.view === 'lot' && block && model ? (
          <LotView block={block} model={model} s={s} update={update} />
        ) : s.view === 'lot' ? (
          <main className="empty" id="main">
            <p>That lot isn't in the loaded blocks. Lot detail covers {Object.values(BLOCKS).map((b) => b.meta.name).join(' and ')}.</p>
          </main>
        ) : (
          (() => {
            const vp: ViewProps = { s, update, block, model, audit, auditApi };
            switch (s.view) {
              case 'block':
                return <BlockView {...vp} />;
              case 'review':
                return <ReviewView {...vp} />;
              case 'inquiry':
                return <InquiryView {...vp} />;
              case 'changes':
                return <ChangesView {...vp} />;
              case 'about':
                return <AboutView {...vp} />;
              default:
                return <CityView {...vp} />;
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
