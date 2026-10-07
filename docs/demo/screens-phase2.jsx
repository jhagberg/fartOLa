// Phase 2 — 4-klubbs MVP demo surfaces:
//   - Phase2StatusStrip   topbar pill showing MeOS bridge + Eventor cache + Hyrbricka counts
//   - RegistrationDeskView /registration screen w/ card-beep queue + auto-advance
//   - HyrbrickorView      /hyrbrickor admin list w/ contact info + Returnerad button
//
// Components are loaded as globals so app.jsx can reference them without imports.

const { useState: useStateP2, useMemo: useMemoP2 } = React;

// ─────────────────────────────────────────────────────────────────────────────
// Phase2StatusStrip — compact horizontal pills in the topbar
// ─────────────────────────────────────────────────────────────────────────────
function Phase2StatusStrip({ phase2 }) {
  if (!phase2 || !phase2.integrations) return null;
  const { meos, eventor } = phase2.integrations;
  const openRentals = (phase2.hyrbrickor || []).filter(h => !h.returnedAt).length;

  const dot = (color) => ({
    width: 7, height: 7, borderRadius: '50%',
    background: color, display: 'inline-block',
    boxShadow: `0 0 0 3px color-mix(in srgb, ${color} 20%, transparent)`,
  });

  return (
    <div className="phase2-strip" style={{
      display: 'flex', gap: 14, alignItems: 'center',
      fontFamily: 'var(--font-mono)', fontSize: 11,
      padding: '4px 10px',
      background: 'var(--bg-sunken)',
      border: '1px solid var(--border)',
      borderRadius: 6,
      marginRight: 8,
    }}>
      <span style={{display: 'inline-flex', alignItems: 'center', gap: 6}}
            title={`MeOS-brygga · MIP senast ${meos.mipLastPollSec}s · MOP senast ${meos.mopLastPushSec}s · ${meos.entriesSent} entries skickade · ${meos.cmpReceived} cmp mottagna`}>
        <span style={dot('var(--ok)')}></span>
        <b style={{color: 'var(--fg)'}}>MeOS</b>
        <span style={{color: 'var(--fg-muted)'}}>{meos.mipLastPollSec}s</span>
      </span>
      <span style={{display: 'inline-flex', alignItems: 'center', gap: 6}}
            title={`Eventor cachedcompetitors · ${eventor.competitorCount.toLocaleString('sv-SE')} löpare · ${eventor.cardCount.toLocaleString('sv-SE')} brickor · senast ${eventor.lastRefreshed}`}>
        <span style={dot('var(--ok)')}></span>
        <b style={{color: 'var(--fg)'}}>Eventor</b>
        <span style={{color: 'var(--fg-muted)'}}>{eventor.cacheAgeDays}d</span>
      </span>
      <span style={{display: 'inline-flex', alignItems: 'center', gap: 6}}
            title={`${openRentals} hyrbrickor utlämnade men inte återlämnade`}>
        <span style={dot(openRentals > 0 ? 'var(--warn)' : 'var(--ok)')}></span>
        <b style={{color: 'var(--fg)'}}>Hyr</b>
        <span style={{color: 'var(--fg-muted)'}}>{openRentals} öpp.</span>
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RegistrationDeskView — card-beep queue + active form + auto-advance demo
// ─────────────────────────────────────────────────────────────────────────────
function RegistrationDeskView({ t, queue: initialQueue, classes, onSaved }) {
  const [queue, setQueue] = useStateP2(initialQueue || []);
  const [active, setActive] = useStateP2(queue[0] || null);
  const [cls, setCls] = useStateP2('H10');
  const [hired, setHired] = useStateP2(active && active.source === 'rental');
  const [contact, setContact] = useStateP2('');

  const advance = () => {
    setQueue(prev => {
      const next = prev.slice(1);
      const nextActive = next[0] || null;
      setActive(nextActive);
      setHired(nextActive && nextActive.source === 'rental');
      setContact('');
      setCls(nextActive && nextActive.cls ? nextActive.cls : 'H10');
      return next;
    });
    if (onSaved) onSaved();
  };

  if (!active) {
    return (
      <div style={{display: 'grid', placeItems: 'center', padding: '80px 24px', textAlign: 'center'}}>
        <div style={{
          width: 96, height: 96, borderRadius: '50%',
          border: '2px dashed var(--border-strong)',
          display: 'grid', placeItems: 'center',
          color: 'var(--fg-faint)', fontFamily: 'var(--font-mono)',
          marginBottom: 18,
        }}>0</div>
        <h2 style={{margin: '0 0 6px', fontSize: 22, letterSpacing: '-0.01em'}}>Kön är tom.</h2>
        <p style={{color: 'var(--fg-muted)', margin: 0}}>
          Pipa en bricka på masterläsaren för att lägga till i kön.
        </p>
      </div>
    );
  }

  return (
    <div style={{display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 18}}>
      <style>{`
        .rd-card { background: var(--bg-elev); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 24px; }
        .rd-num { font-family: var(--font-mono); font-size: 48px; font-weight: 500; letter-spacing: -0.02em; color: var(--accent-strong); line-height: 1; }
        .rd-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--fg-muted); font-weight: 600; }
        .rd-prefill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 8px; background: var(--accent-soft); color: var(--accent-strong); border-radius: 4px; font-family: var(--font-mono); font-size: 11px; font-weight: 600; }
        .rd-field { display: grid; gap: 6px; margin-top: 14px; }
        .rd-field label { font-size: 12px; color: var(--fg-muted); font-weight: 500; }
        .rd-field input, .rd-field select {
          padding: 10px 12px; border: 1px solid var(--border-strong); border-radius: 6px;
          font: inherit; background: var(--bg);
        }
        .rd-checkbox { display: flex; gap: 10px; align-items: center; padding: 10px 14px; background: var(--bg-sunken); border-radius: 6px; margin-top: 12px; cursor: pointer; }
        .rd-checkbox input { width: 18px; height: 18px; }
        .rd-actions { display: flex; gap: 10px; margin-top: 22px; }
        .rd-queue { background: var(--bg-elev); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px; display: flex; flex-direction: column; gap: 8px; }
        .rd-q-row { display: grid; grid-template-columns: 24px 1fr auto; gap: 10px; align-items: center; padding: 8px 0; font-size: 13px; border-bottom: 1px dashed var(--border); }
        .rd-q-row:last-child { border-bottom: 0; }
        .rd-q-pos { font-family: var(--font-mono); font-size: 11px; color: var(--fg-faint); text-align: center; }
        .rd-q-num { font-family: var(--font-mono); font-weight: 600; color: var(--accent-strong); }
        .rd-q-name { color: var(--fg-muted); font-size: 12px; }
        .rd-q-tag { font-family: var(--font-mono); font-size: 10px; padding: 2px 6px; border-radius: 3px; }
        .rd-q-tag.eventor { background: var(--accent-soft); color: var(--accent-strong); }
        .rd-q-tag.rental { background: oklch(0.95 0.07 80); color: oklch(0.40 0.13 75); }
        .rd-q-tag.unknown { background: var(--bg-sunken); color: var(--fg-muted); border: 1px dashed var(--border-strong); }
      `}</style>

      <div className="rd-card">
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16}}>
          <div>
            <div className="rd-label">Aktiv bricka</div>
            <div className="rd-num" style={{marginTop: 4}}>{active.cardNumber}</div>
            {active.name && (
              <div style={{marginTop: 10, display: 'flex', gap: 10, alignItems: 'center'}}>
                <b style={{fontSize: 22}}>{active.name}</b>
                {active.source === 'eventor' && <span className="rd-prefill">EVENTOR · auto-fyllt</span>}
              </div>
            )}
            {!active.name && active.source === 'unknown' && (
              <div style={{marginTop: 10, color: 'var(--fg-muted)'}}>Okänd bricka — ej i Eventor-cachen.</div>
            )}
            {active.source === 'rental' && (
              <div style={{marginTop: 10, color: 'oklch(0.40 0.13 75)', fontWeight: 600, fontSize: 14}}>● Hyrbricka — ta kontaktuppgifter</div>
            )}
          </div>
          <span style={{fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-faint)'}}>kö {queue.length}</span>
        </div>

        <div className="rd-field">
          <label>Bana</label>
          <select value={cls} onChange={(e) => setCls(e.target.value)}>
            {classes.map(c => <option key={c.id} value={c.id}>{c.name} · {c.course}</option>)}
          </select>
        </div>

        <div className="rd-field">
          <label>Namn {active.source === 'eventor' && <span style={{color: 'var(--accent-strong)'}}>(förifyllt)</span>}</label>
          <input type="text" defaultValue={active.name || ''} placeholder="Skriv löparens namn" />
        </div>

        <label className="rd-checkbox">
          <input type="checkbox" checked={hired} onChange={(e) => setHired(e.target.checked)} />
          <span><b>Hyrbricka</b> — operatören är ansvarig för att brickan kommer tillbaka</span>
        </label>

        {hired && (
          <div className="rd-field">
            <label>Kontakt (telefon eller e-post — minst en krävs)</label>
            <input type="text" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="070-555 00 00 eller namn@example.com" />
          </div>
        )}

        <div className="rd-actions">
          <button className="btn primary" onClick={advance} disabled={hired && contact.trim() === ''}>
            ✓ Spara · auto-advance
          </button>
          <button className="btn" onClick={() => setQueue(q => [...q.slice(1), q[0]])}>↻ Skippa till slut</button>
        </div>
      </div>

      <div className="rd-queue">
        <div className="rd-label" style={{marginBottom: 8}}>Kö ({queue.length})</div>
        {queue.length === 0 && <div style={{color: 'var(--fg-faint)', fontSize: 13, textAlign: 'center', padding: '20px 0'}}>Inget i kö.</div>}
        {queue.map((q, i) => (
          <div className="rd-q-row" key={`${q.cardNumber}-${i}`}>
            <span className="rd-q-pos">{i === 0 ? '▸' : i + 1}</span>
            <div>
              <span className="rd-q-num">{q.cardNumber}</span>
              {q.name && <div className="rd-q-name">{q.name}{q.age ? ` · ${q.age} år` : ''}</div>}
            </div>
            <span className={`rd-q-tag ${q.source}`}>
              {q.source === 'eventor' && 'EVTR'}
              {q.source === 'rental' && 'HYR'}
              {q.source === 'unknown' && '?'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HyrbrickorView — admin-backstop list of open + returned rentals
// ─────────────────────────────────────────────────────────────────────────────
function HyrbrickorView({ t, rows: initialRows, onReturn }) {
  const [rows, setRows] = useStateP2(initialRows || []);
  const [filter, setFilter] = useStateP2('open'); // open | returned | all

  const visible = useMemoP2(() => {
    if (filter === 'all') return rows;
    if (filter === 'open') return rows.filter(r => !r.returnedAt);
    return rows.filter(r => r.returnedAt);
  }, [rows, filter]);

  const markReturned = (cardNumber) => {
    const now = new Date().toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
    setRows(rs => rs.map(r => r.cardNumber === cardNumber ? { ...r, returnedAt: now } : r));
    if (onReturn) onReturn();
  };

  const openCount = rows.filter(r => !r.returnedAt).length;
  const returnedCount = rows.length - openCount;

  return (
    <div>
      <style>{`
        .hb-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 18px; gap: 16px; flex-wrap: wrap; }
        .hb-title { font-size: 22px; font-weight: 600; margin: 0; letter-spacing: -0.01em; }
        .hb-sub { color: var(--fg-muted); font-size: 14px; margin: 4px 0 0; }
        .hb-tabs { display: inline-flex; background: var(--bg-sunken); border: 1px solid var(--border); border-radius: 8px; padding: 3px; }
        .hb-tab { padding: 7px 14px; background: transparent; border: 0; border-radius: 6px; font-family: inherit; font-size: 13px; color: var(--fg-muted); cursor: pointer; }
        .hb-tab.active { background: var(--bg-elev); color: var(--fg); font-weight: 600; box-shadow: var(--shadow-sm); }
        .hb-table { width: 100%; border-collapse: collapse; background: var(--bg-elev); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; }
        .hb-table th, .hb-table td { padding: 12px 16px; text-align: left; border-bottom: 1px solid var(--border); font-size: 14px; }
        .hb-table tr:last-child td { border-bottom: 0; }
        .hb-table th { background: var(--bg-sunken); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--fg-muted); font-weight: 600; }
        .hb-card-num { font-family: var(--font-mono); font-weight: 600; color: var(--accent-strong); }
        .hb-contact { display: flex; flex-direction: column; gap: 2px; font-size: 13px; }
        .hb-contact .name { font-weight: 600; }
        .hb-contact .ch { color: var(--fg-muted); font-size: 12px; font-family: var(--font-mono); }
        .hb-note { color: var(--fg-muted); font-style: italic; font-size: 12px; max-width: 280px; }
        .hb-time { font-family: var(--font-mono); font-size: 12px; color: var(--fg-muted); }
        .hb-return-btn { padding: 6px 12px; background: var(--accent); color: var(--accent-fg); border: 1px solid var(--accent); border-radius: 6px; font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
        .hb-return-btn:hover { background: var(--accent-strong); }
        .hb-pill-returned { padding: 3px 9px; background: color-mix(in srgb, var(--ok) 20%, var(--bg)); color: var(--ok); border-radius: 999px; font-family: var(--font-mono); font-size: 11px; font-weight: 600; }
      `}</style>

      <div className="hb-head">
        <div>
          <h2 className="hb-title">Hyrbrickor</h2>
          <p className="hb-sub">
            Backstop-vy för admin. {openCount} öppna, {returnedCount} återlämnade. Vid finishreadout pop:ar en toast med kontaktinfo + Returnerad-knapp. PII scrubbas efter 30 dagar (REQ-PRIV-002).
          </p>
        </div>
        <div className="hb-tabs">
          <button className={`hb-tab ${filter === 'open' ? 'active' : ''}`} onClick={() => setFilter('open')}>Öppna ({openCount})</button>
          <button className={`hb-tab ${filter === 'returned' ? 'active' : ''}`} onClick={() => setFilter('returned')}>Återlämnade ({returnedCount})</button>
          <button className={`hb-tab ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>Alla ({rows.length})</button>
        </div>
      </div>

      <table className="hb-table">
        <thead>
          <tr>
            <th style={{width: 110}}>Bricka</th>
            <th>Kontakt</th>
            <th>Anteckning</th>
            <th style={{width: 110}}>Utlämnad</th>
            <th style={{width: 130}}>Återlämnad</th>
          </tr>
        </thead>
        <tbody>
          {visible.map(r => (
            <tr key={r.cardNumber}>
              <td className="hb-card-num">{r.cardNumber}</td>
              <td>
                <div className="hb-contact">
                  <span className="name">{r.contactName}</span>
                  {r.contactPhone && <span className="ch">☎ {r.contactPhone}</span>}
                  {r.contactEmail && <span className="ch">✉ {r.contactEmail}</span>}
                </div>
              </td>
              <td className="hb-note">{r.note || <span style={{color: 'var(--fg-faint)'}}>—</span>}</td>
              <td className="hb-time">{r.markedAt}</td>
              <td>
                {r.returnedAt
                  ? <span className="hb-pill-returned">✓ {r.returnedAt}</span>
                  : <button className="hb-return-btn" onClick={() => markReturned(r.cardNumber)}>Returnerad</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {visible.length === 0 && (
        <div style={{textAlign: 'center', padding: '40px 0', color: 'var(--fg-faint)'}}>
          Inga rader i denna vy.
        </div>
      )}
    </div>
  );
}
