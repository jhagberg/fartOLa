// Print-only renderer: each screen on its own page
const { useState: pState } = React;
const tt = window.useT('sv');
const noop = () => {};

const LogoMark = () => (
  <svg viewBox="0 0 28 28" width="22" height="22" style={{display: 'block'}}>
    <g transform="rotate(45 14 14)">
      <rect x="4" y="4" width="20" height="10" fill="#ffffff" stroke="#1a1a1a" strokeWidth="1.4"/>
      <rect x="4" y="14" width="20" height="10" fill="#F36F21" stroke="#1a1a1a" strokeWidth="1.4"/>
    </g>
  </svg>
);

function PrintPage({ label, sub, children }) {
  return (
    <section className="print-page">
      <header className="print-head">
        <LogoMark />
        <b style={{fontSize: 14}}>fartOLa</b>
        <span className="print-tag muted">· Phase 1 · Single-laptop training MVP</span>
        <span className="print-label" style={{marginLeft: 'auto'}}>{label}</span>
        {sub && <span className="print-tag muted">{sub}</span>}
      </header>
      <div className="print-body">{children}</div>
    </section>
  );
}

/* ---------- Home page (no shell) ---------- */
function HomePrint() {
  return (
    <div className="print-content">
      <HomeView t={tt} competitions={window.MOCK_COMPETITIONS} onOpenWizard={noop} onOpenCompetition={noop} />
    </div>
  );
}

