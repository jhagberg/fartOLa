// Tävlingsinfo and the class-kind list — mirror apps/web/src/lib/screens/CompetitionInfoView.svelte,
// components/ClassKindsPanel.svelte and screens/class-kinds.ts (texts from the app's i18n catalog).
// Simulated in the browser: the class kinds and the level live in the store from useM1Store().
const { useState: useStateM1 } = React;

// ── class-kinds.ts ──────────────────────────────────────────────────────────
const CLASS_KINDS = ['ungdom', 'junior', 'senior', 'veteran', 'elit', 'oppen', 'inskolning'];
const kindNeedsAge = (kind) => kind !== 'oppen' && kind !== 'inskolning';

function kindStatus(item) {
  if (item.class_kind !== null && item.class_kind_source === 'eventor') return 'eventor';
  if (item.class_kind !== null && item.class_kind_source === 'operator') return 'operator';
  if (item.suggestion && item.suggestion.source === 'eventor') return 'eventor_suggestion';
  if (item.class_kind !== null || item.suggestion) return 'name';
  return 'missing';
}
const isConfirmed = (item) => ['eventor', 'operator'].includes(kindStatus(item));
function proposed(item) {
  if (!isConfirmed(item) && item.suggestion)
    return { kind: item.suggestion.class_kind, age: item.suggestion.age_class };
  return { kind: item.class_kind, age: item.age_class };
}
function confirmItem(item) {
  if (isConfirmed(item)) return null;
  const { kind, age } = proposed(item);
  if (kind === null || (kindNeedsAge(kind) && age === null)) return null;
  return { class_id: item.class_id, class_kind: kind, age_class: kindNeedsAge(kind) ? age : null };
}
function parseAge(raw) {
  const s = raw.trim();
  if (s === '') return null;
  if (!/^\d{1,2}$/.test(s) || Number(s) === 0) return undefined;
  return Number(s);
}

// ── store: class kinds and the competition level, shared by Tävlingsinfo and Lottning ──
function useM1Store() {
  const [kinds, setKinds] = useStateM1(window.MOCK_M1.classKinds);
  const [competition, setCompetition] = useStateM1(window.MOCK_M1.competition);
  // PUT class-kinds: a confirmed item is stored with source 'operator' and no suggestion left.
  const putKinds = (list) =>
    setKinds((ks) =>
      ks.map((k) => {
        const it = list.find((i) => i.class_id === k.class_id);
        return it
          ? {
              ...k,
              class_kind: it.class_kind,
              age_class: it.age_class,
              class_kind_source: 'operator',
              suggestion: null,
            }
          : k;
      })
    );
  return { kinds, putKinds, competition, setCompetition };
}

