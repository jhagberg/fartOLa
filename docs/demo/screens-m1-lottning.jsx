// Lottning — mirrors apps/web/src/lib/screens/LottningView.svelte and lottning.ts, with
// components/StartTimeHistory.svelte (+ start-time-history.ts) and PreviousResultsUpload.svelte
// (texts from the app's i18n catalog). Simulated in the browser: the SOFT rules the server
// applies (edge routes/lottning.ts) are checked here against the class kinds and level in the
// shared M1 store, and the draws run on the mock runners in data.js. No file is parsed: an
// uploaded result list is answered with the stored previous-stage results of the mock runners.
const { useState: useStateLo } = React;

const DRAW_MODES = ['SOFT', 'Simultaneous', 'Seeded', 'Pursuit', 'ReversePursuit'];
const MODE_KEYS = {
  SOFT: 'lottning.soft',
  Simultaneous: 'lottning.simultaneous',
  Seeded: 'lottning.seeded',
  Pursuit: 'lottning.pursuit',
  ReversePursuit: 'lottning.reversePursuit',
};
const DRAW_TYPES = ['All', 'RemainingBefore', 'RemainingAfter', 'RemainingVacant'];
const VACANT_POSITIONS = ['Mixed', 'First', 'Last'];
const START_METHODS = ['auto', 'start_time', 'start_punch'];

// ── lottning.ts ─────────────────────────────────────────────────────────────
const isPursuit = (m) => m === 'Pursuit' || m === 'ReversePursuit';
const lateEntrantsAllowed = (m) => m === 'SOFT';
function visibleFields(mode, drawType) {
  const whole = drawType === 'All' || !lateEntrantsAllowed(mode);
  return {
    firstStart: whole,
    interval: mode !== 'Simultaneous',
    vacancies: whole && (mode === 'SOFT' || mode === 'Seeded'),
    seeding: mode === 'Seeded',
    pursuit: isPursuit(mode),
  };
}
// A refused draw: the i18n key and the confirm path the view offers (ADR-0016 rule 6).
const refuse = (key, fix) => ({ key, ...(fix ? { fix } : {}) });

// ── the time helpers ────────────────────────────────────────────────────────
const pad2 = (n) => String(n).padStart(2, '0');
const fmtClock = (s) =>
  s === null
    ? '—'
    : `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`;
const hhmmToSec = (v) => {
  const [h, m] = v.split(':').map(Number);
  return (h || 0) * 3600 + (m || 0) * 60;
};
const shuffle = (a) => {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
};
// Club spread (SOFT): no two runners of one club next to each other when it can be avoided.
function spreadClubs(list) {
  const r = [...list];
  for (let i = 1; i < r.length; i++) {
    if (r[i].club && r[i].club === r[i - 1].club) {
      const j = r.findIndex((x, k) => k > i && x.club !== r[i - 1].club);
      if (j > 0) [r[i], r[j]] = [r[j], r[i]];
    }
  }
  return r;
}
// Vacant places among n runners: which slot indices stay empty.
function vacantIndices(total, v, position) {
  if (v <= 0) return new Set();
  if (position === 'First') return new Set(Array.from({ length: v }, (_, i) => i));
  if (position === 'Last') return new Set(Array.from({ length: v }, (_, i) => total - 1 - i));
  return new Set(
    Array.from({ length: v }, (_, i) =>
      Math.min(total - 1, Math.round(((i + 1) * total) / (v + 1)) - 1)
    )
  );
}
function slotted(order, first, iv, vacants, position) {
  const total = order.length + vacants;
  const gaps = vacantIndices(total, vacants, position);
  const out = {};
  let k = 0;
  for (let i = 0; i < total; i++) if (!gaps.has(i)) out[order[k++].id] = first + i * iv;
  return out;
}

