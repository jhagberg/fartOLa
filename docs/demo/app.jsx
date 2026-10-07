// fartOLa Phase 1 prototype — app shell, routing, state
const { useState, useEffect, useMemo, useRef } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "locale": "sv",
  "density": "med",
  "accent": "forest",
  "contrast": false,
  "font": "plex"
}/*EDITMODE-END*/;

// Map accent key → CSS class on root
const ACCENT_CLASS = {
  forest: '',
  blue: 'accent-blue',
  magenta: 'accent-magenta',
  charcoal: 'accent-charcoal',
};

function App() {
  const [tw, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const t = useT(tw.locale);

  // Routing state
  const [route, setRoute] = useState('readout'); // home | readout | registration | results | export | hyrbrickor
  const [wizardOpen, setWizardOpen] = useState(false);
  const [walkupOpen, setWalkupOpen] = useState(false);
  const [walkupCard, setWalkupCard] = useState(null);
  const [editingCompetitor, setEditingCompetitor] = useState(null);
  const [resultsFullscreen, setResultsFullscreen] = useState(false);

  // Live state
  const [currentRead, setCurrentRead] = useState(window.MOCK_READS[0]);
  const [history, setHistory] = useState(window.MOCK_READS.slice(0, 6));
  const [pendingUnknown, setPendingUnknown] = useState(window.MOCK_PENDING_UNKNOWN || []);
  const [flashKey, setFlashKey] = useState(0);
  const [printedToast, setPrintedToast] = useState(false);
  const [clock, setClock] = useState('14:32:11');
  const [autoPrint, setAutoPrint] = useState(false);
  const [defaultTpl, setDefaultTpl] = useState('classic');

  useEffect(() => {
    let t = 14*3600 + 32*60 + 11; // 14:32:11 — wall clock at the readout table
    const id = setInterval(() => {
      t += 1;
      const h = (Math.floor(t/3600) % 24).toString().padStart(2,'0');
      const m = Math.floor((t%3600)/60).toString().padStart(2,'0');
      const s = (t%60).toString().padStart(2,'0');
      setClock(`${h}:${m}:${s}`);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Simulated card-read queue
  const simRef = useRef(0);
  const simulateRead = () => {
    // Every demo read in turn (the first is already on screen), with one walk-up unknown card
    // inserted after the third.
    const reads = window.MOCK_READS.slice(1);
    const candidates = [
      ...reads.slice(0, 3),
      { cardNumber: 9128344, unknown: true, readTime: clock, status: 'PEND' },
      ...reads.slice(3),
    ];
    const next = candidates[simRef.current % candidates.length];
    simRef.current += 1;
    setCurrentRead(next);
    setHistory(h => [next, ...h].slice(0, 12));
    setFlashKey(k => k + 1);
    if (next.unknown) {
      setPendingUnknown(p => p.includes(next.cardNumber) ? p : [next.cardNumber, ...p]);
      setTimeout(() => { setWalkupCard(next.cardNumber); setWalkupOpen(true); }, 600);
    } else if (autoPrint && next.punches) {
      setTimeout(() => onPrint(), 400);
    }
  };

  const onPrint = () => {
    setPrintedToast(true);
    setTimeout(() => setPrintedToast(false), 2000);
  };

  const onWalkupSave = ({ name, club, cls, card }) => {
    const parsedCard = parseInt(card, 10);
    const completed = {
      cardNumber: Number.isNaN(parsedCard) ? 9128344 : parsedCard,
      name, club: club || '—', cls,
      readTime: clock,
      startTime: '14:02:00',
      elapsed: '30:11',
      status: 'OK',
      place: null,
    };
    setCurrentRead(completed);
    setHistory(h => [completed, ...h.slice(1)]);
    setPendingUnknown(p => p.filter(c => c !== completed.cardNumber));
    setWalkupOpen(false);
    setWalkupCard(null);
  };

  const onEdit = (read) => {
    setEditingCompetitor(read);
  };

  const onEditSave = (updated) => {
    // Replace in history + currentRead by card number.
    setHistory(h => h.map(r => r.cardNumber === updated.cardNumber ? { ...r, ...updated } : r));
    setCurrentRead(r => r && r.cardNumber === updated.cardNumber ? { ...r, ...updated } : r);
    setEditingCompetitor(null);
  };

  const onManualDnf = (read, reason) => {
    const patch = { status: 'DNF', dnfReason: reason, place: null };
    setHistory(h => h.map(r => r.cardNumber === read.cardNumber ? { ...r, ...patch } : r));
    setCurrentRead(r => r && r.cardNumber === read.cardNumber ? { ...r, ...patch } : r);
  };

  const onUnDnf = (read) => {
    const patch = { status: 'OK', dnfReason: null };
    setHistory(h => h.map(r => r.cardNumber === read.cardNumber ? { ...r, ...patch } : r));
    setCurrentRead(r => r && r.cardNumber === read.cardNumber ? { ...r, ...patch } : r);
  };

  const onPickPending = (cardNumber) => {
    setWalkupCard(cardNumber);
    setWalkupOpen(true);
  };

  const rootClass = [
    ACCENT_CLASS[tw.accent] || '',
    tw.contrast ? 'contrast-high' : '',
    'font-' + (tw.font || 'plex'),
  ].filter(Boolean).join(' ');

  return (
    <div className={'app ' + rootClass}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-label="Control flag">
            <svg viewBox="0 0 28 28">
              <g transform="rotate(45 14 14)">
                <rect x="4" y="4" width="20" height="10" fill="#ffffff" stroke="#1a1a1a" strokeWidth="1.4"/>
                <rect x="4" y="14" width="20" height="10" fill="#F36F21" stroke="#1a1a1a" strokeWidth="1.4"/>
              </g>
            </svg>
          </span>
          <span>
            <span className="brand-name">{t('app.title')}</span>
          </span>
        </div>

        <button className={'nav-item ' + (route === 'home' ? 'active' : '')} onClick={() => setRoute('home')}>
          <span style={{width: 16, textAlign: 'center'}}>◇</span> {t('nav.competitions')}
        </button>
        <button className={'nav-item ' + (route === 'readout' ? 'active' : '')} onClick={() => setRoute('readout')}>
          <span className="dot"></span> {t('nav.readout')}
        </button>
        <button className={'nav-item ' + (route === 'registration' ? 'active' : '')} onClick={() => setRoute('registration')}>
          <span style={{width: 16, textAlign: 'center'}}>⌗</span> {t('nav.registration')}
        </button>
        <button className={'nav-item ' + (route === 'results' ? 'active' : '')} onClick={() => setRoute('results')}>
          <span style={{width: 16, textAlign: 'center'}}>≣</span> {t('nav.results')}
        </button>
        <button className={'nav-item ' + (route === 'export' ? 'active' : '')} onClick={() => setRoute('export')}>
          <span style={{width: 16, textAlign: 'center'}}>↗</span> {t('nav.export')}
          <span className="badge" style={{fontSize: 9}}>IOF 3.0</span>
        </button>
        <button className={'nav-item ' + (route === 'hyrbrickor' ? 'active' : '')} onClick={() => setRoute('hyrbrickor')}>
          <span style={{width: 16, textAlign: 'center'}}>⌬</span> {t('nav.hyrbrickor')}
        </button>
        {/* Opens the tweaks panel, as in the app. The panel listens for this message. */}
        <button className="nav-item" onClick={() => window.postMessage({ type: '__activate_edit_mode' }, '*')}>
          <span style={{width: 16, textAlign: 'center'}}>⚙</span> {t('nav.settings')}
        </button>

        <div className="sidebar-footer">
          <div className="station-card">
            <div className="row"><b style={{fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--fg-muted)'}}>{t('ro.station')}</b></div>
            <div className="row"><span className="pulse-dot"></span><b className="mono" style={{fontSize: 12}}>BSM7-USB</b></div>
            <div className="row" style={{justifyContent: 'space-between'}}><span className="mono faint">—</span><span style={{color: 'var(--ok)', fontSize: 11}}>● {t('ro.online')}</span></div>
            <div className="row" style={{justifyContent: 'space-between', fontSize: 11}}><span className="faint">/dev/ttyUSB0</span><span className="mono faint">38400</span></div>
          </div>
          <div style={{fontSize: 11, color: 'var(--fg-faint)', fontFamily: 'var(--font-mono)'}}>v0.1.0-phase1 · localhost</div>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <div className="spacer"></div>
          <div className="row" style={{fontSize: 13}}>
            <span className="pulse-dot"></span>
            <span style={{color: 'var(--ok)', fontWeight: 500}}>{t('ro.online')}</span>
          </div>
          <div className="clock mono" title="Lokal tid · TID">
            <span style={{fontSize: 10, color: 'var(--fg-muted)', marginRight: 6, fontFamily: 'var(--font-ui)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500}}>TID</span>
            {clock}
          </div>
        </div>

        <div className="content">
          {route === 'home' && (
            <HomeView t={t}
              competitions={window.MOCK_COMPETITIONS}
              onOpenWizard={() => setWizardOpen(true)}
              onOpenCompetition={() => setRoute('readout')}
            />
          )}
          {route === 'readout' && (
            <ReadoutView
              t={t}
              density={tw.density}
              currentRead={currentRead}
              history={history}
              pendingUnknown={pendingUnknown}
              onSimulate={simulateRead}
              onPrint={onPrint}
              onSelectRead={r => { setCurrentRead(r); setFlashKey(k => k + 1); }}
              walkupOpen={walkupOpen}
              setWalkupOpen={setWalkupOpen}
              lastFlashKey={flashKey}
              autoPrint={autoPrint}
              setAutoPrint={setAutoPrint}
              defaultTpl={defaultTpl}
              setDefaultTpl={setDefaultTpl}
              onEdit={onEdit}
              onManualDnf={onManualDnf}
              onUnDnf={onUnDnf}
              onPickPending={onPickPending}
            />
          )}
          {route === 'results' && (
            <ResultsView t={t} fullscreen={resultsFullscreen} setFullscreen={setResultsFullscreen} />
          )}
          {route === 'export' && (
            <ExportView t={t} />
          )}
          {route === 'registration' && (
            <RegistrationDeskView t={t} queue={window.MOCK_PHASE2.registrationQueue} classes={window.MOCK_CLASSES} />
          )}
          {route === 'hyrbrickor' && (
            <HyrbrickorView t={t} rows={window.MOCK_PHASE2.hyrbrickor} />
          )}
        </div>
      </main>

      {wizardOpen && (
        <NewCompetitionWizard
          t={t}
          onCancel={() => setWizardOpen(false)}
          onComplete={() => { setWizardOpen(false); setRoute('readout'); }}
        />
      )}

      {walkupOpen && (
        <WalkupModal
          t={t}
          cardNumber={walkupCard || (currentRead && currentRead.unknown ? currentRead.cardNumber : 9128344)}
          classes={window.MOCK_CLASSES}
          onCancel={() => { setWalkupOpen(false); setWalkupCard(null); }}
          onSave={onWalkupSave}
        />
      )}

      {editingCompetitor && (
        <EditCompetitorModal
          t={t}
          competitor={editingCompetitor}
          classes={window.MOCK_CLASSES}
          onCancel={() => setEditingCompetitor(null)}
          onSave={onEditSave}
        />
      )}

      {printedToast && (
        <div style={{position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: 'var(--fg)', color: 'var(--bg)', padding: '12px 20px', borderRadius: 8, fontSize: 14, boxShadow: 'var(--shadow-lg)', zIndex: 90, fontWeight: 500}}>
          {t('ro.printed')}
        </div>
      )}

      <TweaksPanel title={t('tw.title')}>
        <TweakRadio
          label={t('tw.locale')}
          value={tw.locale}
          options={[{ value: 'sv', label: 'Svenska' }, { value: 'en', label: 'English' }]}
          onChange={v => setTweak('locale', v)}
        />
        <TweakRadio
          label={t('tw.density')}
          value={tw.density}
          options={['low', 'med', 'high'].map(d => ({ value: d, label: t('tw.density.' + d) }))}
          onChange={v => setTweak('density', v)}
        />
        <TweakColor
          label={t('tw.accent')}
          value={tw.accent}
          options={[
            { value: 'forest', color: '#2f7c4f' },
            { value: 'blue', color: '#2a6fdb' },
            { value: 'magenta', color: '#b03a8a' },
            { value: 'charcoal', color: '#3a3a3a' },
          ].map(o => o.color)}
          onChange={v => {
            const m = {'#2f7c4f':'forest','#2a6fdb':'blue','#b03a8a':'magenta','#3a3a3a':'charcoal'};
            setTweak('accent', m[v] || 'forest');
          }}
        />
        <TweakToggle
          label={t('tw.contrast')}
          value={tw.contrast}
          onChange={v => setTweak('contrast', v)}
        />
        <TweakSelect
          label={t('tw.font')}
          value={tw.font}
          options={['plex', 'geist', 'source', 'atkinson']}
          onChange={v => setTweak('font', v)}
        />
        <TweakRow label={t('tweaks.eventor.title')}>
          <span style={{color: 'var(--ok)'}}>●</span> {t('tweaks.eventor.ready', { days: window.MOCK_PHASE2.integrations.eventor.cacheAgeDays })}
        </TweakRow>
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
