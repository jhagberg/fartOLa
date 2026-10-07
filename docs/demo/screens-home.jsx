// Home (competitions list) + 3-click new-competition wizard
const { useState: useStateH, useEffect: useEffectH, useRef: useRefH } = React;

function HomeView({ t, competitions, onOpenWizard, onOpenCompetition }) {
  return (
    <div>
      <style>{`
        .comp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
        .comp-card {
          background: var(--bg-elev);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 18px;
          display: flex; flex-direction: column; gap: 10px;
          cursor: pointer; transition: border 0.12s, box-shadow 0.12s;
        }
        .comp-card:hover { border-color: var(--accent); box-shadow: var(--shadow-md); }
        .comp-card .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
        .comp-card h3 { margin: 0; font-size: 17px; font-weight: 600; }
        .comp-card .date { font-family: var(--font-mono); font-size: 12px; color: var(--fg-muted); margin-top: 2px; }
        .comp-card .meta { display: flex; gap: 18px; font-size: 13px; color: var(--fg-muted); margin-top: auto; padding-top: 8px; border-top: 1px solid var(--border); }
        .comp-card .meta b { color: var(--fg); font-weight: 600; font-family: var(--font-mono); }

        .comp-card .pill { font-size: 11px; padding: 2px 8px; border-radius: 999px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; background: var(--ok-soft); color: var(--ok); }
        .progress-bar { height: 6px; background: var(--bg-sunken); border-radius: 999px; overflow: hidden; }
        .progress-bar div { height: 100%; background: var(--accent); border-radius: 999px; }

        .hero {
          background: linear-gradient(135deg, var(--accent-soft), var(--bg-sunken));
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 32px 28px;
          display: flex; align-items: center; justify-content: space-between; gap: 24px;
          margin-bottom: 24px;
        }
        .hero h1 { margin: 0 0 4px; font-size: 26px; letter-spacing: -0.01em; }
        .hero p { margin: 0; color: var(--fg-muted); }
        .hero .deco {
          width: 96px; height: 96px;
          background: var(--bg-elev);
          border: 1.5px solid var(--accent);
          border-radius: 12px;
          display: grid; place-items: center;
          font-family: var(--font-mono); color: var(--accent);
          transform: rotate(-8deg);
          box-shadow: var(--shadow-md);
          font-size: 36px;
        }
      `}</style>

      <div className="hero">
        <div>
          <h1>{t('home.title')}</h1>
          <p>StorTuna OK</p>
        </div>
        <button className="btn primary lg" onClick={onOpenWizard}>{t('home.new')}</button>
      </div>

      <div className="comp-grid">
        {competitions.map(c => (
          <div key={c.id} className="comp-card" onClick={() => onOpenCompetition(c)}>
            <div className="top">
              <div>
                <h3>{c.name}</h3>
                <div className="date">{c.date}</div>
              </div>
              <span className="pill">{t('home.status.live')}</span>
            </div>
            <div className="progress-bar"><div style={{width: '0%'}}></div></div>
            <div className="meta">
              <span>{t('home.starters')} <b>—</b></span>
              <span>{t('home.finished')} <b>—</b></span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NewCompetitionWizard({ t, onCancel, onComplete }) {
  const [step, setStep] = useStateH(1);
  const [name, setName] = useStateH('Onsdagsträning v.20');
  const [date, setDate] = useStateH('2026-05-13');
  const [imported, setImported] = useStateH(null);
  const [detecting, setDetecting] = useStateH(false);
  const [detected, setDetected] = useStateH(false);

  useEffectH(() => {
    if (step === 3 && !detected) {
      setDetecting(true);
      const tm = setTimeout(() => { setDetecting(false); setDetected(true); }, 1600);
      return () => clearTimeout(tm);
    }
  }, [step, detected]);

  const importFakeFile = () => {
    setImported({ filename: 'onsdag-bana-v20.xml' });
  };

  return (
    <div className="modal-scrim" onClick={onCancel}>
      <style>{`
        .wiz-steps { display: flex; gap: 8px; padding: 8px 22px 0; }
        .wiz-step {
          flex: 1; padding: 16px 14px;
          border-radius: 8px;
          background: var(--bg-sunken);
          display: flex; gap: 12px; align-items: center;
          font-size: 13px; color: var(--fg-muted);
          border: 1px solid transparent;
        }
        .wiz-step .num {
          width: 28px; height: 28px; border-radius: 50%;
          background: var(--bg-elev);
          border: 1.5px solid var(--border-strong);
          display: grid; place-items: center;
          font-family: var(--font-mono); font-weight: 600;
          flex-shrink: 0;
        }
        .wiz-step.active { background: var(--accent-soft); color: var(--accent-strong); border-color: var(--accent); }
        .wiz-step.active .num { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
        .wiz-step.done .num { background: var(--ok); color: var(--accent-fg); border-color: var(--ok); }
        .wiz-step b { font-weight: 600; color: inherit; display: block; }

        .drop-zone {
          border: 2px dashed var(--border-strong);
          border-radius: var(--radius-lg);
          padding: 36px;
          text-align: center;
          background: var(--bg-sunken);
          cursor: pointer;
          transition: border 0.12s, background 0.12s;
        }
        .drop-zone:hover { border-color: var(--accent); background: var(--accent-soft); }
        .drop-zone.has-file {
          border-style: solid;
          border-color: var(--ok);
          background: var(--ok-soft);
          color: var(--ok);
          cursor: default;
        }
        .drop-zone .icon { font-size: 32px; margin-bottom: 8px; font-family: var(--font-mono); }

        .detect-card {
          padding: 28px;
          background: var(--bg-sunken);
          border-radius: var(--radius-lg);
          display: flex; align-items: center; gap: 18px;
        }
        .detect-light {
          width: 56px; height: 56px; border-radius: 50%;
          background: var(--bg-elev);
          border: 1.5px solid var(--border-strong);
          display: grid; place-items: center;
          flex-shrink: 0;
          position: relative;
        }
        .detect-light.searching::after {
          content: ''; position: absolute; inset: -6px;
          border: 2px solid var(--accent);
          border-top-color: transparent;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }
        .detect-light.ok {
          background: var(--ok-soft);
          border-color: var(--ok);
          box-shadow: 0 0 0 6px color-mix(in srgb, var(--ok) 16%, transparent);
        }
        .detect-light .ok-dot { width: 16px; height: 16px; border-radius: 50%; background: var(--ok); }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      <div className="modal" onClick={e => e.stopPropagation()} style={{width: 'min(720px, 100%)'}}>
        <div className="modal-head">
          <h2>{t('wiz.title')}</h2>
          <span className="muted" style={{marginLeft: 'auto', fontSize: 13, fontFamily: 'var(--font-mono)'}}>{step}/3</span>
        </div>

        <div className="wiz-steps">
          {[1,2,3].map(n => (
            <div key={n} className={'wiz-step ' + (step === n ? 'active' : step > n ? 'done' : '')}>
              <span className="num">{step > n ? '✓' : n}</span>
              <span>
                <b>{t('wiz.step' + n + '.title')}</b>
                <span style={{fontSize: 11}}>{n === 1 ? 'Skapa' : n === 2 ? 'Importera' : 'Klar'}</span>
              </span>
            </div>
          ))}
        </div>

        <div className="modal-body">
          {step === 1 && (
            <div style={{display: 'grid', gap: 16}}>
              <p className="muted" style={{margin: 0}}>{t('wiz.step1.desc')}</p>
              <div className="field">
                <label>{t('wiz.name')}</label>
                <input className="input" autoFocus value={name} onChange={e => setName(e.target.value)} />
              </div>
              <div className="field">
                <label>{t('wiz.date')}</label>
                <div style={{display: 'flex', gap: 8}}>
                  <input className="input mono" type="text" inputMode="numeric" style={{flex: 1}}
                    pattern="\d{4}-\d{2}-\d{2}" placeholder={t('wiz.date.placeholder')} maxLength={10}
                    value={date} onChange={e => setDate(e.target.value)} />
                  <button type="button" className="btn ghost" onClick={() => setDate('2026-05-13')}>{t('wiz.date.today')}</button>
                </div>
                <small className="muted" style={{fontSize: 12}}>{t('wiz.date.helper')}</small>
              </div>
            </div>
          )}

          {step === 2 && (
            <div style={{display: 'grid', gap: 16}}>
              <p className="muted" style={{margin: 0}}>{t('wiz.step2.desc')}</p>
              <div className={'drop-zone ' + (imported ? 'has-file' : '')} onClick={importFakeFile}>
                {!imported ? (
                  <>
                    <div className="icon">↓ XML</div>
                    <div style={{fontSize: 15, fontWeight: 500, color: 'var(--fg)'}}>{t('wiz.drop')}</div>
                    <div style={{fontSize: 12, color: 'var(--fg-muted)', marginTop: 4}}>{t('wiz.drop.formats')}</div>
                  </>
                ) : (
                  <>
                    <div className="icon">✓</div>
                    <div style={{fontSize: 15, fontWeight: 600}}>{t('wiz.imported')}: {imported.filename}</div>
                    <div style={{fontSize: 12, marginTop: 6}}>Klicka för att byta fil</div>
                  </>
                )}
              </div>
              {imported && (
                <div style={{padding: '10px 14px', background: 'var(--bg-sunken)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 13}}>
                  <div style={{fontWeight: 600}}>Purple Pen / IOF CourseData</div>
                  <div className="mono">{imported.filename}</div>
                  <div className="muted" style={{fontSize: 12, marginTop: 4}}>Klassantal + kontrollantal verifieras serverside i steg 3.</div>
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div style={{display: 'grid', gap: 16}}>
              <p className="muted" style={{margin: 0}}>{t('wiz.step3.desc')}</p>
              <div className="detect-card">
                <div className={'detect-light ' + (detecting ? 'searching' : detected ? 'ok' : '')}>
                  {detected && <div className="ok-dot"></div>}
                </div>
                <div style={{flex: 1}}>
                  {detecting && (
                    <>
                      <div style={{fontWeight: 600, fontSize: 15}}>{t('wiz.detecting')}</div>
                      <div className="muted" style={{fontSize: 13, marginTop: 2}}>Söker på /dev/ttyUSB*</div>
                    </>
                  )}
                  {detected && (
                    <>
                      <div style={{fontWeight: 600, fontSize: 15, color: 'var(--ok)'}}>✓ {t('wiz.detected')} · {t('wiz.handshake')}</div>
                      <div className="muted mono" style={{fontSize: 12, marginTop: 4}}>
                        BSM7-USB · /dev/ttyUSB0 · 38400 baud
                      </div>
                    </>
                  )}
                </div>
              </div>
              <button className="btn primary lg"
                disabled={!detected}
                onClick={() => onComplete({ name, date })}
                style={!detected ? {opacity: 0.5, cursor: 'not-allowed'} : null}>
                ▶ {t('wiz.start')}
              </button>
            </div>
          )}
        </div>

        <div className="modal-foot">
          {step > 1 && <button className="btn ghost" onClick={() => setStep(step - 1)}>← {t('wiz.back')}</button>}
          <button className="btn ghost" onClick={onCancel}>{t('wiz.cancel')}</button>
          <div style={{marginLeft: 'auto'}}></div>
          {step < 3 && (
            <button className="btn primary"
              disabled={step === 2 && !imported}
              onClick={() => setStep(step + 1)}
              style={step === 2 && !imported ? {opacity: 0.5, cursor: 'not-allowed'} : null}>
              {t('wiz.next')} →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { HomeView, NewCompetitionWizard });
