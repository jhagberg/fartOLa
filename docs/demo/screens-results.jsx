// Live results — public-facing within the LAN
const { useState: useStateR } = React;

function ResultsTable({ rows, cells, t }) {
  return (
    <table className="res-table">
      <thead>
        <tr>
          <th>{t('res.place')}</th>
          <th>{t('res.name')}</th>
          <th>{t('res.club')}</th>
          <th style={{textAlign: 'right'}}>{t('res.time')}</th>
          <th>{t('res.status')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const c = cells(r);
          return (
            <tr key={i} className={r.status === 'PEND' ? 'pend' : (i === 0 && r.status === 'OK' ? 'new' : '')}>
              <td className="plc">{c.place}</td>
              <td className="name">{r.name}</td>
              <td className="club">{r.club}</td>
              <td className="tm">{c.time}</td>
              <td><StatusPill status={r.status} label={c.label} t={t} small /></td>
            </tr>
          );
        })}
        {rows.length === 0 && (
          <tr><td colSpan="5" style={{textAlign: 'center', padding: 40, color: 'var(--fg-faint)'}}>Inga deltagare ännu.</td></tr>
        )}
      </tbody>
    </table>
  );
}

function ResultsView({ t, fullscreen, setFullscreen }) {
  const classes = window.MOCK_CLASSES || [];
  const results = window.MOCK_RESULTS || {};
  const [active, setActive] = useStateR('ALL');
  // As in the app: 'Alla' shows one table per class that has rows, each under
  // "klass · Bana namn · längd" (SOFT TR 7.8.2); a class tab shows just that class.
  const shown = active === 'ALL' ? classes.filter(c => (results[c.id] || []).length > 0) : classes.filter(c => c.id === active);
  const rows = shown.flatMap(c => results[c.id] || []);
  const heading = (c) => `${c.name} · ${t('res.course')} ${c.course} · ${String(c.length).replace('.', ',')} km`;
  // Place and time only for an approved run; every row carries SOFT's status name.
  const cells = (r) => ({
    place: r.status === 'OK' && r.place ? r.place : '—',
    time: r.status === 'OK' ? r.time : '—',
    label: softLabel(r, t),
  });

  return (
    <div className={fullscreen ? 'res-fs' : ''}>
      <style>{`
        .res-head { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
        .res-head .live {
          display: inline-flex; align-items: center; gap: 6px;
          font-family: var(--font-mono); font-size: 12px;
          color: var(--ok);
          padding: 4px 10px;
          background: var(--ok-soft);
          border-radius: 999px;
        }
        .res-tabs {
          display: flex; gap: 4px;
          border-bottom: 1px solid var(--border);
          margin-bottom: 0;
          overflow-x: auto;
        }
        .res-tab {
          padding: 12px 16px;
          border: 0; background: transparent;
          color: var(--fg-muted);
          font-size: 14px; font-weight: 500;
          border-bottom: 2px solid transparent;
          margin-bottom: -1px;
          white-space: nowrap;
          min-height: var(--hit);
        }
        .res-tab .count { font-family: var(--font-mono); font-size: 11px; margin-left: 6px; color: var(--fg-faint); }
        .res-tab.active { color: var(--accent-strong); border-color: var(--accent); }
        .res-tab:hover:not(.active) { color: var(--fg); background: var(--bg-sunken); }

        .res-table { width: 100%; border-collapse: collapse; background: var(--bg-elev); border-radius: var(--radius-lg); overflow: hidden; box-shadow: var(--shadow-sm); }
        .res-table th, .res-table td {
          padding: 14px 18px;
          text-align: left;
          border-bottom: 1px solid var(--border);
        }
        .res-table th {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--fg-muted);
          font-weight: 600;
          background: var(--bg-sunken);
        }
        .res-table td.plc { font-family: var(--font-mono); font-weight: 600; font-size: 16px; width: 60px; }
        .res-table td.name { font-weight: 500; }
        .res-table td.tm { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 15px; text-align: right; width: 120px; }
        .res-table td.club { color: var(--fg-muted); font-size: 14px; }
        .res-table tr.pend td { color: var(--fg-faint); }
        .class-course { margin: 18px 0 8px; font-size: 16px; font-weight: 600; }
        .comp-meta { margin: 16px 0 0; color: var(--fg-muted); font-size: 13px; }
        .res-table tr.new td { background: var(--accent-soft); }

        /* Fullscreen / projector mode */
        .res-fs {
          position: fixed; inset: 0;
          background: var(--bg);
          z-index: 80;
          padding: 36px;
          overflow: auto;
        }
        .res-fs .res-table th, .res-fs .res-table td { padding: 18px 22px; font-size: 18px; }
        .res-fs .res-table td.tm { font-size: 22px; }
        .res-fs .res-table td.plc { font-size: 22px; }
        .res-fs .res-tab { font-size: 18px; padding: 16px 22px; }
        .res-fs .h0 { font-size: 36px; }
      `}</style>

      <div className="res-head">
        <h1 className="h0">{t('res.title')}</h1>
        <span className="live"><span className="pulse-dot" style={{boxShadow: 'none'}}></span>{t('ro.feed.live')}</span>
        <span className="muted mono" style={{fontSize: 12}}>{t('res.updated')} 14:32:11</span>
        <div style={{marginLeft: 'auto'}} className="row">
          <span className="muted" style={{fontSize: 13}}>{rows.filter(r => r.status === 'OK').length}/{rows.length} {t('res.finished')}</span>
          <button className="btn" onClick={() => setFullscreen(!fullscreen)}>
            {fullscreen ? '⤓ ' + t('res.exit') : '⤢ ' + t('res.fullscreen')}
          </button>
        </div>
      </div>

      <div className="res-tabs">
        <button className={'res-tab ' + (active === 'ALL' ? 'active' : '')} onClick={() => setActive('ALL')}>
          {t('res.all')}<span className="count">{Object.values(results).reduce((a, r) => a + r.length, 0)}</span>
        </button>
        {classes.map(c => (
          <button key={c.id} className={'res-tab ' + (active === c.id ? 'active' : '')} onClick={() => setActive(c.id)}>
            {c.name}<span className="count">{(results[c.id] || []).length}</span>
          </button>
        ))}
      </div>

      {shown.map(c => (
        <div key={c.id}>
          <h2 className="class-course">{heading(c)}</h2>
          <ResultsTable rows={results[c.id] || []} cells={cells} t={t} />
        </div>
      ))}
      {shown.length === 0 && <ResultsTable rows={[]} cells={cells} t={t} />}

      <p className="comp-meta">{(window.MOCK_COMPETITIONS[0] || {}).name} · {(window.MOCK_COMPETITIONS[0] || {}).date}</p>
    </div>
  );
}

Object.assign(window, { ResultsView });
