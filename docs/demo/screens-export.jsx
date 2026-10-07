// IOF XML 3.0 ResultList export — mirrors apps/web/src/lib/screens/ExportView.svelte
// (hard-coded Swedish there as well): Final / Provisional → validation → download.
const { useState: useStateE } = React;

function ExportView({ t }) {
  const [status, setStatus] = useStateE('Final');
  const [validating, setValidating] = useStateE(false);
  const [preview, setPreview] = useStateE(null); // { valid, summary }
  const [unreadMessage, setUnreadMessage] = useStateE(null);

  // Stub for GET /api/competitions/:id/export/preview?status=...
  const refresh = (nextStatus) => {
    setValidating(true);
    setTimeout(() => {
      const personResults = Object.values(window.MOCK_RESULTS || {}).reduce((a, rs) => a + rs.length, 0);
      setPreview({
        valid: true,
        summary: {
          class_count: (window.MOCK_CLASSES || []).length,
          person_result_count: personResults,
          pending_count: 0,
          status: nextStatus,
        },
      });
      setValidating(false);
    }, 620);
  };

  React.useEffect(() => { refresh(status); }, [status]);

  // Nobody is unread in the demo data, so the count is always 0.
  const unreadDns = (undo) => setUnreadMessage(t(undo ? 'export.unreadDns.undone' : 'export.unreadDns.done', { n: 0 }));

  const canDownload = preview && preview.valid && !validating;

  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 760}}>
      <style>{`
        .exp-sec { display: flex; flex-direction: column; gap: 10px; }
        .exp-sec h2 { margin: 0; font-size: 18px; font-weight: 600; letter-spacing: -0.005em; }
        .exp-box { border-radius: var(--radius); padding: 14px 18px; }
        .exp-box.ok { background: var(--ok-soft); border: 1px solid var(--ok); }
        .exp-box.err { background: var(--dnf-soft); border: 1px solid var(--dnf); }
        .exp-box strong { font-weight: 600; }
        .exp-radio {
          display: inline-flex; align-items: center; gap: 10px;
          padding: 12px 16px;
          border: 1px solid var(--border-strong);
          background: var(--bg-elev);
          border-radius: var(--radius);
          font-size: 14px; font-weight: 500;
          cursor: pointer;
          transition: border 0.12s, background 0.12s;
        }
        .exp-radio.active { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-strong); }
        .exp-radio input { accent-color: var(--accent); }
        .exp-radio-group { display: flex; gap: 10px; flex-wrap: wrap; }
      `}</style>

      <header>
        <h1 className="h0">Export — IOF XML 3.0 ResultList</h1>
        <p className="muted" style={{marginTop: 6, maxWidth: 640}}>
          Validera projektionen mot IOF.xsd och ladda ner resultatlistan som ett standardiserat XML-dokument.
        </p>
      </header>

      <div className="exp-sec">
        <h2>Exporttyp</h2>
        <div className="exp-radio-group">
          {[['Final', 'Slutgiltig (Final)'], ['Provisional', 'Provisorisk (Provisional)']].map(([s, label]) => (
            <label key={s} className={'exp-radio ' + (status === s ? 'active' : '')}>
              <input type="radio" name="exp-status" value={s} checked={status === s}
                onChange={() => setStatus(s)} />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="exp-sec">
        <h2>Validering</h2>
        {validating && <p className="muted" style={{margin: 0}}>Validerar …</p>}
        {!validating && preview && preview.valid && (
          <div className="exp-box ok">
            <strong style={{color: 'var(--ok)'}}>✓ Validering OK</strong>
            <div style={{marginTop: 4, fontSize: 13, color: 'var(--fg)'}}>
              {preview.summary.class_count} klasser · {preview.summary.person_result_count} personresultat · status {preview.summary.status}
            </div>
          </div>
        )}
      </div>

      <div className="exp-sec">
        <h2>{t('export.unreadDns.title')}</h2>
        {preview && preview.valid && preview.summary.pending_count > 0 && (
          <div className="exp-box err">
            <strong>{t('export.pending', { n: preview.summary.pending_count })}</strong>
            <p style={{margin: '4px 0 0', fontSize: 13}}>{t('export.pendingHint')}</p>
          </div>
        )}
        <div style={{display: 'flex', gap: 10, flexWrap: 'wrap'}}>
          <button className="btn" onClick={() => unreadDns(false)}>{t('export.unreadDns.set')}</button>
          <button className="btn" onClick={() => unreadDns(true)}>{t('export.unreadDns.undo')}</button>
        </div>
        {unreadMessage && <p className="muted" style={{margin: 0}}>{unreadMessage}</p>}
      </div>

      <div className="exp-sec">
        <h2>Nedladdning</h2>
        <div>
          <a className="btn primary lg"
            href={canDownload ? '#download' : undefined}
            onClick={e => { e.preventDefault(); /* mock: #download is not a real anchor */ }}
            style={!canDownload ? {opacity: 0.5, pointerEvents: 'none'} : null}>
            ↓ Hämta ResultList.xml
          </a>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ExportView });