// ── ClassKindsPanel ─────────────────────────────────────────────────────────
function ClassKindsPanel({ t, kinds, putKinds, onlyClassId = null, details = {}, onSaved }) {
  const [chosen, setChosen] = useStateM1({});
  const [ageText, setAgeText] = useStateM1({});
  const [rowError, setRowError] = useStateM1({});

  const items = kinds.filter((i) => onlyClassId === null || i.class_id === onlyClassId);
  const unconfirmed = items.filter((i) => !isConfirmed(i)).length;
  const pending = (i) => chosen[i.class_id] !== undefined || ageText[i.class_id] !== undefined;
  const confirmable = items
    .filter((i) => !pending(i))
    .map(confirmItem)
    .filter(Boolean);
  const pendingCount = items.filter((i) => !isConfirmed(i) && pending(i)).length;
  const kindOf = (i) => chosen[i.class_id] ?? proposed(i).kind;
  const ageOf = (i) => ageText[i.class_id] ?? String(proposed(i).age ?? '');

  const setErr = (id, msg) =>
    setRowError((e) => {
      const next = { ...e };
      if (msg === null) delete next[id];
      else next[id] = msg;
      return next;
    });
  const omit = (obj, ids) => Object.fromEntries(Object.entries(obj).filter(([id]) => !ids.has(id)));

  const put = (list) => {
    putKinds(list);
    const done = new Set(list.map((i) => i.class_id));
    setChosen((c) => omit(c, done));
    setAgeText((a) => omit(a, done));
    setRowError((e) => omit(e, done));
    if (onSaved) onSaved();
  };

  // Save one row as it now stands (select + age); kind and age as typed.
  const saveRow = (item, kind, ageRaw) => {
    const age = parseAge(ageRaw);
    if (kindNeedsAge(kind)) {
      if (age === undefined) return setErr(item.class_id, t('classKinds.err.ageInvalid'));
      if (age === null) return setErr(item.class_id, t('classKinds.err.ageRequired'));
    }
    put([
      { class_id: item.class_id, class_kind: kind, age_class: kindNeedsAge(kind) ? age : null },
    ]);
  };
  const onKindChange = (item, value) => {
    setChosen((c) => ({ ...c, [item.class_id]: value }));
    saveRow(item, value, ageOf(item));
  };
  const onAgeChange = (item, value) => {
    setAgeText((a) => ({ ...a, [item.class_id]: value }));
    saveRow(item, kindOf(item), value);
  };

  return (
    <div className="kinds" data-testid="class-kinds">
      <style>{`
        .kinds { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
        .kinds .summary { display: grid; gap: 8px; justify-items: start; padding: 12px 16px 0; }
        .kinds .summary p { margin: 0; font-size: 14px; }
        .kinds .table-wrap { overflow-x: auto; }
        .kinds-table { width: 100%; border-collapse: collapse; font-size: 14px; }
        .kinds-table th, .kinds-table td { text-align: left; padding: 8px 12px; border-top: 1px solid var(--border); vertical-align: top; }
        .kinds-table thead th { font-size: 12px; font-weight: 500; color: var(--fg-muted); border-top: 0; }
        .kinds-table th.name { font-weight: 600; }
        .kinds .detail { font-weight: 400; font-size: 12px; margin-left: 6px; }
        .kinds .ctl { height: 40px; padding: 0 10px; background: var(--bg); border: 1px solid var(--border-strong); border-radius: var(--radius); color: var(--fg); font: inherit; max-width: 100%; }
        .kinds .ctl.age { width: 4.5rem; }
        .kinds .status-cell { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        .kinds .kstatus { font-size: 13px; }
        .kinds .kstatus.warn { color: oklch(0.45 0.12 70); font-weight: 600; }
        .kinds .err { margin: 4px 0 0; color: var(--dnf); font-size: 13px; }
      `}</style>

      {onlyClassId === null && (
        <div className="summary" aria-live="polite">
          {unconfirmed > 0 ? (
            <>
              <p data-testid="class-kinds-unconfirmed">
                <strong>{t('classKinds.unconfirmed', { count: unconfirmed })}</strong>{' '}
                {t('classKinds.whyConfirm')}
              </p>
              {confirmable.length > 0 && (
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => put(confirmable)}
                  data-testid="class-kinds-confirm-all"
                >
                  {t('classKinds.confirmAll', { count: confirmable.length })}
                </button>
              )}
              {pendingCount > 0 && (
                <p data-testid="class-kinds-pending">
                  {t('classKinds.pendingExcluded', { count: pendingCount })}
                </p>
              )}
            </>
          ) : items.length > 0 ? (
            <p data-testid="class-kinds-all-confirmed">{t('classKinds.allConfirmed')}</p>
          ) : null}
        </div>
      )}

      {items.length > 0 && (
        <div className="table-wrap">
          <table className="kinds-table">
            <thead>
              <tr>
                {onlyClassId === null && <th scope="col">{t('common.class')}</th>}
                <th scope="col">{t('classKinds.kind')}</th>
                <th scope="col">{t('classKinds.age')}</th>
                <th scope="col">{t('classKinds.status')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const kind = kindOf(item);
                const status = kindStatus(item);
                return (
                  <tr
                    key={item.class_id}
                    data-testid="class-kind-row"
                    data-class-id={item.class_id}
                  >
                    {onlyClassId === null && (
                      <th scope="row" className="name">
                        {item.name}
                        {details[item.class_id] && (
                          <span className="muted detail">{details[item.class_id]}</span>
                        )}
                      </th>
                    )}
                    <td>
                      <select
                        className="ctl"
                        aria-label={t('classKinds.kindFor', { class: item.name })}
                        value={kind ?? ''}
                        onChange={(e) => onKindChange(item, e.target.value)}
                        data-testid="class-kind-select"
                      >
                        {kind === null && (
                          <option value="" disabled>
                            {t('classKinds.choose')}
                          </option>
                        )}
                        {CLASS_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {t('classKinds.kind.' + k)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {kind !== null && kindNeedsAge(kind) && (
                        <input
                          className="ctl age"
                          type="text"
                          inputMode="numeric"
                          aria-label={t('classKinds.ageFor', { class: item.name })}
                          key={item.class_id + ':' + ageOf(item)}
                          defaultValue={ageOf(item)}
                          onBlur={(e) => {
                            if (e.target.value !== ageOf(item)) onAgeChange(item, e.target.value);
                          }}
                          data-testid="class-kind-age"
                        />
                      )}
                    </td>
                    <td>
                      <div className="status-cell">
                        <span
                          className={'kstatus' + (isConfirmed(item) ? '' : ' warn')}
                          data-testid="class-kind-status"
                          data-status={status}
                        >
                          {t('classKinds.status.' + status)}
                        </span>
                        {confirmItem(item) !== null && !pending(item) && (
                          <button
                            type="button"
                            className="btn sm"
                            onClick={() => put([confirmItem(item)])}
                            data-testid="class-kind-confirm"
                          >
                            {t('classKinds.confirm')}
                          </button>
                        )}
                      </div>
                      {rowError[item.class_id] && (
                        <p className="err" role="alert" data-testid="class-kind-error">
                          {rowError[item.class_id]}
                        </p>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── CompetitionInfoView ─────────────────────────────────────────────────────
const LEVEL_OPTIONS = ['niva1', 'niva2', 'niva3', 'niva4', 'traning'];
const RECEIPT_OPTIONS = ['classic', 'standing', 'detailed', 'top4', 'minimal', 'kids'];

function CompetitionInfoView({ t, store }) {
  const { kinds, putKinds, competition, setCompetition } = store;
  const [form, setForm] = useStateM1(competition);
  const [toast, setToast] = useStateM1(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(competition);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = () => {
    setCompetition(form);
    setToast(t('info.savedToast'));
    setTimeout(() => setToast(null), 2500);
  };

  const details = Object.fromEntries(
    kinds.map((k) => [
      k.class_id,
      `${k.short ? `[${k.short}] ` : ''}${k.count} ${t('info.classes.competitorsShort')}`,
    ])
  );

  return (
    <section className="info-view" data-testid="competition-info">
      <style>{`
        .info-view { display: flex; flex-direction: column; gap: 16px; min-width: 0; max-width: 900px; position: relative; }
        .info-view h1 { margin: 0; font-size: 22px; font-weight: 600; }
        .info-view .hint { margin: 4px 0 0; color: var(--fg-muted); font-size: 14px; }
        .info-view .card-head h2 { margin: 0; font-size: 14px; font-weight: 600; }
        .info-view .card-head .badge { margin-left: auto; font-size: 11px; background: var(--bg-sunken); color: var(--fg-muted); padding: 2px 8px; border-radius: 999px; }
        .info-view .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
        .info-view .ifield { display: grid; gap: 6px; font-size: 13px; font-weight: 500; color: var(--fg-muted); align-content: start; }
        .info-view .ifield input[type=text], .info-view .ifield input[type=date], .info-view .ifield select { height: 44px; padding: 0 12px; background: var(--bg); border: 1px solid var(--border-strong); border-radius: var(--radius); color: var(--fg); font: inherit; font-size: 15px; }
        .info-view .ifield.check-row { display: flex; align-items: center; gap: 8px; min-height: 44px; align-self: end; color: var(--fg); font-weight: 400; }
        .info-view .field-hint { font-weight: 400; font-size: 12px; color: var(--fg-muted); line-height: 1.4; }
        .info-view .card-foot { display: flex; justify-content: flex-end; padding: 12px 18px; border-top: 1px solid var(--border); }
        .info-view .toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: var(--fg); color: var(--bg-elev); padding: 10px 18px; border-radius: var(--radius); font-size: 13px; box-shadow: var(--shadow-lg); z-index: 100; }
      `}</style>

      <header>
        <h1>{t('info.title')}</h1>
        <p className="hint">{t('info.hint')}</p>
      </header>

      <section className="card">
        <header className="card-head">
          <h2>{t('info.fields.heading')}</h2>
        </header>
        <div className="card-body grid">
          <label className="ifield">
            <span>{t('info.fields.name')}</span>
            <input
              type="text"
              value={form.name}
              maxLength={200}
              onChange={(e) => set('name', e.target.value)}
              data-testid="info-name"
            />
          </label>
          <label className="ifield">
            <span>{t('info.fields.date')}</span>
            <input
              type="date"
              value={form.date}
              onChange={(e) => set('date', e.target.value)}
              data-testid="info-date"
            />
          </label>
          <label className="ifield">
            <span>{t('info.fields.receipt')}</span>
            <select
              value={form.receiptTemplate}
              onChange={(e) => set('receiptTemplate', e.target.value)}
              data-testid="info-receipt"
            >
              {RECEIPT_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {t('info.receipt.' + o)}
                </option>
              ))}
            </select>
          </label>
          <label className="ifield check-row">
            <input
              type="checkbox"
              checked={form.autoPrint}
              onChange={(e) => set('autoPrint', e.target.checked)}
              data-testid="info-auto-print"
            />
            <span>{t('info.fields.autoPrint')}</span>
          </label>
          <label className="ifield">
            <span>{t('settings.timing.label')}</span>
            <select
              value={form.timingFormat}
              onChange={(e) => set('timingFormat', e.target.value)}
              data-testid="info-timing-format"
            >
              <option value="seconds">{t('settings.timing.seconds')}</option>
              <option value="tenths">{t('settings.timing.tenths')}</option>
            </select>
          </label>
          <label className="ifield">
            <span>{t('info.level.label')}</span>
            <select
              value={form.level ?? ''}
              aria-describedby="info-level-hint"
              onChange={(e) => set('level', e.target.value === '' ? null : e.target.value)}
              data-testid="info-level"
            >
              <option value="">{t('info.level.none')}</option>
              {LEVEL_OPTIONS.map((l) => (
                <option key={l} value={l}>
                  {t('info.level.' + l)}
                </option>
              ))}
            </select>
            <small className="field-hint" id="info-level-hint">
              {t('info.level.hint')}
            </small>
          </label>
        </div>
        <div className="card-foot">
          <button
            type="button"
            className="btn primary"
            onClick={save}
            disabled={!dirty}
            data-testid="info-save"
          >
            {t('info.save')}
          </button>
        </div>
      </section>

      <section className="card" id="klasser">
        <header className="card-head">
          <h2>{t('info.classes.heading')}</h2>
          <span className="badge mono">{kinds.length}</span>
        </header>
        <ClassKindsPanel t={t} kinds={kinds} putKinds={putKinds} details={details} />
      </section>

      {toast && (
        <div className="toast" role="status" data-testid="info-saved-toast">
          {toast}
        </div>
      )}
    </section>
  );
}

Object.assign(window, {
  useM1Store,
  ClassKindsPanel,
  CompetitionInfoView,
  kindStatus,
  isConfirmed,
  kindNeedsAge,
  CLASS_KINDS,
});
