// The selected lot on the city map: what we know, the first blocker in words, the width arithmetic in
// ink or pencil, and where to go next. Nothing here is computed by the interface: the numbers are
// the classifier's.
import { pick } from '@engine/rules';
import { TEMPLATES } from '@engine/templates';
import { cityRoutes, type CityClass } from '@engine/city';
import type { NarrowRow, RuleField, RuleSet, TemplateId } from '@engine/types';
import { Chip, dateFmt, Ev, Label } from '../ui';
import { STYLE, n, zoneName } from './blockers';
import type { CityLotRow } from './cityData';

export interface BlockLink {
  block: string;
  blockName: string;
  lot: string;
}

/** The side-setback rule the classifier used for this lot's width (the narrow-lot table for a
 *  single-unit house on a lot under 60 ft, when a row of the table covers it). */
function widthRuleFields(lot: CityLotRow, rs: RuleSet, type: TemplateId): RuleField[] {
  const front = lot.deed?.front ?? lot.front_len ?? 0;
  const table = pick(rs, 'narrow_lot_side_table');
  const rows = Array.isArray(table?.value) ? (table!.value as NarrowRow[]) : [];
  const narrow = TEMPLATES[type].single_unit && front < 60 && rows.some((r) => r.max_width >= Math.floor(front));
  if (narrow) return ['narrow_lot_side_table'];
  return lot.flank.includes('exterior') ? ['side_setback_interior', 'side_setback_exterior'] : ['side_setback_interior'];
}

function RuleChips({ rs, fields }: { rs: RuleSet | null; fields: RuleField[] }) {
  if (!rs) return null;
  const rules = fields.map((f) => pick(rs, f)).filter((r): r is NonNullable<typeof r> => !!r);
  return (
    <>
      {rules.map((r) => (
        <Chip key={r.id} refId={`rule:${r.id}`} trust={r.state === 'ink' ? 'ink' : 'pencil'}>
          §{r.section}
        </Chip>
      ))}
    </>
  );
}

export function LotCard({
  lot,
  cls,
  type,
  rs,
  link,
  onClose,
  openLot,
}: {
  lot: CityLotRow;
  cls: CityClass;
  type: TemplateId;
  rs: RuleSet | null;
  link: BlockLink | null;
  onClose: () => void;
  openLot: (l: BlockLink) => void;
}) {
  const st = STYLE[cls.blocker];
  const tname = TEMPLATES[type].name.toLowerCase();
  // What would unlock it, in words, where the classifier knows (engine/src/city.ts cityRoutes).
  const routes = link ? [] : cityRoutes(lot, cls, rs, type);
  const also = cls.all.filter((b) => b !== cls.blocker && b !== 'fits');
  const computed = !['rules', 'records', 'edges'].includes(cls.blocker);
  const minArea = rs ? pick(rs, 'min_lot_area') : undefined;
  const lotHref = link ? `?view=lot&block=${link.block}&lot=${link.lot}&type=${type}` : null;
  return (
    <section className="city-card" aria-labelledby="city-card-h" aria-live="polite">
      <header className="city-card-head">
        <Label as="h2">Selected lot</Label>
        <button className="btn btn-quiet btn-small" onClick={onClose} aria-label="Close the selected lot">
          Close ✕
        </button>
      </header>
      <h3 id="city-card-h" className="city-card-addr">
        {lot.addr}
      </h3>
      <p className="city-card-where small">
        {lot.hood}
        {lot.ward != null ? ` · Ward ${lot.ward}` : ''} · {zoneName(lot.zone)}
        {link ? (
          <>
            {' '}
            · lot {link.lot}, {link.blockName.replace(/-/g, '‑')}
          </>
        ) : null}
      </p>

      <dl className="city-card-facts">
        <div>
          <dt>First blocker</dt>
          <dd>
            <span className={`bk bk-${st.id}`} aria-hidden="true" /> <strong>{st.words}</strong>
            {also.length ? <span className="muted"> · also {also.map((b) => STYLE[b].words).join(', ')}</span> : null}
            {cls.blocker === 'rules' || cls.blocker === 'edges' ? <span className="small muted city-card-gloss">{cls.blocker === 'rules' ? cls.note : lot.edge_note ?? cls.note}.</span> : <span className="muted"> for a {tname}</span>}
          </dd>
        </div>

        {cls.blocker === 'records' && (
          <div>
            <dt>Lot area</dt>
            <dd>
              <span className="stamp stamp-refuse city-stamp">CAN’T SCORE</span> County assessment <Ev>{n(Math.round(lot.assessed ?? 0))} sf</Ev>; the City map measures <Ev>{n(Math.round(lot.mapped))} sf</Ev> (
              {(lot.mapped / (lot.assessed || 1)).toFixed(2)}×).
            </dd>
          </div>
        )}

        {computed && cls.formula && (
          <div>
            <dt>Width as of right</dt>
            <dd>
              <Ev trust={cls.widthTrust} num className="city-formula">
                {cls.formula}
                {cls.formula.includes('=') ? ' ft' : ''}
              </Ev>{' '}
              <RuleChips rs={rs} fields={widthRuleFields(lot, rs!, type)} />
              {cls.widthTrust !== 'ink' && <span className="small pencil-text city-card-gloss">{cls.widthNote ?? cls.note}.</span>}
            </dd>
          </div>
        )}

        {computed && (
          <div>
            <dt>Lot area</dt>
            <dd>
              <Ev trust={cls.areaTrust} num>
                {n(cls.area ?? 0)} sf
              </Ev>{' '}
              <span className="muted small">{lot.deed ? `by deed, ${lot.deed.front} × ${lot.deed.depth}` : 'no deed dimensions'}</span>
              {minArea && typeof minArea.value === 'number' && (
                <>
                  {' '}
                  <span className="small muted">· minimum {n(minArea.value)} sf</span> <RuleChips rs={rs} fields={['min_lot_area']} />
                </>
              )}
            </dd>
          </div>
        )}

        <div>
          <dt>City status</dt>
          <dd>
            {lot.status}
            {lot.status_updated ? <span className="muted"> · updated {dateFmt(lot.status_updated)}</span> : null}{' '}
            {link ? <Chip refId={`record:${lot.pin}:city`}>City-owned properties</Chip> : <Chip>City-owned properties</Chip>}
          </dd>
        </div>
      </dl>

      <div className="city-card-actions">
        {lotHref && link ? (
          <a
            className="btn btn-ink"
            href={lotHref}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              openLot(link);
            }}
          >
            Open lot
          </a>
        ) : (
          <div className="small city-card-routes">
            <p>Lot detail isn’t generated for this block yet, so there’s no plate or letter here; what the city map knows:</p>
            {routes.length > 0 && (
              <ul>
                {routes.map((r) => (
                  <li key={r.kind + r.text}>
                    <Ev trust={r.trust}>{r.text}</Ev>
                  </li>
                ))}
              </ul>
            )}
            <p className="muted">
              Record: <a href={`api/lots/${lot.pin}.json`}>api/lots/{lot.pin}.json</a>
            </p>
          </div>
        )}
        {cls.blocker === 'rules' && lot.zone && (
          <a className="btn" href={`?view=review&district=${lot.zone}`}>
            Check {zoneName(lot.zone)} rules
          </a>
        )}
      </div>
    </section>
  );
}
