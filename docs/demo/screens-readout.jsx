// Readout view — primary operator surface. Also contains receipt panel + walk-up modal.
const { useState, useEffect, useMemo, useRef } = React;

function ReadoutView({ t, density, currentRead, history, pendingUnknown, onSimulate, onPrint, onSelectRead, walkupOpen, setWalkupOpen, lastFlashKey, autoPrint, setAutoPrint, defaultTpl, setDefaultTpl, onEdit, onManualDnf, onUnDnf, onPickPending }) {
  const isDense = density === 'high';
  const isLow = density === 'low';
  const [rcptTpl, setRcptTpl] = useState(defaultTpl || 'classic');
  const [dnfOpen, setDnfOpen] = useState(false);
  const [dnfReason, setDnfReason] = useState('Bröt loppet');
  useEffect(() => { setDnfOpen(false); setDnfReason('Bröt loppet'); }, [currentRead && currentRead.cardNumber]);
  useEffect(() => { if (defaultTpl) setRcptTpl(defaultTpl); }, [defaultTpl, currentRead && currentRead.cardNumber]);

  return (
    <div className="readout">
      <style>{`
        .readout { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 18px; height: 100%; }
        @media (max-width: 1280px) { .readout { grid-template-columns: minmax(0, 1fr) 340px; } }
        .ro-main { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
        .ro-side { display: flex; flex-direction: column; gap: 18px; min-width: 0; }

        .ro-empty {
          display: grid; place-items: center; height: 280px;
          color: var(--fg-faint); text-align: center;
        }
        .ro-empty .blink {
          width: 96px; height: 96px; border-radius: 50%;
          border: 2px dashed var(--border-strong);
          display: grid; place-items: center;
          margin: 0 auto 18px;
          color: var(--fg-faint);
          font-family: var(--font-mono);
        }

        .runner-row { display: flex; align-items: flex-start; gap: 18px; flex-wrap: wrap; }
        .runner-card-num {
          font-family: var(--font-mono);
          font-size: 44px;
          font-weight: 500;
          letter-spacing: -0.02em;
          color: var(--accent-strong);
          line-height: 1;
        }
        .runner-name { font-size: 26px; font-weight: 600; letter-spacing: -0.01em; margin: 0; }
        .runner-meta { display: flex; gap: 18px; font-size: 14px; color: var(--fg-muted); margin-top: 4px; }
        .runner-meta b { color: var(--fg); font-weight: 600; }
        .ro-result { margin-left: auto; text-align: right; }
        .ro-result .time { font-family: var(--font-mono); font-size: 36px; font-weight: 500; letter-spacing: -0.02em; line-height: 1; }
        .ro-result .place { font-size: 13px; color: var(--fg-muted); margin-top: 6px; }

        /* control sequence */
        .punch-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(56px, 1fr));
          gap: 6px;
          margin-top: 4px;
        }
        .punch {
          aspect-ratio: 1;
          border: 1px solid var(--border);
          border-radius: 6px;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          font-family: var(--font-mono);
          font-size: 13px;
          background: var(--bg-elev);
          position: relative;
        }
        .punch .code { font-weight: 600; }
        .punch .split { font-size: 10px; color: var(--fg-muted); margin-top: 2px; }
        .punch.ok { background: var(--ok-soft); border-color: color-mix(in srgb, var(--ok) 40%, transparent); color: var(--ok); }
        .punch.ok .split { color: color-mix(in srgb, var(--ok) 80%, var(--fg)); }
        .punch.miss { background: var(--dnf-soft); border-color: color-mix(in srgb, var(--dnf) 40%, transparent); color: var(--dnf); border-style: dashed; }
        .punch.extra { background: var(--bg-sunken); border-style: dashed; color: var(--fg-muted); }
        .punch.struck { background: var(--bg-sunken); border-style: dotted; color: var(--fg-muted); }
        .punch.extra .split, .punch.struck .split { font-size: 9px; font-weight: 600; color: var(--fg-muted); }
        .punch.finish { background: var(--accent-soft); border-color: var(--accent); color: var(--accent-strong); font-weight: 600; }
        .punch .idx {
          position: absolute; top: 2px; left: 4px;
          font-size: 9px; color: var(--fg-faint);
        }

        /* split table (dense alt view) */
        .splits-table {
          width: 100%;
          border-collapse: collapse;
          font-family: var(--font-mono);
          font-size: 13px;
        }
        .splits-table th, .splits-table td {
          padding: 6px 10px;
          text-align: right;
          border-bottom: 1px solid var(--border);
        }
        .splits-table th { font-weight: 500; color: var(--fg-muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; text-align: right; }
        .splits-table th:first-child, .splits-table td:first-child { text-align: left; }
        .splits-table tr.finish-row td { background: var(--accent-soft); font-weight: 600; }

        /* history */
        .history-list { display: flex; flex-direction: column; }
        .hist-row {
          display: grid;
          grid-template-columns: 60px 1fr auto;
          gap: 10px;
          padding: 10px 14px;
          border-top: 1px solid var(--border);
          align-items: center;
          font-size: 13px;
          background: transparent;
          border-left: 0; border-right: 0; border-bottom: 0;
          width: 100%; text-align: left;
          cursor: pointer;
          transition: background 0.1s;
          min-height: 56px;
          font-family: inherit;
          color: inherit;
        }
        .hist-row:first-child { border-top: 0; }
        .hist-row:hover { background: var(--bg-sunken); }
        .hist-row.active { background: var(--accent-soft); }
        .hist-row.active::before {
          content: ''; position: absolute; left: 0; top: 6px; bottom: 6px;
          width: 3px; background: var(--accent); border-radius: 2px;
        }
        .hist-row { position: relative; }
        .hist-row .h-card { font-family: var(--font-mono); color: var(--fg-muted); font-size: 12px; }
        .hist-row .h-name { font-weight: 500; }
        .hist-row .h-class { color: var(--fg-muted); font-size: 12px; font-family: var(--font-mono); }
        .hist-row .h-time { font-family: var(--font-mono); font-size: 14px; }
        .hist-row.unmatched .h-name { color: var(--dnf); }

        /* receipt */
        .receipt-wrap {
          background: repeating-linear-gradient(
            -45deg,
            var(--bg-sunken) 0 12px,
            var(--bg) 12px 24px
          );
          padding: 20px;
          display: flex; justify-content: center;
          border-radius: 0 0 var(--radius-lg) var(--radius-lg);
        }
        .receipt {
          background: #fdfcf7;
          color: #1a1a1a;
          width: 300px;
          padding: 18px 16px 28px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.15);
          font-family: var(--font-mono);
          font-size: 11.5px;
          line-height: 1.5;
          clip-path: polygon(
            0 0, 100% 0, 100% calc(100% - 6px),
            96% 100%, 90% calc(100% - 4px), 84% 100%, 78% calc(100% - 4px), 72% 100%,
            66% calc(100% - 4px), 60% 100%, 54% calc(100% - 4px), 48% 100%,
            42% calc(100% - 4px), 36% 100%, 30% calc(100% - 4px), 24% 100%,
            18% calc(100% - 4px), 12% 100%, 6% calc(100% - 4px), 0 100%
          );
        }
        .receipt .rcpt-title { font-weight: 700; text-align: center; letter-spacing: 0.1em; font-size: 13px; padding-bottom: 10px; border-bottom: 1.5px dashed #333; margin-bottom: 10px; }
        .receipt .rcpt-row { display: flex; justify-content: space-between; gap: 8px; }
        .receipt .rcpt-row b { font-weight: 700; }
        .receipt .rcpt-sep { border-top: 1px dashed #888; margin: 10px 0; }
        .receipt .splits-rcpt { width: 100%; }
        .receipt .splits-rcpt td { padding: 1px 0; }
        .receipt .splits-rcpt td:nth-child(1) { width: 22px; }
        .receipt .splits-rcpt td:nth-child(2) { width: 32px; }
        .receipt .splits-rcpt td:nth-child(3) { text-align: right; }
        .receipt .splits-rcpt td:nth-child(4) { text-align: right; width: 50px; }
        .receipt .rcpt-total { font-weight: 700; font-size: 14px; }
        .receipt .rcpt-foot { text-align: center; margin-top: 12px; font-size: 10.5px; }

        .low-density .runner-card-num { font-size: 64px; }
        .low-density .runner-name { font-size: 34px; }
        .low-density .ro-result .time { font-size: 52px; }

        /* receipt template tabs */
        .tpl-chooser {
          display: flex; gap: 2px; flex-wrap: wrap;
          background: var(--bg-sunken); padding: 3px; border-radius: 8px;
          border: 1px solid var(--border);
        }
        .tpl-tab {
          padding: 6px 10px;
          font-size: 12px;
          font-weight: 500;
          border: 0;
          background: transparent;
          color: var(--fg-muted);
          border-radius: 5px;
          min-height: 28px;
        }
        .tpl-tab:hover { color: var(--fg); }
        .tpl-tab.active { background: var(--bg-elev); color: var(--fg); box-shadow: var(--shadow-sm); }

        /* detailed splits table on the receipt */
        .receipt .splits-detailed td { padding: 1.5px 0; }
        .receipt .splits-detailed thead td { border-bottom: 1px dashed #888; padding-bottom: 3px; }
        .receipt .splits-detailed td:nth-child(1) { width: 22px; }
        .receipt .splits-detailed td:nth-child(2) { width: 30px; }
        .receipt .splits-detailed td:nth-child(3) { width: auto; }
        .receipt .splits-detailed td:nth-child(4) { width: 26px; }
        .receipt .splits-detailed td:nth-child(5) { width: 42px; }

        /* top-4 leaderboard table */
        .receipt .top4-tbl td { padding: 3px 2px; vertical-align: top; }
        .receipt .top4-tbl td:nth-child(1) { width: 22px; font-weight: 700; }
        .receipt .top4-tbl td.nm { text-align: left; }
        .receipt .top4-tbl td.tm { text-align: right; width: 56px; }
        .receipt .top4-tbl tr.you td { background: #fff3c4; font-weight: 700; }
        .receipt .top4-tbl tr.you td:first-child { padding-left: 4px; }
        .receipt .top4-tbl tr.you td:last-child { padding-right: 4px; }

        /* kids splits — compact 2-column pair layout */
        .receipt-kids .kids-splits { font-size: 9.5px; }
        .receipt-kids .kids-splits td { padding: 1px 4px 1px 0; }
        .receipt-kids .kids-splits td.t { font-family: var(--font-mono); text-align: right; padding-right: 6px; width: 36px; }
        .receipt-kids .kids-splits td:nth-child(1) { width: 38px; font-family: var(--font-mono); }
        .receipt-kids .kids-splits td:nth-child(3) { width: 38px; font-family: var(--font-mono); border-left: 1px dotted #bbb; padding-left: 6px; }

        /* auto-print toggle */
        .auto-toggle { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
        .auto-toggle .sw {
          position: relative; width: 36px; height: 20px;
          background: var(--bg-sunken);
          border: 1px solid var(--border-strong);
          border-radius: 999px;
          transition: background 0.16s, border 0.16s;
          flex-shrink: 0;
        }
        .auto-toggle .sw input { position: absolute; opacity: 0; inset: 0; cursor: pointer; }
        .auto-toggle .sw .sw-thumb {
          position: absolute; left: 2px; top: 1px;
          width: 16px; height: 16px;
          background: var(--bg-elev);
          border-radius: 50%;
          box-shadow: var(--shadow-sm);
          transition: left 0.16s;
        }
        .auto-toggle .sw[data-on="true"] { background: var(--accent); border-color: var(--accent); }
        .auto-toggle .sw[data-on="true"] .sw-thumb { left: 17px; background: #fff; }
      `}</style>

      <div className={"ro-main " + (isLow ? 'low-density' : '')}>
        {/* Latest read */}
        <div className="card" key={lastFlashKey} style={{animation: lastFlashKey ? 'flashIn 1.6s ease-out' : undefined}}>
          <div className="card-head">
            <h3>{t('ro.latest')}</h3>
            <span className="pulse-dot" style={{marginLeft: 4}}></span>
            <span className="muted" style={{fontSize: 12, fontFamily: 'var(--font-mono)'}}>{t('ro.feed.live')}</span>
            <div style={{marginLeft: 'auto'}} className="row">
              <button className="btn sm ghost" onClick={onSimulate}>↳ {t('ro.simulate')}</button>
            </div>
          </div>

          {!currentRead && (
            <div className="card-body">
              <div className="ro-empty">
                <div>
                  <div className="blink mono">SI ▢</div>
                  <div style={{fontSize: 16, color: 'var(--fg)'}}>{t('ro.waiting')}</div>
                  <div style={{fontSize: 13, marginTop: 4}}>{t('ro.waiting.desc')}</div>
                </div>
              </div>
            </div>
          )}

          {currentRead && currentRead.unknown && (
            <div className="card-body">
              <div className="runner-row">
                <div>
                  <div className="runner-card-num">{currentRead.cardNumber}</div>
                  <h2 className="runner-name" style={{color: 'var(--dnf)'}}>⚠ {t('ro.unknownCard')}</h2>
                  <div className="runner-meta">
                    <span>{t('ro.card')} <b className="mono">{currentRead.cardNumber}</b></span>
                    <span>{t('ro.time')} <b className="mono">{currentRead.readTime}</b></span>
                  </div>
                </div>
                <div className="ro-result">
                  <button className="btn primary lg" onClick={() => setWalkupOpen(true)}>{t('ro.register')}</button>
                </div>
              </div>
            </div>
          )}

          {currentRead && !currentRead.unknown && (
            <div className="card-body">
              <div className="runner-row">
                <div style={{minWidth: 0}}>
                  <div className="runner-card-num">{currentRead.cardNumber}</div>
                  <h2 className="runner-name">{currentRead.name}</h2>
                  <div className="runner-meta">
                    <span>{t('ro.class')} <b>{currentRead.cls}</b></span>
                    <span>{t('ro.club')} <b>{currentRead.club}</b></span>
                    <span>{t('ro.start')} <b className="mono">{currentRead.startTime}</b></span>
                    {currentRead.cardType && <span>{t('ro.card')} <b className="mono">{currentRead.cardType}</b></span>}
                  </div>
                </div>
                <div className="ro-result">
                  <div className="time">{currentRead.elapsed}</div>
                  <div className="place">
                    {currentRead.untimed ? (<>{t('ro.untimed')} · </>) : null}
                    {currentRead.place ? (<>{t('ro.place')} <b className="mono">{currentRead.place}</b> · </>) : null}
                    <StatusPill status={currentRead.status} t={t} />
                  </div>
                </div>
              </div>

              {currentRead.punches && (
                <>
                  <div style={{marginTop: 22, marginBottom: 8, display: 'flex', alignItems: 'baseline', gap: 12}}>
                    <h2 className="h2">{t('ro.course')}</h2>
                    <span className="muted" style={{fontSize: 12, fontFamily: 'var(--font-mono)'}}>
                      {punchProgress(currentRead).ok}/{punchProgress(currentRead).total}
                    </span>
                  </div>

                  {!isDense && (
                    <div className="punch-grid">
                      {currentRead.punches.map((p, i) => (
                        <div key={i} className={'punch ' + (p.finish ? 'finish' : p.struck ? 'struck' : p.extra ? 'extra' : p.ok ? 'ok' : 'miss')}>
                          <span className="idx mono">{p.extra || p.struck || p.finish ? '' : punchNo(currentRead.punches, i).replace('.', '')}</span>
                          <span className="code mono">{p.finish ? 'M' : p.struck ? <s>{p.code}</s> : p.code}</span>
                          <span className="split mono">{punchLabel(p, t) || p.split}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {isDense && (
                    <table className="splits-table">
                      <thead><tr>
                        <th>#</th>
                        <th>{t('ro.code')}</th>
                        <th>{t('ro.split')}</th>
                        <th>{t('ro.cumul')}</th>
                      </tr></thead>
                      <tbody>
                        {currentRead.punches.map((p, i) => (
                          <tr key={i} className={p.finish ? 'finish-row' : ''}>
                            <td>{punchNo(currentRead.punches, i).replace('.', '')}</td>
                            <td>{p.finish ? 'M (mål)' : punchCode(p, t)}</td>
                            <td>{p.split}</td>
                            <td>{p.time}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}
            </div>
          )}

        {currentRead && currentRead.punches && (
          <div style={{padding: '14px 18px', borderTop: '1px solid var(--border)', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', position: 'relative'}}>
            <button className="btn primary" onClick={onPrint} disabled={autoPrint}
              style={autoPrint ? {opacity: 0.55, cursor: 'not-allowed'} : null}>
              🖨  {t('ro.print')}
            </button>
            <button className="btn ghost" onClick={() => onEdit && onEdit(currentRead)} title={t('ro.editTitle')}>
              ✎ {t('ro.edit')}
            </button>
            <div style={{position: 'relative'}}>
              <button className="btn ghost" onClick={() => {
                if (currentRead.status === 'DNF') { onUnDnf && onUnDnf(currentRead); return; }
                setDnfOpen(o => !o);
              }}>
                {currentRead.status === 'DNF' ? '↺ ' + t('ro.undnf') : '⊘ ' + t('ro.dnf')}
              </button>
              {dnfOpen && currentRead.status !== 'DNF' && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 8px)', left: 0,
                  background: 'var(--bg-elev)', border: '1px solid var(--border-strong)',
                  borderRadius: 'var(--radius)', padding: 14, boxShadow: 'var(--shadow-md)',
                  display: 'grid', gap: 10, minWidth: 280, zIndex: 20,
                }} onClick={e => e.stopPropagation()}>
                  <label style={{fontSize: 11, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600}}>
                    {t('ro.dnfReason')}
                  </label>
                  <input className="input" autoFocus value={dnfReason}
                    placeholder={t('ro.dnfReasonPh')}
                    onChange={e => setDnfReason(e.target.value)} maxLength={500} />
                  <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end'}}>
                    <button className="btn ghost sm" onClick={() => setDnfOpen(false)}>{t('walk.cancel')}</button>
                    <button className="btn primary sm"
                      disabled={dnfReason.trim().length === 0}
                      onClick={() => { onManualDnf && onManualDnf(currentRead, dnfReason.trim()); setDnfOpen(false); }}>
                      {t('walk.save')}
                    </button>
                  </div>
                </div>
              )}
            </div>
            <label className="auto-toggle" title={t('ro.autoprint.hint')}>
              <span className="sw" data-on={autoPrint}>
                <input type="checkbox" checked={autoPrint} onChange={e => setAutoPrint(e.target.checked)} />
                <span className="sw-thumb"></span>
              </span>
              <span style={{fontSize: 13, fontWeight: 500}}>{t('ro.autoprint')}</span>
            </label>
            <span className="faint" style={{fontSize: 13}}>Star TSP143 · /dev/usb/lp0</span>
            <div style={{marginLeft: 'auto'}}>
              <span className="kbd">P</span> <span className="faint" style={{fontSize: 12}}>skriv ut</span>
            </div>
          </div>
        )}
        </div>

        {/* Receipt mirror */}
        {currentRead && currentRead.punches && (
          <div className="card">
            <div className="card-head" style={{flexWrap: 'wrap', rowGap: 8}}>
              <h3>{t('ro.printed')}</h3>
              <span className="faint mono" style={{fontSize: 11}}>80mm thermal · ESC/POS</span>
              {autoPrint && <span style={{fontFamily: 'var(--font-mono)', fontSize: 10, padding: '2px 6px', background: 'var(--accent-soft)', color: 'var(--accent-strong)', borderRadius: 4, fontWeight: 600, letterSpacing: '0.05em'}}>AUTO</span>}
              <div className="tpl-chooser" style={{marginLeft: 'auto'}}>
                {['classic', 'standing', 'top4', 'detailed', 'minimal', 'kids'].map(k => (
                  <button key={k} className={'tpl-tab ' + (rcptTpl === k ? 'active' : '')} onClick={() => { setRcptTpl(k); setDefaultTpl && setDefaultTpl(k); }}>
                    {t('rcpt.tpl.' + k)}
                  </button>
                ))}
              </div>
            </div>
            <div className="receipt-wrap">
              <ReceiptMockup read={currentRead} t={t} tpl={rcptTpl} />
            </div>
          </div>
        )}
      </div>

      <div className="ro-side">
        {pendingUnknown && pendingUnknown.length > 0 && (
          <div className="card" style={{borderColor: 'color-mix(in srgb, var(--dnf) 28%, var(--border))'}}>
            <div className="card-head" style={{borderBottomColor: 'color-mix(in srgb, var(--dnf) 28%, var(--border))'}}>
              <h3 style={{color: 'var(--dnf)'}}>⚠ {t('ro.pending.title')}</h3>
              <span className="badge mono" style={{
                marginLeft: 'auto', fontSize: 11, padding: '2px 8px',
                background: 'var(--dnf-soft)', color: 'var(--dnf)', borderRadius: 999,
                fontWeight: 600,
              }}>{pendingUnknown.length}</span>
            </div>
            <div style={{padding: '8px 14px 4px', fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.4}}>
              {t('ro.pending.desc')}
            </div>
            <div style={{display: 'flex', flexDirection: 'column'}}>
              {pendingUnknown.map((cn, i) => (
                <button key={cn} type="button"
                  onClick={() => onPickPending && onPickPending(cn)}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    width: '100%', padding: '12px 14px',
                    background: 'transparent', border: 0,
                    borderTop: i === 0 ? '1px solid var(--border)' : '1px solid var(--border)',
                    cursor: 'pointer', fontFamily: 'inherit', color: 'inherit',
                    textAlign: 'left',
                  }}>
                  <span style={{fontFamily: 'var(--font-mono)', fontWeight: 500}}>{cn}</span>
                  <span style={{fontSize: 12, color: 'var(--accent)', fontWeight: 600}}>→ {t('ro.register')}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="card">
          <div className="card-head">
            <h3>{t('ro.history')}</h3>
            <span className="badge mono" style={{marginLeft: 'auto', fontSize: 11, color: 'var(--fg-muted)'}}>{history.length}</span>
          </div>
          <div className="history-list">
            {history.map((r, i) => {
              const isActive = currentRead && currentRead.cardNumber === r.cardNumber && currentRead.readTime === r.readTime;
              return (
                <button key={r.cardNumber + '-' + i} className={'hist-row ' + (r.unknown ? 'unmatched ' : '') + (isActive ? 'active' : '')}
                  onClick={() => onSelectRead && onSelectRead(r)}>
                  <div className="h-card mono">{r.cardNumber}</div>
                  <div style={{minWidth: 0, overflow: 'hidden'}}>
                    <div className="h-name" style={{textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap'}}>{r.unknown ? '⚠ Okänd bricka' : r.name}</div>
                    <div className="h-class mono">{r.cls} · {r.readTime}</div>
                  </div>
                  <div style={{textAlign: 'right'}}>
                    <div className="h-time">{r.elapsed || '—'}</div>
                    <StatusPill status={r.status} t={t} small />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// Punch presentation helpers. Struck (voided) controls and extra punches are
// labelled with text, not colour alone.
function punchLabel(p, t) {
  if (p.struck) return t('ro.struck');
  if (p.extra) return p.kind === 'order' ? t('ro.order') : t('ro.extra');
  return null;
}

function punchCode(p, t) {
  if (p.finish) return 'M';
  if (p.struck) return <><s>{p.code}</s> {t('ro.struck')}</>;
  if (p.extra) return p.code + ' (' + punchLabel(p, t) + ')';
  return p.code;
}

// Running number for real course controls; extras get '+', struck controls '–'.
function punchNo(punches, i) {
  const p = punches[i];
  if (p.struck) return '–';
  if (p.extra) return '+';
  return punches.slice(0, i + 1).filter(q => !q.extra && !q.struck).length + '.';
}

// ok/total over the tiles that are not extra or struck, as the app counts them
// (a finish punch counts as ok, so a clean run is 16/16).
function punchProgress(read) {
  const counted = read.punches.filter(p => !p.extra && !p.struck);
  return { ok: counted.filter(p => p.ok || p.finish).length, total: counted.length };
}

// What a receipt prints for the status: SOFT's names, as the app's statusLabel
// (TA till TR 7.8.2, TR 4.21.3). The operator's own StatusPill keeps the
// detailed labels (Felstämpling, Bröt …).
function softLabel(read, t) {
  const key =
    read.status === 'OK' ? (read.untimed ? 'DELTAGIT' : 'OK')
    : read.status === 'MP' || read.status === 'DNF' || read.status === 'MAX' ? 'EJ_GODKAND'
    : read.status === 'DQ' ? 'DISKAD'
    : read.status === 'DNS' ? 'EJ_START'
    : read.status === 'CANCEL' ? 'ATERBUD'
    : 'EJ_UTLAST';
  return t('soft.status.' + key);
}

function StatusPill({ status, t, small }) {
  // Status model in line with IOF / Eventor:
  //   OK · MP (missing punch) · DNF · DNS (did not start) · DQ (disqualified)
  //   · CANCEL · MAX (overtime / time cap)
  // Fatal terminations group under .dnf; penalty/non-fatal under .mp; neutral under .pend.
  const cls =
    status === 'OK' ? 'ok'
    : status === 'MP' || status === 'MAX' ? 'mp'
    : status === 'DNF' || status === 'DNS' || status === 'DQ' ? 'dnf'
    : 'pend';
  return (
    <span className={'status ' + cls} style={small ? {fontSize: 10, padding: '2px 6px'} : null}>
      {status}
    </span>
  );
}

/* ---------- Skogis generator (kids receipt) ----------
   Procedurally generates a tamagotchi-like "Skogis" forest critter from
   stable inputs (cardNumber, name, club, class). Same runner always gets
   the same critter; the race result drives stats and accessory only. */

function _skogisHash() {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < arguments.length; i++) {
    const s = String(arguments[i]);
    for (let j = 0; j < s.length; j++) {
      h ^= s.charCodeAt(j);
      h = Math.imul(h, 16777619);
    }
    h ^= 0x9e3779b9;
  }
  return h >>> 0;
}
function _skogisRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function _spick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
function _sint(rng, lo, hi) { return lo + Math.floor(rng() * (hi - lo + 1)); }

const SKOGIS_PALETTES = [
  { body: '#6FA45C', belly: '#cfe2b9', accent: '#3d6a2e', name: 'Skog' },     // green
  { body: '#9C7A4F', belly: '#e7d6b8', accent: '#5e4724', name: 'Stig' },     // earth
  { body: '#C7615A', belly: '#f3cdc4', accent: '#7a2f29', name: 'Lingon' },   // berry red
  { body: '#5E8AB8', belly: '#cfdfee', accent: '#2f4f74', name: 'Bäck' },     // water
  { body: '#7d6fa4', belly: '#d8d2e7', accent: '#3f3464', name: 'Skymn' },    // dusk
  { body: '#d3a851', belly: '#f1deaa', accent: '#7a5d1d', name: 'Sol' },      // sun
  { body: '#5fa39c', belly: '#cfe6e2', accent: '#2c5e58', name: 'Mosse' },    // moss teal
  { body: '#8b8b94', belly: '#dadae0', accent: '#3f3f47', name: 'Sten' },     // stone gray
];

const SKOGIS_SPECIES = [
  'Skogis', 'Stigis', 'Mossis', 'Tallis', 'Granis',
  'Stenis', 'Bäckis', 'Tussis', 'Kompis', 'Lingis',
];

function skogisFromRead(read) {
  const seed = _skogisHash(read.cardNumber || 0, read.name || '', read.club || '', read.cls || '');
  const rng = _skogisRng(seed);

  // identity (stable per runner)
  const palette = _spick(rng, SKOGIS_PALETTES);
  const species = _spick(rng, SKOGIS_SPECIES);
  const bodyShape = _spick(rng, ['blob', 'tall', 'round', 'pear']);
  const eyeStyle = _spick(rng, ['round', 'oval', 'sleepy', 'spark']);
  const mouth = _spick(rng, ['smile', 'o', 'line', 'w', 'tongue']);
  const ears = _spick(rng, ['tuft', 'bunny', 'antennae', 'leaf', 'horns']);
  const pattern = _spick(rng, ['plain', 'plain', 'spots', 'stripes', 'belly']);
  const hasArms = rng() > 0.4;
  const blush = rng() > 0.55;
  const baseLevel = ((read.cardNumber || 1) % 29) + 1;

  // result-derived
  const placeNum = typeof read.place === 'number' ? read.place : null;
  const status = read.status || 'OK';
  const accessory = (
    placeNum === 1 ? 'crown' :
    placeNum === 2 ? 'silver' :
    placeNum === 3 ? 'bronze' :
    (status === 'MP' || status === 'DNF' || status === 'DSQ') ? 'bandage' :
    'flag'
  );

  // stats 1..5
  const ctrls = (read.punches || []).filter(p => !p.finish).length;
  // best legs / total → KART
  const bestLegs = 0; // leg ranks are not computed yet (the app shows none)
  const totalLegs = Math.max(1, (read.punches || []).length);
  const kart = Math.max(1, Math.min(5, Math.round((bestLegs / totalLegs) * 5) + 1));
  // FART: based on place vs starters
  const starters = read.progress?.startersInClass || 6;
  const placeFor = placeNum || starters;
  const fart = Math.max(1, Math.min(5, 6 - Math.round((placeFor / starters) * 5)));
  // STIG: count of controls, scaled
  const stig = Math.max(1, Math.min(5, Math.round(ctrls / 3)));
  // TUR: stable random
  const tur = _sint(rng, 1, 5);

  const levelBonus = (placeNum === 1 ? 5 : placeNum === 2 ? 3 : placeNum === 3 ? 2 : 0);
  const level = baseLevel + levelBonus;

  return { palette, species, bodyShape, eyeStyle, mouth, ears, pattern,
    hasArms, blush, accessory, stats: { fart, stig, kart, tur }, level };
}

function SkogisFigure({ skogis, size = 180 }) {
  const { palette, bodyShape, eyeStyle, mouth, ears, pattern, hasArms, blush, accessory } = skogis;
  const W = 200, H = 210;
  // body geometry
  const cx = 100;
  const cy = bodyShape === 'tall' ? 118 : 120;
  const rx = bodyShape === 'tall' ? 56 : bodyShape === 'round' ? 70 : 66;
  const ry = bodyShape === 'tall' ? 70 : bodyShape === 'round' ? 60 : bodyShape === 'pear' ? 68 : 62;

  // eye anchor
  const eyeY = cy - 12;
  const eyeDX = bodyShape === 'tall' ? 16 : 20;

  return (
    <svg width={size} height={size * H / W} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <defs>
        <pattern id="skogisCrownPat" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)">
          <rect width="4" height="4" fill="#fdfcf7" />
          <line x1="0" y1="0" x2="0" y2="4" stroke="#1a1a1a" strokeWidth="1.2" />
        </pattern>
      </defs>
      {/* feet */}
      <ellipse cx={cx - 22} cy={cy + ry - 4} rx="12" ry="6" fill="#1a1a1a" />
      <ellipse cx={cx + 22} cy={cy + ry - 4} rx="12" ry="6" fill="#1a1a1a" />

      {/* ears / headpiece (behind body for some, in front for others) */}
      {ears === 'tuft' && (
        <g>
          <polygon points={`${cx-22},${cy-ry+6} ${cx-8},${cy-ry-18} ${cx-4},${cy-ry+2}`} fill="#1a1a1a" />
          <polygon points={`${cx+22},${cy-ry+6} ${cx+8},${cy-ry-18} ${cx+4},${cy-ry+2}`} fill="#1a1a1a" />
        </g>
      )}
      {ears === 'bunny' && (
        <g>
          <ellipse cx={cx-16} cy={cy-ry-12} rx="7" ry="20" fill="#fdfcf7" stroke="#1a1a1a" strokeWidth="2" />
          <ellipse cx={cx+16} cy={cy-ry-12} rx="7" ry="20" fill="#fdfcf7" stroke="#1a1a1a" strokeWidth="2" />
          <ellipse cx={cx-16} cy={cy-ry-8} rx="3" ry="12" fill="#1a1a1a" opacity="0.20" />
          <ellipse cx={cx+16} cy={cy-ry-8} rx="3" ry="12" fill="#1a1a1a" opacity="0.20" />
        </g>
      )}
      {ears === 'antennae' && (
        <g stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round">
          <line x1={cx-10} y1={cy-ry+2} x2={cx-18} y2={cy-ry-22} />
          <line x1={cx+10} y1={cy-ry+2} x2={cx+18} y2={cy-ry-22} />
          <circle cx={cx-18} cy={cy-ry-22} r="4" fill="#1a1a1a" stroke="none" />
          <circle cx={cx+18} cy={cy-ry-22} r="4" fill="#1a1a1a" stroke="none" />
        </g>
      )}
      {ears === 'leaf' && (
        <g>
          <ellipse cx={cx} cy={cy-ry-8} rx="10" ry="18" fill="#fdfcf7" stroke="#1a1a1a" strokeWidth="2" transform={`rotate(-18 ${cx} ${cy-ry-8})`} />
          <line x1={cx} y1={cy-ry-22} x2={cx-2} y2={cy-ry+2} stroke="#1a1a1a" strokeWidth="2" />
        </g>
      )}
      {ears === 'horns' && (
        <g fill="#1a1a1a">
          <polygon points={`${cx-16},${cy-ry+2} ${cx-12},${cy-ry-16} ${cx-6},${cy-ry+0}`} />
          <polygon points={`${cx+16},${cy-ry+2} ${cx+12},${cy-ry-16} ${cx+6},${cy-ry+0}`} />
        </g>
      )}

      {/* arms */}
      {hasArms && (
        <g>
          <ellipse cx={cx - rx + 4} cy={cy + 8} rx="10" ry="6" fill="#fdfcf7" stroke="#1a1a1a" strokeWidth="2" transform={`rotate(-18 ${cx - rx + 4} ${cy + 8})`} />
          <ellipse cx={cx + rx - 4} cy={cy + 8} rx="10" ry="6" fill="#fdfcf7" stroke="#1a1a1a" strokeWidth="2" transform={`rotate(18 ${cx + rx - 4} ${cy + 8})`} />
        </g>
      )}

      {/* body */}
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="#fdfcf7" stroke="#1a1a1a" strokeWidth="2.5" />

      {/* pattern */}
      {pattern === 'spots' && (
        <g fill="#1a1a1a" opacity="0.55">
          <circle cx={cx-22} cy={cy+10} r="6" />
          <circle cx={cx+18} cy={cy+18} r="5" />
          <circle cx={cx+8} cy={cy-18} r="4" />
          <circle cx={cx-10} cy={cy+24} r="4" />
        </g>
      )}
      {pattern === 'stripes' && (
        <g stroke="#1a1a1a" strokeWidth="3" fill="none" opacity="0.5">
          <path d={`M${cx-rx+6} ${cy-6} Q${cx} ${cy-2} ${cx+rx-6} ${cy-6}`} />
          <path d={`M${cx-rx+4} ${cy+10} Q${cx} ${cy+14} ${cx+rx-4} ${cy+10}`} />
          <path d={`M${cx-rx+10} ${cy+26} Q${cx} ${cy+30} ${cx+rx-10} ${cy+26}`} />
        </g>
      )}
      {pattern === 'belly' && (
        <ellipse cx={cx} cy={cy + 14} rx={rx - 18} ry={ry - 24} fill="#1a1a1a" opacity="0.10" />
      )}

      {/* blush */}
      {blush && (
        <g fill="#1a1a1a" opacity="0.18">
          <circle cx={cx - eyeDX - 6} cy={eyeY + 12} r="5" />
          <circle cx={cx + eyeDX + 6} cy={eyeY + 12} r="5" />
        </g>
      )}

      {/* eyes */}
      {eyeStyle === 'round' && (
        <g>
          <circle cx={cx - eyeDX} cy={eyeY} r="7" fill="#fff" stroke="#1a1a1a" strokeWidth="1.5" />
          <circle cx={cx + eyeDX} cy={eyeY} r="7" fill="#fff" stroke="#1a1a1a" strokeWidth="1.5" />
          <circle cx={cx - eyeDX + 1.5} cy={eyeY + 1} r="3.2" fill="#1a1a1a" />
          <circle cx={cx + eyeDX + 1.5} cy={eyeY + 1} r="3.2" fill="#1a1a1a" />
          <circle cx={cx - eyeDX + 2.5} cy={eyeY - 0.5} r="1" fill="#fff" />
          <circle cx={cx + eyeDX + 2.5} cy={eyeY - 0.5} r="1" fill="#fff" />
        </g>
      )}
      {eyeStyle === 'oval' && (
        <g>
          <ellipse cx={cx - eyeDX} cy={eyeY} rx="5" ry="8" fill="#1a1a1a" />
          <ellipse cx={cx + eyeDX} cy={eyeY} rx="5" ry="8" fill="#1a1a1a" />
          <circle cx={cx - eyeDX + 1.5} cy={eyeY - 2} r="1.6" fill="#fff" />
          <circle cx={cx + eyeDX + 1.5} cy={eyeY - 2} r="1.6" fill="#fff" />
        </g>
      )}
      {eyeStyle === 'sleepy' && (
        <g stroke="#1a1a1a" strokeWidth="2.5" fill="none" strokeLinecap="round">
          <path d={`M${cx - eyeDX - 6} ${eyeY} Q${cx - eyeDX} ${eyeY + 5} ${cx - eyeDX + 6} ${eyeY}`} />
          <path d={`M${cx + eyeDX - 6} ${eyeY} Q${cx + eyeDX} ${eyeY + 5} ${cx + eyeDX + 6} ${eyeY}`} />
        </g>
      )}
      {eyeStyle === 'spark' && (
        <g fill="#1a1a1a">
          <polygon points={`${cx-eyeDX},${eyeY-7} ${cx-eyeDX+2},${eyeY-1} ${cx-eyeDX+7},${eyeY} ${cx-eyeDX+2},${eyeY+1} ${cx-eyeDX},${eyeY+7} ${cx-eyeDX-2},${eyeY+1} ${cx-eyeDX-7},${eyeY} ${cx-eyeDX-2},${eyeY-1}`} />
          <polygon points={`${cx+eyeDX},${eyeY-7} ${cx+eyeDX+2},${eyeY-1} ${cx+eyeDX+7},${eyeY} ${cx+eyeDX+2},${eyeY+1} ${cx+eyeDX},${eyeY+7} ${cx+eyeDX-2},${eyeY+1} ${cx+eyeDX-7},${eyeY} ${cx+eyeDX-2},${eyeY-1}`} />
        </g>
      )}

      {/* mouth */}
      {mouth === 'smile' && (
        <path d={`M${cx-10} ${eyeY+18} Q${cx} ${eyeY+26} ${cx+10} ${eyeY+18}`} stroke="#1a1a1a" strokeWidth="2" fill="none" strokeLinecap="round" />
      )}
      {mouth === 'o' && (
        <circle cx={cx} cy={eyeY + 22} r="4" fill="#1a1a1a" />
      )}
      {mouth === 'line' && (
        <line x1={cx-6} y1={eyeY+22} x2={cx+6} y2={eyeY+22} stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round" />
      )}
      {mouth === 'w' && (
        <path d={`M${cx-9} ${eyeY+20} Q${cx-4.5} ${eyeY+26} ${cx} ${eyeY+22} Q${cx+4.5} ${eyeY+26} ${cx+9} ${eyeY+20}`} stroke="#1a1a1a" strokeWidth="2" fill="none" strokeLinecap="round" />
      )}
      {mouth === 'tongue' && (
        <g>
          <path d={`M${cx-10} ${eyeY+18} Q${cx} ${eyeY+28} ${cx+10} ${eyeY+18}`} stroke="#1a1a1a" strokeWidth="2" fill="none" strokeLinecap="round" />
          <ellipse cx={cx+2} cy={eyeY+24} rx="3" ry="4" fill="#1a1a1a" opacity="0.30" />
        </g>
      )}

      {/* accessory: race outcome badge */}
      {accessory === 'crown' && (
        <g>
          <polygon points={`${cx-22},${cy-ry-2} ${cx-22},${cy-ry-18} ${cx-12},${cy-ry-8} ${cx},${cy-ry-22} ${cx+12},${cy-ry-8} ${cx+22},${cy-ry-18} ${cx+22},${cy-ry-2}`} fill="url(#skogisCrownPat)" stroke="#1a1a1a" strokeWidth="1.5" />
          <circle cx={cx-22} cy={cy-ry-18} r="2.5" fill="#1a1a1a" />
          <circle cx={cx} cy={cy-ry-22} r="2.5" fill="#1a1a1a" />
          <circle cx={cx+22} cy={cy-ry-18} r="2.5" fill="#1a1a1a" />
        </g>
      )}
      {accessory === 'silver' && (
        <g transform={`translate(${cx-cx+0} 0)`}>
          <polygon points={`${cx},${cy-ry-22} ${cx+4},${cy-ry-12} ${cx+14},${cy-ry-10} ${cx+6},${cy-ry-3} ${cx+8},${cy-ry+8} ${cx},${cy-ry+2} ${cx-8},${cy-ry+8} ${cx-6},${cy-ry-3} ${cx-14},${cy-ry-10} ${cx-4},${cy-ry-12}`} fill="#fdfcf7" stroke="#1a1a1a" strokeWidth="1.2" />
        </g>
      )}
      {accessory === 'bronze' && (
        <g>
          <circle cx={cx} cy={cy-ry-12} r="11" fill="#1a1a1a" stroke="#1a1a1a" strokeWidth="1.5" />
          <text x={cx} y={cy-ry-8} textAnchor="middle" fontSize="11" fontWeight="700" fill="#fdfcf7" fontFamily="sans-serif">3</text>
        </g>
      )}
      {accessory === 'bandage' && (
        <g>
          <rect x={cx-16} y={cy-2} width="32" height="10" rx="2" fill="#fdfcf7" stroke="#1a1a1a" strokeWidth="1.2" transform={`rotate(-12 ${cx} ${cy+3})`} />
          <line x1={cx-3} y1={cy} x2={cx+3} y2={cy+8} stroke="#1a1a1a" strokeWidth="1" />
          <line x1={cx+3} y1={cy} x2={cx-3} y2={cy+8} stroke="#1a1a1a" strokeWidth="1" />
        </g>
      )}
      {accessory === 'flag' && (
        <g>
          <line x1={cx + rx + 6} y1={cy + 16} x2={cx + rx + 6} y2={cy - 18} stroke="#1a1a1a" strokeWidth="2" />
          <polygon points={`${cx+rx+6},${cy-18} ${cx+rx+22},${cy-12} ${cx+rx+6},${cy-6}`} fill="#fdfcf7" stroke="#1a1a1a" strokeWidth="1.5" />
          <polygon points={`${cx+rx+6},${cy-12} ${cx+rx+14},${cy-9} ${cx+rx+6},${cy-6}`} fill="#1a1a1a" />
        </g>
      )}
    </svg>
  );
}

function StatBar({ label, value, color }) {
  return (
    <div style={{display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontFamily: 'var(--font-mono)'}}>
      <span style={{width: 32, fontWeight: 700, color: '#1a1a1a'}}>{label}</span>
      <span style={{display: 'inline-flex', gap: 2}}>
        {[1,2,3,4,5].map(i => (
          <span key={i} style={{
            width: 8, height: 10, borderRadius: 1,
            background: i <= value ? color : 'transparent',
            border: '1px solid ' + (i <= value ? color : '#999'),
          }} />
        ))}
      </span>
    </div>
  );
}

function ReceiptMockup({ read, t, tpl = 'classic' }) {
  const prog = read.progress || { place: read.place, finishedInClass: 1, startersInClass: 1, behind: null };
  const isLeader = prog.place === 1;
  const tornEdge = {
    clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), 96% 100%, 90% calc(100% - 4px), 84% 100%, 78% calc(100% - 4px), 72% 100%, 66% calc(100% - 4px), 60% 100%, 54% calc(100% - 4px), 48% 100%, 42% calc(100% - 4px), 36% 100%, 30% calc(100% - 4px), 24% 100%, 18% calc(100% - 4px), 12% 100%, 6% calc(100% - 4px), 0 100%)'
  };

  // ---------- CLASSIC ----------
  if (tpl === 'classic') {
    return (
      <div className="receipt">
        <div className="rcpt-title">{t('rcpt.title')}</div>
        <div className="rcpt-row"><span>Onsdagsträning</span><span>2026-05-13</span></div>
        <div className="rcpt-row"><b>{read.name}</b><span>{read.cardNumber}</span></div>
        <div className="rcpt-row"><span>{read.cls} · {read.club}</span><span>{read.startTime}</span></div>
        <div className="rcpt-sep"></div>
        <div style={{fontWeight: 700, marginBottom: 4}}>{t('rcpt.controls')}</div>
        <table className="splits-rcpt">
          <tbody>
            {read.punches.map((p, i) => (
              <tr key={i}>
                <td>{punchNo(read.punches, i)}</td>
                <td>{punchCode(p, t)}</td>
                <td>{p.split}</td>
                <td>{p.time}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="rcpt-sep"></div>
        <div className="rcpt-row rcpt-total"><span>{t('rcpt.total')}</span><span>{read.elapsed} {softLabel(read, t)}</span></div>
        {read.untimed && <div className="rcpt-row"><span>{t('ro.untimed')}</span></div>}
        {read.place && <div className="rcpt-row"><span>{t('rcpt.place')} {read.cls}</span><b>{read.place}</b></div>}
        <div className="rcpt-foot">{t('rcpt.thanks')}</div>
      </div>
    );
  }

  // ---------- CLASS STANDING ----------
  if (tpl === 'standing') {
    return (
      <div className="receipt">
        <div className="rcpt-title">{t('rcpt.title')}</div>
        <div className="rcpt-row"><span>Onsdagsträning</span><span>2026-05-13</span></div>
        <div className="rcpt-row"><b>{read.name}</b><span>{read.cardNumber}</span></div>
        <div className="rcpt-row"><span>{read.cls} · {read.club}</span><span>{read.startTime}</span></div>
        <div className="rcpt-sep"></div>
        <div style={{textAlign: 'center', padding: '4px 0 2px'}}>
          <div style={{fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1}}>
            {read.elapsed}
          </div>
          <div style={{fontSize: 11, marginTop: 4, color: '#666', textTransform: 'uppercase', letterSpacing: '0.06em'}}>
            {read.untimed ? t('ro.untimed') + ' · ' : ''}{t('rcpt.total')} · {softLabel(read, t)}
          </div>
        </div>
        <div className="rcpt-sep"></div>
        {read.status === 'OK' && read.place ? (
          <>
            <div style={{textAlign: 'center', padding: '6px 0 4px'}}>
              <div style={{fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: '0.06em'}}>{t('rcpt.place')} {read.cls}</div>
              <div style={{fontSize: 22, fontWeight: 700, marginTop: 2, lineHeight: 1}}>
                {read.place} <span style={{fontSize: 13, fontWeight: 400, color: '#666'}}>{t('rcpt.of')} {prog.finishedInClass} {t('rcpt.finished')}</span>
              </div>
              <div style={{fontSize: 11, marginTop: 4, color: '#666'}}>
                {prog.startersInClass} {t('rcpt.starters')}
              </div>
            </div>
            <div className="rcpt-sep"></div>
            <div className="rcpt-row" style={{fontWeight: 600}}>
              <span>{isLeader ? '★ ' + t('rcpt.leader') : t('rcpt.behind')}</span>
              <span>{isLeader ? '—' : (read.progress?.behind || '+0:00')}</span>
            </div>
          </>
        ) : (
          <div className="rcpt-row"><b>Status</b><span>{softLabel(read, t)}</span></div>
        )}
        <div className="rcpt-sep"></div>
        <div style={{fontSize: 10, color: '#666', marginBottom: 4}}>{t('rcpt.controls')}</div>
        <table className="splits-rcpt" style={{fontSize: 10.5}}>
          <tbody>
            {read.punches.map((p, i) => (
              <tr key={i}>
                <td>{punchNo(read.punches, i)}</td>
                <td>{punchCode(p, t)}</td>
                <td>{p.split}</td>
                <td>{p.time}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="rcpt-foot">{t('rcpt.thanks')}</div>
      </div>
    );
  }

  // ---------- DETAILED (MeOS-OZ style; leg rank and time lost are not computed yet) ----------
  if (tpl === 'detailed') {
    return (
      <div className="receipt">
        <div className="rcpt-title">{t('rcpt.title')}</div>
        <div className="rcpt-row"><span>Onsdagsträning</span><span>2026-05-13</span></div>
        <div className="rcpt-row"><b>{read.name}</b><span>{read.cardNumber}</span></div>
        <div className="rcpt-row"><span>{read.cls} · {read.club}</span><span>{read.startTime}</span></div>
        <div className="rcpt-sep"></div>
        <table className="splits-rcpt splits-detailed">
          <thead>
            <tr style={{fontSize: 9, color: '#666'}}>
              <td>#</td><td>Kod</td><td style={{textAlign:'right'}}>Sträcka</td><td style={{textAlign:'right'}}>Pl</td><td style={{textAlign:'right'}}>+/−</td>
            </tr>
          </thead>
          <tbody>
            {read.punches.map((p, i) => (
              <tr key={i} style={p.finish ? {fontWeight: 700} : null}>
                <td>{punchNo(read.punches, i)}</td>
                <td>{punchCode(p, t)}</td>
                <td style={{textAlign:'right'}}>{p.split}</td>
                <td style={{textAlign:'right'}}>—</td>
                <td style={{textAlign:'right'}}>—</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="rcpt-sep"></div>
        <div className="rcpt-row rcpt-total"><span>{t('rcpt.total')}</span><span>{read.elapsed} {softLabel(read, t)}</span></div>
        {read.untimed && <div className="rcpt-row"><span>{t('ro.untimed')}</span></div>}
        {read.place && (
          <>
            <div className="rcpt-row"><span>{t('rcpt.place')}</span><b>{read.place} {t('rcpt.of')} {prog.finishedInClass} {t('rcpt.finished')}</b></div>
            <div className="rcpt-row"><span>{isLeader ? t('rcpt.leader') : t('rcpt.behind')}</span><b>{isLeader ? '—' : (prog.behind || '+0:00')}</b></div>
          </>
        )}
        <div className="rcpt-foot">{t('rcpt.thanks')}</div>
      </div>
    );
  }

  // ---------- TOP 4 (leaderboard slice) ----------
  if (tpl === 'top4') {
    const classResults = (window.MOCK_RESULTS?.[read.cls] || []).slice(0, 4);
    const youInTop4 = classResults.some(r => r.name === read.name);
    return (
      <div className="receipt">
        <div className="rcpt-title">{t('rcpt.title')}</div>
        <div className="rcpt-row"><span>Onsdagsträning</span><span>2026-05-13</span></div>
        <div className="rcpt-row"><b>{read.name}</b><span>{read.cardNumber}</span></div>
        <div className="rcpt-row"><span>{read.cls} · {read.club}</span><span>{read.startTime}</span></div>
        <div className="rcpt-sep"></div>
        <div className="rcpt-row rcpt-total"><span>{t('rcpt.total')}</span><span>{read.elapsed} {softLabel(read, t)}</span></div>
        {read.untimed && <div className="rcpt-row"><span>{t('ro.untimed')}</span></div>}
        {read.place && (
          <div className="rcpt-row" style={{fontSize: 10.5, color: '#555'}}>
            <span>{isLeader ? '★ ' + t('rcpt.leader') : t('rcpt.behind')}</span>
            <span>{isLeader ? '—' : (prog.behind || '+0:00')}</span>
          </div>
        )}
        <div className="rcpt-sep"></div>
        <div style={{fontSize: 10, color: '#444', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4, fontWeight: 700}}>
          {t('rcpt.top.title').replace('{cls}', read.cls)}
        </div>
        <table className="splits-rcpt top4-tbl">
          <tbody>
            {classResults.map((r, i) => {
              const isYou = r.name === read.name;
              return (
                <tr key={i} className={isYou ? 'you' : ''}>
                  <td>{r.place || '—'}</td>
                  <td className="nm">{r.name}{isYou ? ' ←' : ''}</td>
                  <td className="tm">{r.status === 'PEND' ? t('rcpt.top.pending') : r.time}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!youInTop4 && (
          <>
            <div className="rcpt-sep" style={{borderTopStyle: 'dotted'}}></div>
            <div style={{fontSize: 10, color: '#444', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4, fontWeight: 700}}>{t('rcpt.top.yourow')}</div>
            <table className="splits-rcpt top4-tbl">
              <tbody>
                <tr className="you">
                  <td>{read.place || '—'}</td>
                  <td className="nm">{read.name} ←</td>
                  <td className="tm">{read.elapsed}</td>
                </tr>
              </tbody>
            </table>
          </>
        )}
        <div className="rcpt-foot">{t('rcpt.thanks')}</div>
      </div>
    );
  }

  // ---------- KIDS (Skogis collectible) ----------
  if (tpl === 'kids') {
    const skogis = skogisFromRead(read);
    const ctrls = (read.punches || []).filter(p => !p.finish).length;
    const placeNum = typeof read.place === 'number' ? read.place : null;
    const subtitle = (
      placeNum === 1 ? '★ Klassens snabbaste ★' :
      placeNum === 2 ? 'Silvermedalj' :
      placeNum === 3 ? 'Bronsmedalj' :
      read.status === 'OK' ? 'Mål i skogen!' :
      read.status === 'MP' ? 'Tappade bort en kontroll' :
      read.status === 'DNF' ? 'Bröt loppet' :
      'I full fart!'
    );
    return (
      <div className="receipt receipt-kids">
        <div className="rcpt-title" style={{letterSpacing: '0.18em'}}>{t('rcpt.kids.title')}</div>

        <div style={{
          background: '#fdfcf7',
          border: '1.5px dashed #1a1a1a',
          borderRadius: 10,
          padding: '8px 6px 4px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}>
          <SkogisFigure skogis={skogis} size={170} />
          <div style={{
            marginTop: 2,
            fontWeight: 800,
            fontSize: 18,
            letterSpacing: '-0.01em',
            color: '#1a1a1a',
          }}>
            {skogis.palette.name}{skogis.species.slice(skogis.species.length > 6 ? -3 : -2)}
          </div>
          <div style={{
            fontSize: 10,
            fontFamily: 'var(--font-mono)',
            color: '#1a1a1a',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}>
            {skogis.species} · {t('rcpt.kids.level')} {skogis.level}
          </div>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '4px 12px',
          margin: '10px 2px 2px',
        }}>
          <StatBar label={t('rcpt.kids.stat.fart')} value={skogis.stats.fart} color="#1a1a1a" />
          <StatBar label={t('rcpt.kids.stat.stig')} value={skogis.stats.stig} color="#1a1a1a" />
          <StatBar label={t('rcpt.kids.stat.kart')} value={skogis.stats.kart} color="#1a1a1a" />
          <StatBar label={t('rcpt.kids.stat.tur')} value={skogis.stats.tur} color="#1a1a1a" />
        </div>

        <div className="rcpt-sep"></div>

        <div className="rcpt-row" style={{fontWeight: 700}}><span>{read.name}</span><span>{read.cls}</span></div>
        <div className="rcpt-row" style={{fontSize: 10.5, color: '#555'}}><span>{read.club}</span><span>{t('rcpt.kids.born')} 2026-05-13</span></div>

        <div style={{textAlign: 'center', padding: '8px 0 2px'}}>
          <div style={{fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em'}}>{subtitle}</div>
          <div style={{fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.1, marginTop: 2}}>{read.elapsed}</div>
          <div style={{fontSize: 10.5, fontFamily: 'var(--font-mono)', color: '#1a1a1a', marginTop: 2}}>
            {softLabel(read, t)} · {ctrls} {t('rcpt.kids.controls')}{placeNum ? ' · ' + t('rcpt.place').toLowerCase() + ' ' + placeNum : ''}
          </div>
        </div>

        <div className="rcpt-sep" style={{borderTopStyle: 'dotted'}}></div>

        {/* compact splits for kids — code + split only */}
        <table className="splits-rcpt kids-splits">
          <tbody>
            {(read.punches || []).reduce((rows, p, i) => {
              const ri = Math.floor(i / 2);
              if (!rows[ri]) rows[ri] = [];
              rows[ri].push(p);
              return rows;
            }, []).map((pair, i) => (
              <tr key={i}>
                <td>{i*2+1}. {punchCode(pair[0], t)}</td>
                <td className="t">{pair[0].split}</td>
                <td>{pair[1] ? <>{i*2+2}. {punchCode(pair[1], t)}</> : ''}</td>
                <td className="t">{pair[1] ? pair[1].split : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="rcpt-foot" style={{marginTop: 6}}>{t('rcpt.kids.foot')}</div>
      </div>
    );
  }

  // ---------- MINIMAL ----------
  return (
    <div className="receipt receipt-min">
      <div className="rcpt-title">{t('rcpt.title')}</div>
      <div style={{textAlign: 'center', padding: '6px 0'}}>
        <div style={{fontSize: 15, fontWeight: 700}}>{read.name}</div>
        <div style={{fontSize: 11, color: '#666', marginTop: 2}}>{read.cls} · {read.club} · SI {read.cardNumber}</div>
      </div>
      <div className="rcpt-sep"></div>
      <div style={{textAlign: 'center', padding: '10px 0 4px'}}>
        <div style={{fontSize: 34, fontWeight: 700, lineHeight: 1, letterSpacing: '-0.02em'}}>{read.elapsed}</div>
        <div style={{marginTop: 6, fontSize: 12, color: '#666'}}>
          {read.status === 'OK' && read.place ? (
            <>{t('rcpt.place')} <b style={{color: '#1a1a1a'}}>{read.place}</b> {t('rcpt.of')} {prog.finishedInClass} {t('rcpt.finished')}</>
          ) : (
            <b style={{color: '#1a1a1a'}}>{softLabel(read, t)}</b>
          )}
        </div>
        {!isLeader && read.status === 'OK' && (
          <div style={{marginTop: 2, fontSize: 11, color: '#a64c00'}}>{prog.behind} {t('rcpt.behind')}</div>
        )}
      </div>
      <div className="rcpt-sep"></div>
      <div className="rcpt-foot" style={{marginTop: 8}}>{t('rcpt.thanks')}</div>
    </div>
  );
}

function WalkupModal({ t, cardNumber, classes, onCancel, onSave }) {
  const [name, setName] = useState('');
  const [club, setClub] = useState('');
  const [cls, setCls] = useState(classes[0]?.id || '');
  const [card, setCard] = useState(cardNumber || '');
  const [suggestions, setSuggestions] = useState([]);

  const onClubChange = (v) => {
    setClub(v);
    if (v.length >= 2) {
      const lc = v.toLowerCase();
      setSuggestions((window.CLUBS || []).filter(c => c.toLowerCase().includes(lc)).slice(0, 4));
    } else {
      setSuggestions([]);
    }
  };

  const valid = name.trim().length >= 2 && cls && card;

  return (
    <div className="modal-scrim" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{width: 'min(560px, 100%)'}}>
        <div className="modal-head">
          <span style={{width: 28, height: 28, borderRadius: 6, background: 'var(--dnf-soft)', color: 'var(--dnf)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700}}>⚠</span>
          <div>
            <h2>{t('walk.title')}</h2>
            <div className="muted" style={{fontSize: 13, marginTop: 2}}>{t('walk.desc')}</div>
          </div>
        </div>
        <div className="modal-body">
          <div style={{display: 'grid', gap: 16}}>
            <div className="field">
              <label>{t('walk.card')}</label>
              <input className="input mono" value={card} onChange={e => setCard(e.target.value)} inputMode="numeric" pattern="[0-9]*" />
            </div>
            <div className="field">
              <label>{t('walk.name')} *</label>
              <input className="input" autoFocus placeholder={t('walk.name.ph')} value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="field" style={{position: 'relative'}}>
              <label>{t('walk.club')}</label>
              <input className="input" placeholder={t('walk.club.ph')} value={club} onChange={e => onClubChange(e.target.value)} />
              {suggestions.length > 0 && (
                <div style={{position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg-elev)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius)', marginTop: 4, boxShadow: 'var(--shadow-md)', zIndex: 5}}>
                  {suggestions.map(s => (
                    <div key={s} onClick={() => { setClub(s); setSuggestions([]); }} style={{padding: '10px 12px', cursor: 'pointer', fontSize: 14, borderBottom: '1px solid var(--border)'}}>{s}</div>
                  ))}
                </div>
              )}
            </div>
            <div className="field">
              <label>{t('walk.class')} *</label>
              <select className="select" value={cls} onChange={e => setCls(e.target.value)}>
                {classes.map(c => (
                  <option key={c.id} value={c.id}>{c.name} — {c.course} ({c.length} km)</option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onCancel}>{t('walk.cancel')}</button>
          <button className="btn primary" disabled={!valid} onClick={() => valid && onSave({ name, club, cls, card })}
            style={!valid ? {opacity: 0.5, cursor: 'not-allowed'} : null}>
            {t('walk.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- EditCompetitorModal ----------
// Mirrors apps/web/src/lib/components/EditCompetitorModal.svelte —
// operator edits name / club / class / card for an existing competitor.
// Backed by PATCH /api/competitors/:id/profile in the real app.
function EditCompetitorModal({ t, competitor, classes, onCancel, onSave }) {
  const [name, setName] = useState(competitor?.name || '');
  const [club, setClub] = useState(competitor?.club || '');
  const [cls, setCls] = useState(competitor?.cls || classes[0]?.id || '');
  const [card, setCard] = useState(competitor?.cardNumber || '');
  const [saving, setSaving] = useState(false);

  const dirty = (
    name.trim() !== (competitor?.name || '') ||
    club.trim() !== (competitor?.club || '') ||
    cls !== competitor?.cls ||
    String(card) !== String(competitor?.cardNumber || '')
  );
  const valid = name.trim().length >= 2 && cls && card;

  const onSubmit = () => {
    if (!dirty) { onCancel(); return; }
    if (!valid) return;
    setSaving(true);
    // Simulate the round-trip — the real app PATCHes the bridge.
    setTimeout(() => {
      onSave({
        ...competitor,
        name: name.trim(),
        club: club.trim() || '—',
        cls,
        cardNumber: parseInt(card) || competitor?.cardNumber,
      });
    }, 320);
  };

  return (
    <div className="modal-scrim" onClick={!saving ? onCancel : undefined}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{width: 'min(520px, 100%)'}}>
        <div className="modal-head">
          <span style={{width: 28, height: 28, borderRadius: 6, background: 'var(--accent-soft)', color: 'var(--accent-strong)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700}}>✎</span>
          <div>
            <h2>{t('ro.editTitle')}</h2>
            <div className="muted" style={{fontSize: 13, marginTop: 2, fontFamily: 'var(--font-mono)'}}>
              SI {competitor?.cardNumber}
            </div>
          </div>
        </div>
        <div className="modal-body">
          <div style={{display: 'grid', gap: 16}}>
            <div className="field">
              <label>{t('walk.name')}</label>
              <input className="input" autoFocus value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="field">
              <label>{t('walk.club')}</label>
              <input className="input" value={club} onChange={e => setClub(e.target.value)} />
            </div>
            <div className="field">
              <label>{t('walk.class')}</label>
              <select className="select" value={cls} onChange={e => setCls(e.target.value)}>
                {classes.map(c => (
                  <option key={c.id} value={c.id}>{c.name} — {c.course}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>{t('walk.card')}</label>
              <input className="input mono" value={card} onChange={e => setCard(e.target.value)} inputMode="numeric" />
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onCancel} disabled={saving}>{t('walk.cancel')}</button>
          <button className="btn primary" disabled={saving || !valid} onClick={onSubmit}
            style={(saving || !valid) ? {opacity: 0.5, cursor: 'not-allowed'} : null}>
            {saving ? t('ro.editSaving') : t('ro.editSave')}
          </button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ReadoutView, StatusPill, WalkupModal, EditCompetitorModal });