// ── store: runners, intervals, history; the simulated server for this screen ─
function useLottningStore() {
  const [runners, setRunners] = useStateLo(window.MOCK_M1.lottning.runners);
  const [intervals, setIntervals] = useStateLo(window.MOCK_M1.lottning.intervals);
  const [prevLoaded, setPrevLoaded] = useStateLo({});
  const [history, setHistory] = useStateLo(window.MOCK_M1.lottning.history);

  // The demo's wall clock (14:32:11 when it opens, as in the top bar), running on.
  const [t0] = useStateLo(() => Date.now());
  const nowSec = () => 14 * 3600 + 32 * 60 + 11 + Math.floor((Date.now() - t0) / 1000);
  const addHistory = (cause, classId, before, after) =>
    setHistory((h) => [
      {
        id: 'h' + Date.now() + Math.random(),
        at: nowSec(),
        cause,
        class_id: classId,
        undone: false,
        before,
        after,
      },
      ...h,
    ]);
  const apply = (classId, assigned, cause) => {
    const list = runners[classId];
    const before = {},
      after = {};
    list.forEach((r) => {
      if (r.id in assigned && assigned[r.id] !== r.start) {
        before[r.id] = r.start;
        after[r.id] = assigned[r.id];
      }
    });
    setRunners((rs) => ({
      ...rs,
      [classId]: rs[classId].map((r) => (r.id in assigned ? { ...r, start: assigned[r.id] } : r)),
    }));
    if (Object.keys(after).length > 0) addHistory(cause, classId, before, after);
  };

  const setStart = (classId, runnerId, sec) => {
    apply(classId, { [runnerId]: sec }, 'manual');
  };

  // Undo is whole or nothing: refused when a runner's start changed again since.
  const undo = (item) => {
    const all = Object.values(runners).flat();
    const changed = Object.keys(item.after).filter(
      (id) => all.find((r) => r.id === id).start !== item.after[id]
    );
    if (changed.length > 0)
      return { error: { key: 'history.err.changedSince', vars: { count: changed.length } } };
    setRunners((rs) =>
      Object.fromEntries(
        Object.entries(rs).map(([cid, list]) => [
          cid,
          list.map((r) => (r.id in item.before ? { ...r, start: item.before[r.id] } : r)),
        ])
      )
    );
    setHistory((h) => [
      {
        id: 'h' + Date.now(),
        at: nowSec(),
        cause: 'undo',
        class_id: item.class_id,
        undone: false,
        before: item.after,
        after: item.before,
      },
      ...h.map((x) => (x.id === item.id ? { ...x, undone: true } : x)),
    ]);
    return { changed: Object.keys(item.after).length };
  };

  // Reading in a previous-stage result list (the file itself is not parsed).
  const uploadResults = (classId, fileName) => {
    const list = runners[classId];
    const matched = list.filter((r) => r.prev !== null);
    setPrevLoaded((p) => ({ ...p, [classId]: true }));
    return {
      file: fileName,
      results: matched.length + 18,
      matched: matched.length,
      unmatched: list
        .filter((r) => r.prev === null)
        .map((r) => ({ id: r.id, name: r.name, club: r.club })),
    };
  };
  const previousOf = (classId) => {
    if (!prevLoaded[classId]) return { results: 0, ok: 0 };
    const m = runners[classId].filter((r) => r.prev !== null);
    return { results: m.length, ok: m.filter((r) => r.prev.ok).length };
  };

  return {
    runners,
    intervals,
    setIntervals,
    history,
    apply,
    setStart,
    undo,
    uploadResults,
    previousOf,
    prevLoaded,
  };
}

// ── draw: the SOFT rules the server checks (routes/lottning.ts refusal) and the draws ──
function kindProblem(item) {
  if (item.class_kind === null) return 'lottning.err.classKindUnknown';
  if (!isConfirmed(item)) return 'lottning.err.classKindUnconfirmed';
  return null;
}
function drawRefusal(form, item, level) {
  const kindFix = (key) => refuse(key, 'class_kind');
  if (form.mode === 'Seeded') {
    if (level === null) return refuse('lottning.err.levelUnknown', 'level');
    if (level === 'niva2' || level === 'niva3') return refuse('lottning.err.seedingNotAllowed');
    if (level === 'niva1') {
      const p = kindProblem(item);
      if (p) return kindFix(p);
      if (item.class_kind !== 'elit') return refuse('lottning.err.seedingNotAllowed');
    }
  }
  if (isPursuit(form.mode)) {
    const p = kindProblem(item);
    if (p) return kindFix(p);
    // SOFT TR 7.4.1: not in an inskolning class or D/H10-12.
    if (
      item.class_kind === 'inskolning' ||
      (item.class_kind === 'ungdom' && item.age_class !== null && item.age_class <= 12)
    )
      return refuse('lottning.err.pursuitNotAllowed');
  }
  if (form.drawType === 'RemainingVacant') {
    const p = kindProblem(item);
    if (p) return kindFix(p);
    if (item.class_kind === 'elit') return refuse('lottning.err.vacantInElite');
  }
  return null;
}

