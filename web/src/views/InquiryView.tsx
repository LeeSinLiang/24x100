// The draft inquiry (beat B10): one short letter per office (City Real Estate, the Zoning Administrator,
// the URA, the County assessment office when the records disagree, the RCO), picked from a tab list,
// each with its own Copy, .md and Print. A combined download carries the checklist and every letter.
// The engine writes them (buildInquiry) and checks every number; a letter whose numbers don't trace
// can't be copied, downloaded or printed. 24×100 never sends anything.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { buildInquiry, type InquiryLetter, type OfficeId } from '@engine/inquiry';
import { Checklist, Letter } from '../components/inquiry/Letter';
import { Label } from '../components/ui';
import { toSearch } from '../lib/url';
import '../styles/inquiry.css';
import type { ViewProps } from './types';

/** Today's date in Pittsburgh, as YYYY-MM-DD. */
function todayIso(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for browsers that refuse the async clipboard (insecure origin, permissions).
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

function download(name: string, markdown: string) {
  const url = URL.createObjectURL(new Blob([markdown + '\n'], { type: 'text/markdown' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Print on paper in the light (Atlas) theme, whatever the screen theme is. */
function usePrintLight() {
  useEffect(() => {
    const root = document.documentElement;
    let prev: string | undefined;
    const before = () => {
      prev = root.dataset.theme;
      root.dataset.theme = 'light';
    };
    const after = () => {
      if (prev) root.dataset.theme = prev;
      else delete root.dataset.theme;
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);
}

type Status = null | { kind: 'copied' | 'copy-failed' | 'downloaded'; what: string };

export function InquiryView({ s, block, model }: ViewProps) {
  usePrintLight();
  const date = useMemo(todayIso, []);
  const inq = useMemo(() => (block && model ? buildInquiry(model.result, block, model.ctx.rs, model.money, date, model.ctx.settings) : null), [block, model, date]);
  // ?letter=<office> opens that office's letter (the workspace's route links to it).
  const [office, setOffice] = useState<OfficeId | null>(s.letter);
  const [status, setStatus] = useState<Status>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  if (!block || !model || !inq) {
    return (
      <main className="empty" id="main">
        <p>That lot isn’t in the loaded blocks, so there is nothing to draft.</p>
      </main>
    );
  }
  const letters = inq.letters;
  const letter: InquiryLetter | undefined = letters.find((l) => l.office === office) ?? letters[0];
  const lotHref = toSearch({ ...s, view: 'lot', drawer: null });
  const base = `${block.meta.id}-lot${s.lot}-${inq.refused ? 'records' : s.type}`;
  const allName = `inquiry-${base}.md`;
  const letterName = (l: InquiryLetter) => `letter-${base}-${l.office.replace('_', '-')}.md`;

  const pick = (i: number) => {
    const l = letters[(i + letters.length) % letters.length];
    setOffice(l.office);
    setStatus(null);
    tabs.current[(i + letters.length) % letters.length]?.focus();
  };
  const onTabKey = (e: KeyboardEvent, i: number) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') pick(i + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') pick(i - 1);
    else if (e.key === 'Home') pick(0);
    else if (e.key === 'End') pick(letters.length - 1);
    else return;
    e.preventDefault();
  };

  const ok = inq.check.ok;
  return (
    <main className="iq" id="main">
      <div className="iq-tools">
        <a className="iq-back" href={lotHref}>
          ← Back to the lot
        </a>
        <div className={`iq-check ${ok ? 'is-ok' : 'is-bad'}`} data-check={ok ? 'ok' : 'failed'} id="iq-check" role="status">
          {ok ? (
            <p>
              <Label as="span">Number check</Label> all {inq.check.checked} numbers in {letters.length} letter{letters.length === 1 ? '' : 's'} trace to the engine ✓
            </p>
          ) : (
            <>
              <p>
                <Label as="span">Number check failed</Label> {inq.check.unknown.length} {inq.check.unknown.length === 1 ? 'number doesn’t' : 'numbers don’t'} trace to the engine. A letter with one can’t be copied, downloaded or printed until it does.
              </p>
              <ul>
                {inq.check.unknown.map((u, i) => (
                  <li key={i}>{u}</li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div className="iq-actions">
          <button
            type="button"
            className="btn"
            disabled={!ok}
            aria-describedby="iq-check"
            onClick={() => {
              download(allName, inq.markdown);
              setStatus({ kind: 'downloaded', what: allName });
            }}
          >
            Download .md (all letters)
          </button>
        </div>
        {!s.record && (
          <p className="iq-status" aria-live="polite">
            {status?.kind === 'copied'
              ? `Copied ${status.what} as plain text. Paste it into your email; nothing has been sent.`
              : status?.kind === 'copy-failed'
                ? 'This browser blocked the clipboard. Use .md instead.'
                : status?.kind === 'downloaded'
                  ? `Saved ${status.what}. Nothing has been sent.`
                  : '24×100 drafts one letter per office; you decide whether and where to send each one.'}
          </p>
        )}
      </div>

      {letter ? (
        <>
          <div className="iq-offices" role="tablist" aria-label="Draft letters, one per office">
            {letters.map((l, i) => {
              const on = l.office === letter.office;
              return (
                <button
                  key={l.office}
                  ref={(el) => {
                    tabs.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`iq-tab-${l.office}`}
                  aria-selected={on}
                  aria-controls="iq-panel"
                  tabIndex={on ? 0 : -1}
                  className={`iq-tab${on ? ' is-on' : ''}${l.check.ok ? '' : ' is-bad'}`}
                  onClick={() => pick(i)}
                  onKeyDown={(e) => onTabKey(e, i)}
                >
                  <span className="iq-tab-name">{l.tab}</span>
                  <span className="iq-tab-why">{l.about}</span>
                </button>
              );
            })}
          </div>
          <section className="iq-panel" role="tabpanel" id="iq-panel" aria-labelledby={`iq-tab-${letter.office}`}>
            <div className="iq-letter-bar">
              <p className={`iq-letter-check ${letter.check.ok ? 'is-ok' : 'is-bad'}`} id="iq-letter-check" data-letter-check={letter.check.ok ? 'ok' : 'failed'}>
                {letter.check.ok
                  ? `This letter: ${letter.check.checked} number${letter.check.checked === 1 ? '' : 's'}, all traced ✓`
                  : `This letter: ${letter.check.unknown.length} number${letter.check.unknown.length === 1 ? '' : 's'} not traced; copy, .md and print are blocked.`}
              </p>
              <div className="iq-actions">
                <button
                  type="button"
                  className="btn btn-ink"
                  disabled={!letter.check.ok}
                  aria-describedby="iq-letter-check"
                  onClick={async () => setStatus({ kind: (await copyText(letter.text)) ? 'copied' : 'copy-failed', what: `the letter to ${letter.tab}` })}
                >
                  {status?.kind === 'copied' && status.what === `the letter to ${letter.tab}` ? 'Copied ✓' : 'Copy letter'}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={!letter.check.ok}
                  aria-describedby="iq-letter-check"
                  aria-label={`Download the letter to ${letter.tab} as .md`}
                  onClick={() => {
                    download(letterName(letter), letter.markdown);
                    setStatus({ kind: 'downloaded', what: letterName(letter) });
                  }}
                >
                  .md
                </button>
                <button type="button" className="btn" disabled={!letter.check.ok} aria-describedby="iq-letter-check" onClick={() => window.print()}>
                  Print
                </button>
              </div>
            </div>
            <Letter letter={letter} result={model.result} rs={model.ctx.rs} />
          </section>
        </>
      ) : (
        <p className="iq-none">No letters for this scenario.</p>
      )}
      <Checklist sections={inq.sections} result={model.result} rs={model.ctx.rs} />
    </main>
  );
}
