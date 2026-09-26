// The draft inquiry (beat B10): a one-page letter a CDC could send to City Real Estate, the Zoning
// Administrator, the RCO and the URA. The engine writes it (buildInquiry) and checks every number;
// if a number doesn't trace, copy, download and print are blocked. 24×100 never sends it.
import { useEffect, useMemo, useState } from 'react';
import { buildInquiry } from '@engine/inquiry';
import { Letter } from '../components/inquiry/Letter';
import { fromInquiry, recordsMemo, type Memo } from '../components/inquiry/memo';
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

function fileName(block: string, lot: string, type: string, refused: boolean): string {
  return `inquiry-${block}-lot${lot}-${refused ? 'records' : type}.md`;
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

export function InquiryView({ s, block, model }: ViewProps) {
  usePrintLight();
  const date = useMemo(todayIso, []);
  const memo: Memo | null = useMemo(() => {
    if (!block || !model) return null;
    const inq = buildInquiry(model.result, block, model.ctx.rs, model.money, date);
    return model.result.state === 'refused' ? recordsMemo(inq, model.result, block) : fromInquiry(inq);
  }, [block, model, date]);
  const [status, setStatus] = useState<null | 'copied' | 'copy-failed' | 'downloaded'>(null);

  if (!block || !model || !memo) {
    return (
      <main className="empty" id="main">
        <p>That lot isn’t in the loaded blocks, so there is nothing to draft.</p>
      </main>
    );
  }
  const lotHref = toSearch({ ...s, view: 'lot', drawer: null });
  const ok = memo.check.ok;
  const lot = s.lot;

  const onCopy = async () => setStatus((await copyText(memo.text)) ? 'copied' : 'copy-failed');
  const onDownload = () => {
    const url = URL.createObjectURL(new Blob([memo.markdown + '\n'], { type: 'text/markdown' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName(block.meta.id, lot, s.type, memo.refused);
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus('downloaded');
  };

  return (
    <main className="iq" id="main">
      <div className="iq-tools">
        <a className="iq-back" href={lotHref}>
          ← Back to the lot
        </a>
        <div className={`iq-check ${ok ? 'is-ok' : 'is-bad'}`} data-check={ok ? 'ok' : 'failed'} id="iq-check" role="status">
          {ok ? (
            <p>
              <Label as="span">Number check</Label> all {memo.check.checked} numbers trace to the engine ✓
            </p>
          ) : (
            <>
              <p>
                <Label as="span">Number check failed</Label> {memo.check.unknown.length} {memo.check.unknown.length === 1 ? 'number doesn’t' : 'numbers don’t'} trace to the engine. Copy, download and print stay blocked until they do.
              </p>
              <ul>
                {memo.check.unknown.map((u, i) => (
                  <li key={i}>{u}</li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div className="iq-actions">
          <button type="button" className="btn btn-ink" onClick={onCopy} disabled={!ok} aria-describedby="iq-check">
            {status === 'copied' ? 'Copied ✓' : 'Copy inquiry'}
          </button>
          <button type="button" className="btn" onClick={onDownload} disabled={!ok} aria-describedby="iq-check">
            {status === 'downloaded' ? 'Downloaded ✓' : 'Download .md'}
          </button>
          <button type="button" className="btn" onClick={() => window.print()} disabled={!ok} aria-describedby="iq-check">
            Print
          </button>
        </div>
        {!s.record && (
          <p className="iq-status" aria-live="polite">
            {status === 'copied'
              ? 'Copied as plain text. Paste it into your email; nothing has been sent.'
              : status === 'copy-failed'
                ? 'This browser blocked the clipboard. Use Download .md instead.'
                : status === 'downloaded'
                  ? `Saved ${fileName(block.meta.id, lot, s.type, memo.refused)}. Nothing has been sent.`
                  : '24×100 drafts the letter; you decide whether and where to send it.'}
          </p>
        )}
      </div>
      <Letter memo={memo} result={model.result} rs={model.ctx.rs} />
    </main>
  );
}