// Runs the draw on the class's runners: { assigned, restarted?, without? } or { refusal }.
function runDraw(form, list, classInterval, hasPrev) {
  const named = list.filter((r) => r.name.trim().length > 0);
  const iv =
    form.drawType !== 'All' && lateEntrantsAllowed(form.mode)
      ? classInterval || form.intervalSec
      : form.intervalSec;
  if (form.drawType !== 'All' && lateEntrantsAllowed(form.mode)) {
    if (!(iv > 0)) return { refusal: refuse('lottning.err.intervalUnknown') };
    const existing = list.filter((r) => r.start !== null).map((r) => r.start);
    const late = shuffle(named.filter((r) => r.start === null));
    const lo = Math.min(...existing),
      hi = Math.max(...existing);
    const assigned = {};
    if (form.drawType === 'RemainingBefore')
      late.forEach((r, i) => (assigned[r.id] = lo - (late.length - i) * iv));
    else if (form.drawType === 'RemainingAfter')
      late.forEach((r, i) => (assigned[r.id] = hi + (i + 1) * iv));
    else {
      const taken = new Set(existing);
      const free = [];
      for (let s = lo; s <= hi; s += iv) if (!taken.has(s)) free.push(s);
      late.forEach(
        (r, i) => (assigned[r.id] = i < free.length ? free[i] : hi + (i - free.length + 1) * iv)
      );
    }
    return { assigned, interval: iv };
  }
  if (form.mode === 'Simultaneous')
    return { assigned: Object.fromEntries(named.map((r) => [r.id, form.first])), interval: 0 };
  if (isPursuit(form.mode)) {
    const ok = named
      .filter((r) => hasPrev && r.prev && r.prev.ok)
      .sort((a, b) => a.prev.sec - b.prev.sec);
    const leader = ok.length ? ok[0].prev.sec : 0;
    const inPursuit = ok.filter((r) => r.prev.sec - leader <= form.maxBehindMin * 60);
    const maxDiff = inPursuit.length ? inPursuit[inPursuit.length - 1].prev.sec - leader : 0;
    const assigned = {};
    inPursuit.forEach((r) => {
      const diff = r.prev.sec - leader;
      assigned[r.id] =
        form.first + Math.round((form.mode === 'Pursuit' ? diff : maxDiff - diff) * form.scale);
    });
    const lastPursuit = inPursuit.length ? Math.max(...inPursuit.map((r) => assigned[r.id])) : -1;
    if (lastPursuit >= 0 && form.restart <= lastPursuit)
      return { refusal: refuse('lottning.err.restartOverlaps') };
    const rest = named
      .filter((r) => !(r.id in assigned))
      .sort(
        (a, b) => (a.prev && hasPrev ? a.prev.sec : 1e9) - (b.prev && hasPrev ? b.prev.sec : 1e9)
      );
    rest.forEach((r, i) => (assigned[r.id] = form.restart + i * form.intervalSec));
    return {
      assigned,
      interval: form.intervalSec,
      restarted: rest.length,
      without: named.filter((r) => !(hasPrev && r.prev && r.prev.ok)).length,
    };
  }
  let order;
  if (form.mode === 'Seeded') {
    const key = (r) => (form.seeds[r.id] ? Number(form.seeds[r.id]) : 100);
    const groups = [...new Set(named.map(key))].sort((a, b) => (form.bestFirst ? a - b : b - a));
    order = groups.flatMap((g) => shuffle(named.filter((r) => key(r) === g)));
  } else order = form.mode === 'SOFT' ? spreadClubs(shuffle(named)) : shuffle(named);
  return {
    assigned: slotted(order, form.first, iv, form.vacantSlots, form.vacantPosition),
    interval: iv,
  };
}

// ── small pieces ────────────────────────────────────────────────────────────
function LField({ label, hint, children, htmlFor }) {
  return (
    <div className="lfield">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <small className="hint">{hint}</small>}
    </div>
  );
}

// StartTimeHistory.svelte
function StartTimeHistory({ t, history, classNames, onUndo }) {
  const FIRST = 5;
  const [showAll, setShowAll] = useStateLo(false);
  const [rowError, setRowError] = useStateLo(null);
  const [doneText, setDoneText] = useStateLo(null);
  const shown = showAll ? history : history.slice(0, FIRST);
  const changedOf = (i) => (i.changed !== undefined ? i.changed : Object.keys(i.after).length);
  const undo = (item) => {
    setRowError(null);
    setDoneText(null);
    const res = onUndo(item);
    if (res.error) setRowError({ id: item.id, text: t(res.error.key, res.error.vars) });
    else setDoneText(t('history.undone', { count: res.changed }));
  };
  return (
    <section
      className="history"
      data-testid="start-time-history"
      aria-labelledby="start-time-history-h"
    >
      <h2 id="start-time-history-h">{t('history.title')}</h2>
      {history.length === 0 ? (
        <p className="muted">{t('history.empty')}</p>
      ) : (
        <>
          {doneText !== null && (
            <p className="done" role="status" data-testid="history-done">
              {doneText}
            </p>
          )}
          <ul className="rows">
            {shown.map((item) => (
              <li className="row" key={item.id} data-testid="history-row" data-cause={item.cause}>
                <div className="what">
                  <span className="mono">{fmtClock(item.at)}</span>
                  <strong>{t('history.cause.' + item.cause)}</strong>
                  <span>
                    {item.class_id === null
                      ? t('history.allClasses')
                      : classNames[item.class_id] || '–'}
                  </span>
                  <span className="muted">{t('history.changed', { count: changedOf(item) })}</span>
                </div>
                <div className="action">
                  {item.undone ? (
                    <span className="state" data-testid="history-undone">
                      {t('history.isUndone')}
                    </span>
                  ) : item.cause === 'clock_shift' ? (
                    <span className="state">{t('history.notUndoable')}</span>
                  ) : (
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => undo(item)}
                      data-testid="history-undo"
                    >
                      {t('history.undo')}
                    </button>
                  )}
                </div>
                {rowError !== null && rowError.id === item.id && (
                  <p className="err row-err" role="alert" data-testid="history-error">
                    {rowError.text}
                  </p>
                )}
              </li>
            ))}
          </ul>
          {history.length > FIRST && (
            <button
              type="button"
              className="btn ghost sm"
              style={{ justifySelf: 'start' }}
              onClick={() => setShowAll(!showAll)}
              data-testid="history-toggle"
            >
              {showAll ? t('history.showFewer') : t('history.showAll', { count: history.length })}
            </button>
          )}
        </>
      )}
    </section>
  );
}