/* ---------- Wizard page — step 2, course imported ---------- */
function WizardPrint() {
  return (
    <div className="print-content" style={{position: 'relative', background: 'rgba(20,20,30,0.18)', minHeight: '100%'}}>
      <div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24}}>
        <div className="modal" style={{width: 720, position: 'relative', boxShadow: '0 20px 60px rgba(0,0,0,0.2)'}}>
          <div className="modal-head">
            <h2>Ny tävling</h2>
            <span className="muted mono" style={{marginLeft: 'auto', fontSize: 13}}>2/3</span>
          </div>
          <div className="wiz-steps" style={{display: 'flex', gap: 8, padding: '8px 22px 0'}}>
            <div className="wiz-step done"><span className="num">✓</span><span><b>Skapa tävling</b><span style={{fontSize: 11}}>Skapa</span></span></div>
            <div className="wiz-step active"><span className="num">2</span><span><b>Importera bana</b><span style={{fontSize: 11}}>Importera</span></span></div>
            <div className="wiz-step"><span className="num">3</span><span><b>Starta avläsning</b><span style={{fontSize: 11}}>Klar</span></span></div>
          </div>
          <div className="modal-body">
            <p className="muted" style={{margin: '0 0 16px'}}>Purple Pen .xml eller IOF XML 3.0 CourseData. Klasser skapas automatiskt.</p>
            <div className="drop-zone has-file">
              <div className="icon">✓</div>
              <div style={{fontSize: 15, fontWeight: 600}}>Importerad: onsdag-bana-v20.xml</div>
              <div style={{fontSize: 12, marginTop: 6}}>Klicka för att byta fil</div>
            </div>
            <div style={{marginTop: 16, padding: '10px 14px', background: 'var(--bg-sunken)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 13}}>
              <div style={{fontWeight: 600}}>Purple Pen / IOF CourseData</div>
              <div className="mono">onsdag-bana-v20.xml</div>
              <div className="muted" style={{fontSize: 12, marginTop: 4}}>Klassantal + kontrollantal verifieras serverside i steg 3.</div>
            </div>
          </div>
          <div className="modal-foot">
            <button className="btn ghost">← Tillbaka</button>
            <button className="btn ghost">Avbryt</button>
            <div style={{marginLeft: 'auto'}}></div>
            <button className="btn primary">Nästa →</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Readout page ---------- */
function ReadoutPrint({ read, tpl }) {
  return (
    <div className="print-content readout-print" data-tpl={tpl}>
      <ReadoutView t={tt} density="med"
        currentRead={read} history={window.MOCK_READS.slice(0, 6)}
        onSimulate={noop} onPrint={noop} onSelectRead={noop}
        walkupOpen={false} setWalkupOpen={noop} lastFlashKey={0}
        autoPrint={false} setAutoPrint={noop}
        defaultTpl={tpl} setDefaultTpl={noop} />
    </div>
  );
}

/* ---------- Walk-up modal page ---------- */
function WalkupPrint() {
  return (
    <div className="print-content readout-print" style={{position: 'relative', background: 'rgba(20,20,30,0.18)'}}>
      <ReadoutView t={tt} density="med"
        currentRead={{cardNumber: 9128344, unknown: true, readTime: '14:34:02', status: 'PEND'}}
        history={[{cardNumber: 9128344, unknown: true, readTime: '14:34:02', status: 'PEND'}, ...window.MOCK_READS.slice(0, 5)]}
        onSimulate={noop} onPrint={noop} onSelectRead={noop}
        walkupOpen={false} setWalkupOpen={noop} lastFlashKey={0}
        autoPrint={false} setAutoPrint={noop}
        defaultTpl="classic" setDefaultTpl={noop} />
      <div style={{position: 'absolute', inset: 0, background: 'rgba(20,20,30,0.32)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24}}>
        <div className="modal" style={{width: 560, position: 'relative', boxShadow: '0 20px 60px rgba(0,0,0,0.25)'}}>
          <div className="modal-head">
            <div>
              <h2>{tt('walk.title')}</h2>
              <div className="muted" style={{fontSize: 13, marginTop: 2}}>{tt('walk.desc')}</div>
            </div>
          </div>
          <div className="modal-body">
            <div style={{display: 'grid', gap: 16}}>
              <div className="field">
                <label>{tt('walk.name')}</label>
                <input className="input" defaultValue="Sara Lindgren" readOnly />
              </div>
              <div className="field">
                <label>{tt('walk.club')}</label>
                <input className="input" defaultValue="StorTuna OK" readOnly />
              </div>
              <div className="field">
                <label>{tt('walk.bana')}</label>
                <input className="input" defaultValue="D10" readOnly />
              </div>
              <div className="field">
                <label>{tt('walk.card')}</label>
                <input className="input mono" defaultValue="9128344" readOnly />
              </div>
              <label style={{display: 'flex', gap: 10, fontSize: 13, color: 'var(--fg-muted)'}}>
                <input type="checkbox" checked readOnly style={{marginTop: 3}} /><span>{tt('walk.consent')}</span>
              </label>
              <label style={{display: 'flex', gap: 10, fontSize: 13, color: 'var(--fg-muted)'}}>
                <input type="checkbox" readOnly style={{marginTop: 3}} /><span>{tt('walk.hyrbricka')}</span>
              </label>
            </div>
          </div>
          <div className="modal-foot">
            <button className="btn ghost">Avbryt</button>
            <button className="btn primary">Spara och bind</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Results page ---------- */
function ResultsPrint() {
  return (
    <div className="print-content">
      <ResultsView t={tt} fullscreen={false} setFullscreen={noop} initialClass="H21" />
    </div>
  );
}

function PrintApp() {
  const lead = window.MOCK_READS[0]; // H21 winner
  const mp = window.MOCK_READS[2]; // MP, with a struck control
  return (
    <div className="print-doc font-plex">
      <PrintPage label="01 · Tävlingar" sub="Home"><HomePrint /></PrintPage>
      <PrintPage label="02 · Ny tävling" sub="Wizard steg 2 av 3"><WizardPrint /></PrintPage>
      <PrintPage label={`03 · Avläsning · ${lead.name}`} sub="Kvitto: Klassisk"><ReadoutPrint read={lead} tpl="classic" /></PrintPage>
      <PrintPage label={`04 · Avläsning · ${lead.name}`} sub="Kvitto: Topp 4"><ReadoutPrint read={lead} tpl="top4" /></PrintPage>
      <PrintPage label={`05 · Avläsning · ${lead.name}`} sub="Kvitto: Detaljerad (sträckplaceringar)"><ReadoutPrint read={lead} tpl="detailed" /></PrintPage>
      <PrintPage label={`06 · Avläsning · ${mp.name}`} sub="Felstämpling · Kvitto: Klassläge"><ReadoutPrint read={mp} tpl="standing" /></PrintPage>
      <PrintPage label={`07 · Avläsning · ${lead.name}`} sub="Kvitto: Barn (Skogis)"><ReadoutPrint read={lead} tpl="kids" /></PrintPage>
      <PrintPage label={`08 · Avläsning · ${window.MOCK_READS[1].name}`} sub="Kvitto: Barn (Skogis)"><ReadoutPrint read={window.MOCK_READS[1]} tpl="kids" /></PrintPage>
      <PrintPage label={`09 · Avläsning · ${window.MOCK_READS[3].name}`} sub="Kvitto: Barn (Skogis)"><ReadoutPrint read={window.MOCK_READS[3]} tpl="kids" /></PrintPage>
      <PrintPage label="10 · Walk-up registrering" sub="Okänd bricka avläst"><WalkupPrint /></PrintPage>
      <PrintPage label="11 · Liveresultat" sub="H21"><ResultsPrint /></PrintPage>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<PrintApp />);
