// Compare (?view=compare): two or three sites on the same columns, the Development Ease parts row by row. Lot 25 alone,
// lots 25–27 together, and tonight's first shortlisted lot (a citywide reading: no plan, no money screen).
import { useMemo } from 'react';
import { easeForCity, easeForLot, type Ease } from '@engine/ease';
import { classifyCityLot } from '@engine/city';
import { buildRuleSet, DEFAULT_SETTINGS } from '@engine/index';
import { Label } from '../components/ui';
import { EaseBar, EasePartCell } from '../components/workspace/Ease';
import { kFmt as k, VerdictStamp } from '../components/workspace/plain';
import { BLOCKS, QUESTIONS, RULES } from '../lib/data';
import { useCityData } from '../components/city/cityData';
import { useLotModel, type LotModel } from '../lib/model';
import { parseUrl } from '../lib/url';
import { SHORTLIST } from './ShortlistView';
import type { ViewProps } from './types';
import '../styles/compare.css';

interface Col {
  key: string;
  title: string;
  sub: string;
  href: string;
  ease: Ease;
  verdict: React.ReactNode;
  money: string;
}

const gapWords = (m: LotModel['money']) => (!m || !m.gap || m.money_verdict === 'no_new_build' ? 'not assessed' : m.money_verdict === 'worth_pricing_site' ? 'the sale covers full cost' : `${k(m.gap.lo)}–${k(m.gap.hi)} a home before land`);

function lotCol(model: LotModel | null, q: string, title: string, sub: string): Col | null {
  if (!model) return null;
  const s = parseUrl(q);
  const block = BLOCKS[s.block];
  const r = model.result;
  return {
    key: q,
    title,
    sub,
    href: q,
    ease: easeForLot(r, model.money, r.pins.map((p) => block.parcels.find((x) => x.pin === p)!), model.ctx.settings, model.moneyGap ?? 'no money data'),
    verdict: <VerdictStamp headline={model.verdict.headline} refusal={r.refusal?.code} />,
    money: gapWords(model.money),
  };
}

export function CompareView({ audit }: ViewProps) {
  const q1 = '?view=lot&block=10K&lot=25&type=two';
  const q2 = '?view=lot&block=10K&lot=25&type=three&lots=25,26,27';
  const s1 = useMemo(() => parseUrl(q1), []);
  const s2 = useMemo(() => parseUrl(q2), []);
  const m1 = useLotModel(BLOCKS[s1.block], s1, audit);
  const m2 = useLotModel(BLOCKS[s2.block], s2, audit);
  const data = useCityData(!!SHORTLIST);
  const top = SHORTLIST?.lots[0];
  const city: Col | null = useMemo(() => {
    if (!top || data.state !== 'ready') return null;
    const l = data.lots.find((x) => x.pin === top.pin);
    if (!l || !l.zone) return null;
    const c = classifyCityLot(l, buildRuleSet(l.zone, RULES, QUESTIONS, audit), 'two', DEFAULT_SETTINGS);
    return {
      key: top.pin,
      title: top.address,
      sub: `${top.hood} · ${top.district} · tonight's shortlist · two-unit house`,
      href: `?view=city&type=two&pin=${top.pin}`,
      ease: easeForCity(c, l, DEFAULT_SETTINGS),
      verdict: <span className="stamp cmp-fits">{c.blocker === 'fits' ? 'Fits · for sale' : 'Fits · not listed'}</span>,
      money: 'not assessed (no sale comparison for this ward)',
    };
  }, [top, data, audit]);
  const cols = [lotCol(m1, q1, '2241 Mahon St · lot 25', 'Middle Hill · RM-M · two-unit house'), lotCol(m2, q2, '2241 Mahon St · lots 25–27', 'Middle Hill · RM-M · three-unit house'), city].filter((c): c is Col => !!c);
  const ids = cols[0]?.ease.parts.map((p) => p.id) ?? [];
  return (
    <main className="cmp-view" id="main">
      <header className="cmp-head">
        <p className="label">Compare sites · Development Ease, part by part</p>
        <h1 className="cmp-title">Same columns, three sites</h1>
        <p className="small muted">
          A range out of 100 from six parts: a known step takes its weight off both ends, an unknown off the low end only. Our weights, shown on each lot’s Ease tab.
        </p>
      </header>
      <div className="cmp-scroll">
        <table className="cmp-table" data-ease-compare>
          <thead>
            <tr>
              <th scope="col" />
              {cols.map((c) => (
                <th key={c.key} scope="col" data-cmp-col={c.key}>
                  <a href={c.href}>{c.title}</a>
                  <span className="cmp-sub">{c.sub}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Verdict</th>
              {cols.map((c) => (
                <td key={c.key}>{c.verdict}</td>
              ))}
            </tr>
            <tr className="cmp-ease-row">
              <th scope="row">Development Ease</th>
              {cols.map((c, i) => (
                <td key={c.key} data-cmp-ease={i}>
                  <EaseBar ease={c.ease} />
                  {!c.ease.scored ? <span className="small muted cmp-why">{c.ease.why}</span> : null}
                </td>
              ))}
            </tr>
            {ids.map((id) => (
              <tr key={id} data-cmp-row={id}>
                <th scope="row">{cols[0].ease.parts.find((p) => p.id === id)!.label}</th>
                {cols.map((c) => {
                  const p = c.ease.parts.find((x) => x.id === id);
                  return <td key={c.key}>{p ? <EasePartCell p={p} /> : <span className="muted">—</span>}</td>;
                })}
              </tr>
            ))}
            <tr>
              <th scope="row">Subsidy per home</th>
              {cols.map((c) => (
                <td key={c.key}>{c.money}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <Label as="h2">Read it</Label>
      <p className="small">
        ✓ clear · ✕ blocks · ? unknown, with who to ask on each lot’s Ease tab. Water and sewer is unknown everywhere: nothing here models it yet (ask PWSA). Open a column’s site for the plan, the rules and
        the letters.
      </p>
    </main>
  );
}