// PreviousResultsUpload.svelte
function PreviousResultsUpload({ t, className, loaded, onbusy, onUpload }) {
  const [file, setFile] = useStateLo(null);
  const [busy, setBusy] = useStateLo(false);
  const [result, setResult] = useStateLo(null);
  const upload = () => {
    if (file === null) return;
    setBusy(true);
    onbusy(true);
    setResult(null);
    // The server reads the file; here it takes a moment and the mock results are taken.
    setTimeout(() => {
      setResult(onUpload(file.name));
      setBusy(false);
      onbusy(false);
    }, 700);
  };
  return (
    <div className="upload" data-testid="pursuit-results">
      <label className="file-label" htmlFor="pursuit-results-file">
        {t('pursuitResults.label')}
      </label>
      <p className="hint" id="pursuit-results-hint">
        {t('pursuitResults.hint')}
      </p>
      {loaded !== null && (
        <p data-testid="pursuit-results-status">
          {loaded.results === 0
            ? t('pursuitResults.statusNone', { class: className })
            : t('pursuitResults.status', {
                class: className,
                results: loaded.results,
                ok: loaded.ok,
              })}
        </p>
      )}
      <div className="upload-row">
        <input
          id="pursuit-results-file"
          type="file"
          accept=".xml,application/xml,text/xml"
          aria-describedby="pursuit-results-hint"
          disabled={busy}
          onChange={(e) => {
            setFile(e.target.files[0] || null);
            setResult(null);
          }}
          data-testid="pursuit-results-file"
        />
        <button
          type="button"
          className="btn"
          disabled={file === null || busy}
          onClick={upload}
          data-testid="pursuit-results-upload"
        >
          {busy ? t('pursuitResults.uploading') : t('pursuitResults.upload')}
        </button>
      </div>
      {result !== null && (
        <div role="status" data-testid="pursuit-results-done">
          <p className="done">
            {t('pursuitResults.done', {
              file: result.file,
              results: result.results,
              matched: result.matched,
            })}
          </p>
          {result.unmatched.length > 0 ? (
            <>
              <p>{t('pursuitResults.unmatched', { count: result.unmatched.length })}</p>
              <ul className="unmatched" data-testid="pursuit-results-unmatched">
                {result.unmatched.map((u) => (
                  <li key={u.id}>
                    {className}: {u.name}
                    {u.club ? `, ${u.club}` : ''}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>{t('pursuitResults.allMatched')}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── LottningView ────────────────────────────────────────────────────────────
function LottningView({ t, store, lot, goInfo }) {
  const { kinds, putKinds, competition } = store;
  const level = competition.level;
  const [classId, setClassId] = useStateLo(kinds[0].class_id);
  const [drawMode, setDrawMode] = useStateLo('SOFT');
  const [drawType, setDrawType] = useStateLo('All');
  const [vacantPosition, setVacantPosition] = useStateLo('Mixed');
  const [bestFirst, setBestFirst] = useStateLo(false);
  const [seedTyped, setSeedTyped] = useStateLo({});
  const [restart, setRestart] = useStateLo('11:00');
  const [maxBehind, setMaxBehind] = useStateLo(30);
  const [scale, setScale] = useStateLo(1);
  const [firstStart, setFirstStart] = useStateLo('10:00');
  const [intervalSec, setIntervalSec] = useStateLo(120);
  const [vacantSlots, setVacantSlots] = useStateLo(0);
  const [maxTime, setMaxTime] = useStateLo('');
  const [noTiming, setNoTiming] = useStateLo({});
  const [startMethod, setStartMethod] = useStateLo({});
  const [error, setError] = useStateLo(null);
  const [refusal, setRefusal] = useStateLo(null);
  const [done, setDone] = useStateLo(null);
  const [resultsBusy, setResultsBusy] = useStateLo(false);
  const [redrawConfirmOpen, setRedrawConfirmOpen] = useStateLo(false);
  const [editing, setEditing] = useStateLo({});

  const item = kinds.find((k) => k.class_id === classId);
  const classRunners = lot.runners[classId];
  const startList = classRunners.filter((r) => r.start !== null).sort((a, b) => a.start - b.start);
  const namedRunners = classRunners.filter((r) => r.name.trim().length > 0);
  const lateEntrants = namedRunners.filter((r) => r.start === null);
  const effectiveDrawType =
    startList.length > 0 && lateEntrantsAllowed(drawMode) ? drawType : 'All';
  const fields = visibleFields(drawMode, effectiveDrawType);
  const classNames = Object.fromEntries(kinds.map((k) => [k.class_id, k.name]));
  // The kind as the lottning page shows it: the stored one, a name guess is not confirmed.
  const kindItem = { ...item, suggestion: null };
  const selectedKindStatus = kindStatus(kindItem);
  const prev = lot.previousOf(classId);

  const preview =
    effectiveDrawType === 'All'
      ? t('lottning.preview.all', { count: namedRunners.length, class: item.name })
      : t('lottning.preview.late', { count: lateEntrants.length, class: item.name });

  const onClassChange = (id) => {
    setClassId(id);
    setRefusal(null);
    setDone(null);
    setError(null);
    setRedrawConfirmOpen(false);
    setDrawType('All');
  };

  const submitDraw = () => {
    if (resultsBusy) return;
    if (effectiveDrawType === 'All' && startList.length > 0 && !redrawConfirmOpen) {
      setRedrawConfirmOpen(true);
      return;
    }
    setRedrawConfirmOpen(false);
    setError(null);
    setRefusal(null);
    setDone(null);
    if (drawMode === 'Seeded') {
      const typed = namedRunners.map((r) => (seedTyped[r.id] ?? String(r.seed || '')).trim());
      if (typed.some((v) => v !== '' && (!/^\d{1,2}$/.test(v) || Number(v) === 0)))
        return setError(t('lottning.err.seedInvalid'));
      // The server refuses a seeding with one group only (all unseeded counts as one).
      if (new Set(typed.map((v) => v || '100')).size < 2)
        return setRefusal(refuse('lottning.err.oneSeedingGroup'));
    }
    const form = {
      mode: drawMode,
      drawType: effectiveDrawType,
      first: hhmmToSec(firstStart),
      intervalSec: intervalSec || 0,
      vacantSlots: vacantSlots || 0,
      vacantPosition,
      bestFirst,
      restart: hhmmToSec(restart),
      maxBehindMin: maxBehind || 0,
      scale: scale || 1,
      seeds: Object.fromEntries(
        namedRunners.map((r) => [r.id, (seedTyped[r.id] ?? String(r.seed || '')).trim()])
      ),
    };
    const refused = drawRefusal(form, item, level);
    if (refused) return setRefusal(refused);
    const res = runDraw(form, classRunners, lot.intervals[classId], lot.prevLoaded[classId]);
    if (res.refusal) return setRefusal(res.refusal);
    lot.apply(classId, res.assigned, effectiveDrawType === 'All' ? 'draw' : 'late_entrants');
    if (effectiveDrawType === 'All') lot.setIntervals((iv) => ({ ...iv, [classId]: res.interval }));
    let text = t('lottning.done', { count: Object.keys(res.assigned).length, class: item.name });
    if (res.restarted !== undefined)
      text += ' ' + t('lottning.donePursuit', { restarted: res.restarted, without: res.without });
    setDone(text);
  };

  const refusalText = refusal === null ? '' : t(refusal.key, { class: item.name });

  // A seeding group typed per runner; the stored one is shown until typed over.
  const seedValue = (r) => seedTyped[r.id] ?? '';

  const saveEditTime = (r) => {
    const parts = (editing[r.id] || '').split(':').map(Number);
    if (parts.length < 2 || parts.some(Number.isNaN)) return setError(t('lottning.invalidTime'));
    lot.setStart(classId, r.id, parts[0] * 3600 + parts[1] * 60 + (parts[2] || 0));
    const next = { ...editing };
    delete next[r.id];
    setEditing(next);
  };
  const cancelEditTime = (id) => {
    const next = { ...editing };
    delete next[id];
    setEditing(next);
  };

  return (
    <div className="lottning" data-testid="lottning-view">
      <style>{`
        .lottning { display: flex; flex-direction: column; gap: 20px; max-width: 640px; }
        .lottning h1 { margin: 0; font-size: 22px; font-weight: 600; }
        .lottning h2 { margin: 0; font-size: 14px; font-weight: 600; }
        .lottning .lottning-form { display: flex; flex-direction: column; gap: 16px; background: var(--bg-elev); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 20px; }
        .lottning fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
        .lottning .draw-settings { display: flex; flex-direction: column; gap: 16px; }
        .lottning .lfield { display: grid; gap: 6px; }
        .lottning .lfield > label { font-size: 13px; font-weight: 500; color: var(--fg-muted); }
        .lottning .ctl { height: 44px; padding: 0 12px; background: var(--bg); border: 1px solid var(--border-strong); border-radius: var(--radius); color: var(--fg); font: inherit; font-size: 15px; width: 100%; box-sizing: border-box; }
        .lottning .hint { margin: 0; font-size: 12px; color: var(--fg-muted); line-height: 1.4; }
        .lottning .context { display: grid; gap: 2px; }
        .lottning .context p, .lottning .preview, .lottning .done { margin: 0; font-size: 14px; }
        .lottning .linkbtn { background: none; border: 0; padding: 0; margin-left: 6px; color: var(--accent); font: inherit; cursor: pointer; text-decoration: underline; }
        .lottning fieldset.group, .lottning fieldset.radio-group { border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 14px 12px; display: grid; gap: 8px; }
        .lottning legend { font-size: 13px; font-weight: 500; color: var(--fg-muted); padding: 0 4px; }
        .lottning .radio-row, .lottning .check-row { display: flex; align-items: center; gap: 8px; min-height: 36px; font-size: 14px; }
        .lottning .refusal { display: grid; gap: 8px; border: 1px solid var(--border-strong); border-radius: var(--radius); padding: 10px 12px; background: var(--bg-sunken); }
        .lottning .refusal .err { font-size: 14px; font-weight: 600; margin: 0; }
        .lottning .err { margin: 0; color: var(--dnf); font-size: 13px; }
        .lottning .preview { font-weight: 600; }
        .lottning .draw-btn-row { display: flex; justify-content: flex-end; }
        .lottning .redraw-confirm { background: var(--bg-sunken); border: 1px solid var(--border-strong); border-radius: var(--radius); padding: 12px; display: grid; gap: 8px; }
        .lottning .redraw-confirm p { margin: 0; font-size: 14px; }
        .lottning .redraw-actions { display: flex; gap: 8px; }
        .lottning .max-time-row, .lottning .upload-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .lottning .upload { display: grid; gap: 6px; }
        .lottning .upload p { margin: 0; font-size: 14px; }
        .lottning .file-label { font-size: 13px; font-weight: 500; }
        .lottning .unmatched { margin: 0; padding-left: 20px; font-size: 14px; }
        .lottning .start-table { width: 100%; border-collapse: collapse; font-size: 14px; }
        .lottning .start-table th, .lottning .start-table td { padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--border); }
        .lottning .start-table th { font-size: 12px; font-weight: 600; color: var(--fg-muted); }
        .lottning .col-pos { width: 3rem; text-align: center !important; }
        .lottning .col-club { color: var(--fg-muted); }
        .lottning .col-edit { width: 7rem; text-align: right !important; }
        .lottning .seed-input { width: 4.5rem; height: 40px; padding: 0 10px; border: 1px solid var(--border-strong); border-radius: var(--radius); background: var(--bg); color: var(--fg); font: inherit; }
        .lottning .time-edit-input { width: 8rem; font-family: var(--font-mono); height: 36px; padding: 0 8px; border: 1px solid var(--border-strong); border-radius: var(--radius); background: var(--bg); color: var(--fg); }
        .lottning .edit-btn { background: none; border: 0; color: var(--accent); font: inherit; font-size: 13px; cursor: pointer; padding: 0; }
        .lottning .edit-actions { display: flex; gap: 4px; justify-content: flex-end; }
        .lottning .start-list { display: flex; flex-direction: column; gap: 8px; }
        .lottning .history { display: grid; gap: 8px; }
        .lottning .history .rows { list-style: none; margin: 0; padding: 0; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-elev); }
        .lottning .history .row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px; padding: 8px 12px; border-bottom: 1px solid var(--border); font-size: 14px; }
        .lottning .history .row:last-child { border-bottom: 0; }
        .lottning .history .what { display: flex; flex-wrap: wrap; gap: 12px; align-items: baseline; }
        .lottning .history .state { color: var(--fg-muted); font-style: italic; }
        .lottning .history .row-err { flex-basis: 100%; }
        .lottning .history .muted, .lottning .history .done { margin: 0; font-size: 14px; }
      `}</style>

      <header>
        <h1>{t('lottning.title')}</h1>
      </header>

      <div className="lottning-form">
        <fieldset className="draw-settings" disabled={resultsBusy} data-testid="lottning-settings">
          <LField label={t('common.class')} htmlFor="lottning-class">
            <select
              id="lottning-class"
              className="ctl"
              value={classId}
              onChange={(e) => onClassChange(e.target.value)}
              data-testid="lottning-class-select"
            >
              {kinds.map((k) => (
                <option key={k.class_id} value={k.class_id}>
                  {k.name}
                </option>
              ))}
            </select>
          </LField>

          <div className="context">
            <p data-testid="lottning-class-kind" data-status={selectedKindStatus}>
              {t('classKinds.kind')}:{' '}
              <strong>{item.class_kind ? t('classKinds.kind.' + item.class_kind) : '–'}</strong> (
              {t('classKinds.status.' + selectedKindStatus)})
              {selectedKindStatus !== 'eventor' && selectedKindStatus !== 'operator' && (
                <button type="button" className="linkbtn" onClick={() => goInfo('klasser')}>
                  {t('lottning.confirmKindLink')}
                </button>
              )}
            </p>
            <p data-testid="lottning-level">
              {t('info.level.label')}:{' '}
              <strong>{level === null ? t('info.level.none') : t('info.level.' + level)}</strong>
              <button type="button" className="linkbtn" onClick={() => goInfo()}>
                {t('lottning.changeLevelLink')}
              </button>
            </p>
          </div>

          <LField label={t('lottning.mode')} htmlFor="lottning-mode">
            <select
              id="lottning-mode"
              className="ctl"
              value={drawMode}
              onChange={(e) => setDrawMode(e.target.value)}
              data-testid="lottning-mode-select"
            >
              {DRAW_MODES.map((m) => (
                <option key={m} value={m}>
                  {t(MODE_KEYS[m])}
                </option>
              ))}
            </select>
          </LField>

          {startList.length > 0 && lateEntrantsAllowed(drawMode) && (
            <fieldset className="radio-group" data-testid="lottning-draw-type">
              <legend>{t('lottning.drawType')}</legend>
              {DRAW_TYPES.map((dt) => (
                <label className="radio-row" key={dt}>
                  <input
                    type="radio"
                    name="lottning-draw-type"
                    value={dt}
                    checked={drawType === dt}
                    onChange={() => setDrawType(dt)}
                  />
                  <span>{t('lottning.drawType.' + dt)}</span>
                </label>
              ))}
            </fieldset>
          )}

          {fields.firstStart && (
            <LField
              label={t(fields.pursuit ? 'lottning.firstStartPursuit' : 'lottning.firstStart')}
              htmlFor="lottning-first-start"
            >
              <input
                id="lottning-first-start"
                className="ctl"
                type="time"
                value={firstStart}
                onChange={(e) => setFirstStart(e.target.value)}
                data-testid="lottning-first-start"
              />
            </LField>
          )}

          {fields.interval && (
            <LField
              label={t('lottning.interval')}
              htmlFor="lottning-interval"
              hint={
                !fields.firstStart
                  ? t('lottning.intervalLateHint')
                  : fields.pursuit
                    ? t('lottning.intervalPursuitHint')
                    : undefined
              }
            >
              <input
                id="lottning-interval"
                className="ctl"
                type="number"
                min="0"
                value={intervalSec}
                onChange={(e) =>
                  setIntervalSec(e.target.value === '' ? '' : Number(e.target.value))
                }
                data-testid="lottning-interval"
              />
            </LField>
          )}

          {fields.vacancies && (
            <>
              <LField label={t('lottning.vacants')} htmlFor="lottning-vacants">
                <input
                  id="lottning-vacants"
                  className="ctl"
                  type="number"
                  min="0"
                  value={vacantSlots}
                  onChange={(e) =>
                    setVacantSlots(e.target.value === '' ? '' : Number(e.target.value))
                  }
                  data-testid="lottning-vacants"
                />
              </LField>
              {vacantSlots > 0 && (
                <LField label={t('lottning.vacantPosition')} htmlFor="lottning-vacant-position">
                  <select
                    id="lottning-vacant-position"
                    className="ctl"
                    value={vacantPosition}
                    onChange={(e) => setVacantPosition(e.target.value)}
                    data-testid="lottning-vacant-position"
                  >
                    {VACANT_POSITIONS.map((vp) => (
                      <option key={vp} value={vp}>
                        {t('lottning.vacantPosition.' + vp)}
                      </option>
                    ))}
                  </select>
                </LField>
              )}
            </>
          )}

          {fields.seeding && (
            <fieldset className="group" data-testid="lottning-seeding">
              <legend>{t('lottning.seeding')}</legend>
              <p className="hint">{t('lottning.seedingHint')}</p>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={bestFirst}
                  onChange={(e) => setBestFirst(e.target.checked)}
                  data-testid="lottning-best-first"
                />
                <span>{t('lottning.bestFirst')}</span>
              </label>
              {namedRunners.length === 0 ? (
                <p className="hint">{t('lottning.seedingEmpty')}</p>
              ) : (
                <table className="start-table seed-table">
                  <thead>
                    <tr>
                      <th>{t('runners.addSheet.nameLabel')}</th>
                      <th>{t('runners.addSheet.clubLabel')}</th>
                      <th>{t('lottning.seedGroup')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {namedRunners.map((r) => (
                      <tr key={r.id}>
                        <td>{r.name}</td>
                        <td className="col-club">{r.club || '–'}</td>
                        <td>
                          <input
                            className="seed-input"
                            type="text"
                            inputMode="numeric"
                            aria-label={t('lottning.seedGroupFor', { name: r.name })}
                            value={seedValue(r)}
                            onChange={(e) =>
                              setSeedTyped((s) => ({ ...s, [r.id]: e.target.value }))
                            }
                            data-testid="lottning-seed-input"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </fieldset>
          )}

          {fields.pursuit && (
            <fieldset className="group" data-testid="lottning-pursuit">
              <legend>{t('lottning.pursuitSettings')}</legend>
              <p className="hint">{t('lottning.pursuitHint')}</p>
              <PreviousResultsUpload
                t={t}
                className={item.name}
                loaded={prev}
                onbusy={setResultsBusy}
                onUpload={(name) => lot.uploadResults(classId, name)}
              />
              <LField label={t('lottning.restart')} htmlFor="lottning-restart">
                <input
                  id="lottning-restart"
                  className="ctl"
                  type="time"
                  value={restart}
                  onChange={(e) => setRestart(e.target.value)}
                  data-testid="lottning-restart"
                />
              </LField>
              <LField label={t('lottning.maxBehind')} htmlFor="lottning-max-behind">
                <input
                  id="lottning-max-behind"
                  className="ctl"
                  type="number"
                  min="1"
                  value={maxBehind}
                  onChange={(e) =>
                    setMaxBehind(e.target.value === '' ? '' : Number(e.target.value))
                  }
                  data-testid="lottning-max-behind"
                />
              </LField>
              <LField
                label={t('lottning.scale')}
                hint={t('lottning.scaleHint')}
                htmlFor="lottning-scale"
              >
                <input
                  id="lottning-scale"
                  className="ctl"
                  type="number"
                  min="0.1"
                  max="10"
                  step="0.1"
                  value={scale}
                  onChange={(e) => setScale(e.target.value === '' ? '' : Number(e.target.value))}
                  data-testid="lottning-scale"
                />
              </LField>
            </fieldset>
          )}
        </fieldset>

        <LField
          label={t('lottning.maxTime')}
          hint={t('lottning.maxTimeHint')}
          htmlFor="lottning-max-time"
        >
          <div className="max-time-row">
            <input
              id="lottning-max-time"
              className="ctl"
              style={{ flex: 1, width: 'auto' }}
              type="text"
              placeholder="60:00"
              value={maxTime}
              onChange={(e) => setMaxTime(e.target.value)}
              data-testid="lottning-max-time"
            />
            <button type="button" className="btn" data-testid="lottning-max-time-save">
              {t('info.save')}
            </button>
          </div>
        </LField>

        <label className="check-row">
          <input
            type="checkbox"
            checked={!!noTiming[classId]}
            onChange={(e) => setNoTiming((n) => ({ ...n, [classId]: e.target.checked }))}
            data-testid="lottning-no-timing"
          />
          <span>{t('lottning.noTiming')}</span>
        </label>

        <LField label={t('lottning.startMethod')} htmlFor="lottning-start-method">
          <select
            id="lottning-start-method"
            className="ctl"
            value={startMethod[classId] || 'auto'}
            onChange={(e) => setStartMethod((s) => ({ ...s, [classId]: e.target.value }))}
            data-testid="lottning-start-method"
          >
            {START_METHODS.map((m) => (
              <option key={m} value={m}>
                {t('lottning.startMethod.' + m)}
              </option>
            ))}
          </select>
        </LField>

        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}

        {refusal !== null && (
          <div className="refusal" role="alert" data-testid="lottning-refusal">
            <p className="err">{refusalText}</p>
            {refusal.fix === 'class_kind' && (
              <ClassKindsPanel
                t={t}
                kinds={kinds}
                putKinds={putKinds}
                onlyClassId={classId}
                onSaved={() => {
                  setRefusal(null);
                  setDone(t('lottning.kindSaved'));
                }}
              />
            )}
            {refusal.fix === 'level' && (
              <button
                type="button"
                className="linkbtn"
                style={{ marginLeft: 0, justifySelf: 'start' }}
                onClick={() => goInfo()}
                data-testid="lottning-set-level"
              >
                {t('lottning.setLevelLink')}
              </button>
            )}
          </div>
        )}

        {done !== null && (
          <p className="done" role="status" data-testid="lottning-done">
            {done}
          </p>
        )}

        <p className="preview" data-testid="lottning-preview">
          {preview}
        </p>

        {resultsBusy && (
          <p className="preview" role="status" data-testid="lottning-wait-results">
            {t('lottning.waitResults')}
          </p>
        )}

        <div className="draw-btn-row">
          <button
            type="button"
            className="btn primary"
            onClick={submitDraw}
            disabled={resultsBusy}
            data-testid="lottning-draw-btn"
          >
            {effectiveDrawType !== 'All'
              ? t('lottning.drawLate')
              : startList.length > 0
                ? t('lottning.redraw')
                : t('lottning.draw')}
          </button>
        </div>

        {redrawConfirmOpen && (
          <div
            className="redraw-confirm"
            role="alertdialog"
            aria-live="assertive"
            data-testid="lottning-redraw-confirm"
          >
            <p>{t('lottning.redrawConfirm', { class: item.name })}</p>
            <div className="redraw-actions">
              <button
                type="button"
                className="btn primary"
                onClick={submitDraw}
                data-testid="lottning-redraw-yes"
              >
                {t('lottning.redraw')}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setRedrawConfirmOpen(false)}
                data-testid="lottning-redraw-cancel"
              >
                {t('race.confirm.cancel')}
              </button>
            </div>
          </div>
        )}
      </div>

      <StartTimeHistory t={t} history={lot.history} classNames={classNames} onUndo={lot.undo} />

      {startList.length > 0 ? (
        <section className="start-list" data-testid="lottning-start-list">
          <h2>{t('lottning.drawn', { count: startList.length })}</h2>
          <table className="start-table" data-testid="lottning-table">
            <thead>
              <tr>
                <th className="col-pos">#</th>
                <th>{t('runners.addSheet.nameLabel')}</th>
                <th>{t('runners.addSheet.clubLabel')}</th>
                <th>{t('common.startTime')}</th>
                <th className="col-edit"></th>
              </tr>
            </thead>
            <tbody>
              {startList.map((r, i) => (
                <tr key={r.id} data-testid="lottning-row">
                  <td className="col-pos mono">{i + 1}</td>
                  <td>{r.name}</td>
                  <td className="col-club">{r.club || '—'}</td>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                    {editing[r.id] !== undefined ? (
                      <input
                        type="text"
                        className="time-edit-input"
                        value={editing[r.id]}
                        onChange={(e) => setEditing((ed) => ({ ...ed, [r.id]: e.target.value }))}
                        data-testid="lottning-edit-time-input"
                      />
                    ) : (
                      fmtClock(r.start)
                    )}
                  </td>
                  <td className="col-edit">
                    {editing[r.id] !== undefined ? (
                      <div className="edit-actions">
                        <button
                          type="button"
                          className="btn sm primary"
                          onClick={() => saveEditTime(r)}
                          data-testid="lottning-save-time"
                        >
                          {t('info.save')}
                        </button>
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => cancelEditTime(r.id)}
                          data-testid="lottning-cancel-time"
                        >
                          {t('race.confirm.cancel')}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="edit-btn"
                        onClick={() => setEditing((ed) => ({ ...ed, [r.id]: fmtClock(r.start) }))}
                        data-testid="lottning-edit-time-btn"
                      >
                        {t('runners.row.edit')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : (
        <p className="muted" data-testid="lottning-empty">
          {t('lottning.draw')} → {t('lottning.drawn', { count: 0 })}
        </p>
      )}
    </div>
  );
}

Object.assign(window, { useLottningStore, LottningView });
