// Registration desk and Hyrbrickor — mirror apps/web/src/lib/screens/RegistrationView.svelte
// and ActiveHyrbrickorView.svelte (wording from the app's i18n catalog).
//
// Components are loaded as globals so app.jsx can reference them without imports.
const { useState: useStateP2 } = React;

// ─────────────────────────────────────────────────────────────────────────────
// RegistrationDeskView — manual card entry, the queue of cards waiting, and the
// walk-up modal for the first card; saving or cancelling opens the next one.
// ─────────────────────────────────────────────────────────────────────────────
function RegistrationDeskView({ t, queue: initialQueue, classes }) {
  const initial = (initialQueue || []).map(q => ({
    cardNumber: q.cardNumber,
    hint: q.name && q.source === 'eventor' ? q.name : null,
  }));
  const [current, setCurrent] = useStateP2(initial[0] || null);
  const [queue, setQueue] = useStateP2(initial.slice(1));
  const [manual, setManual] = useStateP2('');
  const [manualError, setManualError] = useStateP2(null);
  const [toast, setToast] = useStateP2(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  // Close the modal and pop the next queued card, as the app does.
  const advance = () => {
    setCurrent(queue[0] || null);
    setQueue(queue.slice(1));
  };

  const submitManual = (e) => {
    e.preventDefault();
    const card = parseInt(manual.trim(), 10);
    if (!/^\d+$/.test(manual.trim()) || card < 1) return setManualError(t('registration.manualEntry.invalid'));
    setManualError(null);
    setManual('');
    if ((current && current.cardNumber === card) || queue.some(q => q.cardNumber === card)) {
      return showToast(t('registration.dedupeToast', { card }));
    }
    if (!current) setCurrent({ cardNumber: card, hint: null });
    else setQueue([...queue, { cardNumber: card, hint: null }]);
  };

  // Open a queued card now; the card that was open goes back to the front of the queue.
  const openQueued = (card) => {
    const picked = queue.find(q => q.cardNumber === card);
    setQueue([...(current ? [current] : []), ...queue.filter(q => q.cardNumber !== card)]);
    setCurrent(picked);
  };

  const count = queue.length + (current ? 1 : 0);

  return (
    <div className="registration">
      <style>{`
        .registration { display: flex; flex-direction: column; gap: 24px; position: relative; }
        .reg-head { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
        .reg-head h1 { margin: 0; font-size: 22px; font-weight: 600; }
        .reg-head .welcome { margin: 0; color: var(--fg-muted); font-size: 14px; }
        .reg-head .badge { align-self: flex-start; margin-top: 6px; background: var(--accent); color: #fff; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-family: var(--font-mono); }
        .reg-empty { margin: 0; padding: 32px 24px; text-align: center; color: var(--fg-muted); background: var(--bg-elev); border: 1px dashed var(--border); border-radius: var(--radius-lg); font-size: 15px; }
        .manual-row { display: flex; gap: 12px; align-items: stretch; }
        .manual-input { flex: 1; height: var(--hit); padding: 0 12px; background: var(--bg-elev); border: 1px solid var(--border-strong); border-radius: var(--radius); font-size: 16px; font-family: var(--font-mono); color: var(--fg); }
        .manual-input:focus { outline: 2px solid var(--accent); outline-offset: -1px; border-color: var(--accent); }
        .manual-btn { height: var(--hit); padding: 0 16px; border: 1px solid var(--accent); border-radius: var(--radius); background: var(--accent); color: var(--accent-fg); font-size: 14px; font-weight: 500; cursor: pointer; white-space: nowrap; }
        .manual-btn:disabled { opacity: 0.55; cursor: not-allowed; }
        .manual-err { margin: -4px 0 0; color: var(--dnf); font-size: 13px; }
        .reg-queue { background: var(--bg-elev); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; }
        .reg-queue-head { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
        .reg-queue-head h2 { margin: 0; font-size: 14px; font-weight: 600; }
        .reg-queue-count { display: inline-flex; align-items: center; height: 22px; padding: 0 8px; background: var(--mp-soft); color: oklch(0.45 0.12 70); border-radius: 999px; font-size: 12px; font-weight: 600; }
        .reg-queue-items { list-style: none; margin: 0; padding: 8px; display: grid; gap: 4px; }
        .reg-queue-chip { width: 100%; display: flex; align-items: center; gap: 12px; height: var(--hit); padding: 0 16px; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); color: var(--fg); font-size: 14px; text-align: left; cursor: pointer; }
        .reg-queue-chip:hover { background: var(--bg-sunken); border-color: var(--border-strong); }
        .reg-queue-chip .mono { font-family: var(--font-mono); font-weight: 600; }
        .reg-queue-chip .hint { color: var(--fg-muted); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .reg-queue-chip .cta { margin-left: auto; color: var(--accent); font-size: 13px; font-weight: 600; }
        .reg-toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: var(--fg); color: var(--bg-elev); padding: 10px 18px; border-radius: var(--radius); font-size: 13px; box-shadow: var(--shadow-lg); z-index: 100; }
      `}</style>

      <header className="reg-head">
        <h1>{t('registration.title')}</h1>
        <p className="welcome">{t('registration.welcome')}</p>
        {count > 0 && <span className="badge">{t('registration.queuedBadge', { count })}</span>}
      </header>

      <form className="manual-row" onSubmit={submitManual}>
        <input className="manual-input" type="tel" inputMode="numeric" autoComplete="off"
          value={manual} onChange={e => setManual(e.target.value)}
          placeholder={t('registration.manualEntry.placeholder')}
          aria-label={t('registration.manualEntry.placeholder')} />
        <button className="manual-btn" type="submit" disabled={manual.trim() === ''}>
          {t('registration.manualEntry.submit')}
        </button>
      </form>
      {manualError && <p className="manual-err" role="alert">{manualError}</p>}

      {queue.length > 0 && (
        <section className="reg-queue">
          <header className="reg-queue-head">
            <h2>{t('registration.queueHeading')}</h2>
            <span className="reg-queue-count mono">{queue.length}</span>
          </header>
          <ul className="reg-queue-items">
            {queue.map(q => (
              <li key={q.cardNumber}>
                <button type="button" className="reg-queue-chip" onClick={() => openQueued(q.cardNumber)}>
                  <span className="mono">{q.cardNumber}</span>
                  {q.hint && <span className="hint">{q.hint}</span>}
                  <span className="cta">{t('registration.queue.open')}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!current && queue.length === 0 && <p className="reg-empty">{t('registration.empty')}</p>}

      {current && (
        <WalkupModal
          key={current.cardNumber}
          t={t}
          cardNumber={current.cardNumber}
          classes={classes}
          onCancel={advance}
          onSave={advance}
        />
      )}

      {toast && <div className="reg-toast" role="status">{toast}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HyrbrickorView — open and returned rentals, as two sections
// ─────────────────────────────────────────────────────────────────────────────
function HyrbrickorView({ t, rows: initialRows }) {
  const [rows, setRows] = useStateP2(initialRows || []);
  const open = rows.filter(r => !r.returnedAt);
  const returned = rows.filter(r => r.returnedAt);

  const markReturned = (cardNumber) => {
    const now = new Date().toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
    setRows(rs => rs.map(r => r.cardNumber === cardNumber ? { ...r, returnedAt: now } : r));
  };

  return (
    <section className="hyrbrickor-view">
      <style>{`
        .hyrbrickor-view { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
        .hyrbrickor-view .title { margin: 0; font-size: 22px; font-weight: 600; }
        .hyrbrickor-view .card { background: var(--bg-elev); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; }
        .hyrbrickor-view .section-head { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
        .hyrbrickor-view .section-head h2 { margin: 0; font-size: 14px; font-weight: 600; }
        .hyrbrickor-view .badge { margin-left: auto; font-family: var(--font-mono); font-size: 11px; background: var(--dnf-soft); color: var(--dnf); padding: 2px 8px; border-radius: 999px; }
        .hyrbrickor-view .muted-badge { background: var(--bg-sunken); color: var(--fg-muted); }
        .hyrbrickor-view .row-list { list-style: none; margin: 0; padding: 0; }
        .hyrbrickor-view .row { display: flex; flex-direction: column; align-items: stretch; gap: 4px; padding: 10px 14px; }
        .hyrbrickor-view .row + .row { border-top: 1px solid var(--border); }
        .hyrbrickor-view .row.returned { opacity: 0.75; }
        .hyrbrickor-view .card-line { display: flex; align-items: baseline; gap: 8px; }
        .hyrbrickor-view .lbl-card { font-size: 14px; font-weight: 600; font-family: var(--font-mono); }
        .hyrbrickor-view .small { font-size: 12px; }
        .hyrbrickor-view .contact-line { display: flex; gap: 8px; font-size: 13px; flex-wrap: wrap; align-items: center; }
        .hyrbrickor-view .contact-line > span, .hyrbrickor-view .contact-line > a { display: inline-flex; align-items: center; min-height: 44px; padding: 8px 10px; border-radius: 6px; }
        .hyrbrickor-view .contact-line > span { padding-left: 0; }
        .hyrbrickor-view .contact-line a { color: var(--accent); text-decoration: none; }
        .hyrbrickor-view .contact-line a:hover { background: var(--bg-sunken); text-decoration: underline; }
        .hyrbrickor-view .note { margin: 0; }
        .hyrbrickor-view .actions { display: flex; justify-content: flex-end; margin-top: 4px; }
      `}</style>

      <header>
        <h1 className="title">{t('hyrbrickor.title')}</h1>
      </header>

      {open.length === 0 && returned.length === 0 && <p className="muted">{t('hyrbrickor.empty')}</p>}

      {open.length > 0 && (
        <section className="card">
          <header className="section-head">
            <h2>{t('hyrbrickor.openSection')}</h2>
            <span className="badge">{open.length}</span>
          </header>
          <ul className="row-list">
            {open.map(r => (
              <li className="row" key={r.cardNumber}>
                <div className="card-line">
                  <span className="lbl-card">{r.cardNumber}</span>
                  <span className="muted small">{t('hyrbrickor.markedAt', { time: r.markedAt })}</span>
                </div>
                <div className="contact-line">
                  {r.contactName && <span>{r.contactName}</span>}
                  {r.contactPhone && <a href={`tel:${r.contactPhone}`}>{r.contactPhone}</a>}
                  {r.contactEmail && <a href={`mailto:${r.contactEmail}`}>{r.contactEmail}</a>}
                </div>
                {r.note && <p className="note muted small">{r.note}</p>}
                <div className="actions">
                  <button className="btn primary sm" onClick={() => markReturned(r.cardNumber)}>
                    {t('hyrbrickor.returnedBtn')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {returned.length > 0 && (
        <section className="card">
          <header className="section-head">
            <h2>{t('hyrbrickor.returnedSection')}</h2>
            <span className="badge muted-badge">{returned.length}</span>
          </header>
          <ul className="row-list">
            {returned.map(r => (
              <li className="row returned" key={r.cardNumber}>
                <div className="card-line">
                  <span className="lbl-card">{r.cardNumber}</span>
                  <span className="muted small">
                    {t('hyrbrickor.markedAt', { time: r.markedAt })} · {t('hyrbrickor.returnedAt', { time: r.returnedAt })}
                  </span>
                </div>
                {r.contactName && <div className="contact-line"><span>{r.contactName}</span></div>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

Object.assign(window, { RegistrationDeskView, HyrbrickorView });
