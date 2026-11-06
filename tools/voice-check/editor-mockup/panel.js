// Mockup of the Edit clip panel, built from the app's own classes and colour variables.
window.__mock = (function () {
  const W0 = window.__wave; let D = W0;
  function closed(keep) { const P = W0.peaks, n = P.length, out = [], joins = []; let t = 0;
    keep.forEach(([a, b], k) => { if (k) joins.push(t); out.push(...P.slice(Math.round(a / W0.dur * n), Math.round(b / W0.dur * n))); t += b - a });
    return { dur: t, peaks: out, joins } }
  const SC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12"/></svg>';
  const css = `
  .ve-back{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center}
  .ve-win{width:min(1040px,80vw);min-width:1024px;border-radius:var(--r-surface)}
  .ve-wave{position:relative;height:150px;border-radius:var(--r-control);background:rgb(var(--wash)/0.04);overflow:hidden}
  .ve-in{position:absolute;inset:0 14px}.ve-bars{position:absolute;inset:0 0;display:flex;align-items:center;padding:0 0}
  .ve-bars i{flex:1 1 0;min-width:0;min-height:2px;padding:0 1px;background:rgb(var(--ink-500));background-clip:content-box;border-radius:1px}
  .ve-bars i.pl{background-color:rgb(var(--ink-800))}.ve-bars i.cut{background-color:rgb(var(--ink-300)/0.6)}
  .ve-cut{position:absolute;top:0;bottom:0;background:repeating-linear-gradient(135deg,rgb(var(--ink-300)/0.16) 0 6px,transparent 6px 12px);border-left:1px solid rgb(var(--ink-300)/0.5);border-right:1px solid rgb(var(--ink-300)/0.5)}
  .ve-sel{position:absolute;top:0;bottom:0;background:rgb(var(--accent-500)/0.14);border-left:2px solid rgb(var(--accent-500));border-right:2px solid rgb(var(--accent-500))}
  .ve-trim{position:absolute;top:0;bottom:0;width:10px;margin-left:-5px;cursor:ew-resize}
  .ve-trim::before{content:'';position:absolute;left:4px;top:0;bottom:0;width:2px;background:rgb(var(--ink-900))}
  .ve-trim::after{content:'';position:absolute;left:0;top:50%;width:10px;height:28px;margin-top:-14px;border-radius:var(--r-control);background:rgb(var(--ink-900))}
  .ve-head{position:absolute;top:0;bottom:0;width:0;border-left:1.5px solid rgb(var(--accent-500))}
  .ve-head::before{content:'';position:absolute;top:0;left:-5.5px;border:5px solid transparent;border-top:7px solid rgb(var(--accent-500))}
  .ve-join{position:absolute;top:0;bottom:0;width:0;border-left:1px solid rgb(var(--ink-400)/0.7)}.ve-join::after{content:'';position:absolute;bottom:0;left:-4px;border:4px solid transparent;border-bottom:5px solid rgb(var(--ink-400))}.ve-split{position:absolute;top:0;bottom:0;width:0;border-left:1.5px dashed rgb(var(--ink-700))}
  .ve-take{position:absolute;top:6px;font-size:11px;padding:1px 6px;border-radius:var(--r-pill);background:rgb(var(--surface));color:rgb(var(--ink-700));border:1px solid rgb(var(--wash)/0.14);white-space:nowrap}
  .ve-ruler{position:relative;height:18px;font-size:11px;color:rgb(var(--ink-400));font-variant-numeric:tabular-nums}
  .ve-ruler span{position:absolute;top:2px;transform:translateX(-50%)}
  .ve-ruler b{position:absolute;top:0;width:1px;height:4px;background:rgb(var(--ink-300))}
  .ve-over{position:relative;height:22px;border-radius:var(--r-control);background:rgb(var(--wash)/0.04);overflow:hidden}
  .ve-over .ve-bars i{padding:0 0.5px;background-color:rgb(var(--ink-400))}
  .ve-win-box{position:absolute;top:0;bottom:0;border:1.5px solid rgb(var(--accent-500));border-radius:3px;background:rgb(var(--accent-500)/0.1)}
  .ve-row{display:flex;align-items:center;gap:10px}
  .ve-play{width:34px;height:34px;padding:0;border-radius:var(--r-pill);display:grid;place-items:center;background:rgb(var(--ink-900));border-color:rgb(var(--ink-900));color:rgb(var(--paper))}
  .ve-time{font-variant-numeric:tabular-nums;font-size:13px;color:rgb(var(--ink-700));min-width:118px}
  .ve-time em{font-style:normal;color:rgb(var(--ink-400))}
  .ve-tools{display:flex;gap:6px;flex-wrap:wrap}
  .ve-tools .mini{display:inline-flex;align-items:center;gap:5px;padding:6px 10px;font-size:12.5px}
  .ve-kbd{font-size:10.5px;color:rgb(var(--ink-400));margin-left:2px}
  .ve-zoom{display:flex;align-items:center;gap:6px;margin-left:auto;color:rgb(var(--ink-500));font-size:12px}
  .ve-zoom input,.ve-speed input{accent-color:rgb(var(--accent-500));height:16px;margin:0}
  .ve-speed{display:flex;align-items:center;gap:12px;font-size:13px;color:rgb(var(--ink-700))}
  .ve-speed .v{font-variant-numeric:tabular-nums;color:rgb(var(--ink-500));min-width:36px}
  .ve-speed .ends{font-size:11px;color:rgb(var(--ink-400))}
  .ve-label{font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:rgb(var(--ink-400))}
  .ve-foot{display:flex;align-items:center;justify-content:space-between;gap:10px}
  .ve-sum{font-size:12.5px;color:rgb(var(--ink-500));font-variant-numeric:tabular-nums}
  .ve-sum b{font-weight:500;color:rgb(var(--ink-800))}
  .ve-pin{position:absolute;z-index:70;width:22px;height:22px;border-radius:50%;background:#e5484d;color:#fff;font:600 12px/22px system-ui;text-align:center;box-shadow:0 0 0 2px #fff}
  `;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  const fmt = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + s.toFixed(1).padStart(4, '0') };
  function bars(from, to, cuts, n, head) {
    const out = [];
    for (let k = 0; k < n; k++) {
      const t0 = from + (to - from) * k / n, t1 = from + (to - from) * (k + 1) / n, t = (t0 + t1) / 2;
      const i0 = Math.floor(t0 / D.dur * D.peaks.length), i1 = Math.max(i0 + 1, Math.floor(t1 / D.dur * D.peaks.length));
      let pk = 0; for (let j = i0; j < i1 && j < D.peaks.length; j++) pk = Math.max(pk, D.peaks[j]);
      const h = Math.max(2, Math.pow(pk, 0.7) * 92);
      const c = cuts.some(([a, b]) => t >= a && t < b);
      const pl = head != null && t < head;
      out.push(`<i class="${c ? 'cut' : pl ? 'pl' : ''}" style="height:${h.toFixed(1)}%"></i>`);
    }
    return out.join('');
  }
  function render(s) {
    document.querySelector('.ve-back')?.remove();
    D = s.keep ? closed(s.keep) : W0; if (s.keep) s.trim = [0, D.dur];
    const from = s.view ? s.view[0] : 0, to = s.view ? s.view[1] : D.dur;
    const X = (t) => ((t - from) / (to - from) * 100).toFixed(3) + '%';
    const cuts = [[0, s.trim[0]], [s.trim[1], D.dur], ...(s.cuts || [])];
    let marks = '';
    for (const [a, b] of cuts) if (b > from && a < to) marks += `<div class="ve-cut" style="left:${X(Math.max(a, from))};width:calc(${X(Math.min(b, to))} - ${X(Math.max(a, from))})"></div>`;
    if (s.sel) marks += `<div class="ve-sel" style="left:${X(s.sel[0])};width:calc(${X(s.sel[1])} - ${X(s.sel[0])})"></div>`;
    for (const t of s.trim) if (t >= from && t <= to) marks += `<div class="ve-trim" style="left:${X(t)}"></div>`;
    (s.splits || []).forEach((t) => { marks += `<div class="ve-split" style="left:${X(t)}"></div>` });
    (s.takes || []).forEach(([t, name]) => { marks += `<span class="ve-take" style="left:calc(${X(t)} + 6px)">${name}</span>` });
    (D.joins || []).forEach((t) => { marks += `<div class="ve-join" style="left:${X(t)}"></div>` });
    if (s.head != null) marks += `<div class="ve-head" style="left:${X(s.head)}"></div>`;
    let ruler = ''; const stepL = (to - from) > 12 ? 5 : 1, stepT = (to - from) > 12 ? 1 : 0.25;
    for (let t = Math.ceil(from / stepT) * stepT; t <= to + 1e-6; t += stepT) {
      ruler += `<b style="left:${X(t)}"></b>`;
      if (Math.abs(t / stepL - Math.round(t / stepL)) < 1e-6 && t > from + 0.01 && t < to - 0.3) ruler += `<span style="left:${X(t)}">${Math.round(t) === t ? '0:' + String(t).padStart(2, '0') : ''}</span>`;
    }
    const kept = D.dur - cuts.reduce((a, [x, y]) => a + Math.max(0, y - x), 0);
    const over = s.view ? `<div class="ve-over"><div class="ve-bars">${bars(0, D.dur, cuts, 200)}</div><div class="ve-win-box" style="left:${(from / D.dur * 100).toFixed(2)}%;width:${((to - from) / D.dur * 100).toFixed(2)}%"></div></div>` : '';
    const dis = (on) => on ? '' : ' disabled';
    const html = `
    <div class="ve-back">
      <div class="genie-backdrop absolute inset-0 bg-paper/50 backdrop-blur-[5px]"></div>
      <div class="ve-win relative flex flex-col overflow-hidden border border-ink-300/25 bg-surface shadow-float">
        <div class="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-ink-300/20 px-4 py-3">
          <div class="flex items-center gap-2"><span class="text-brand-500">${SC}</span><p class="font-display text-[15px] font-semibold text-ink-900">Edit clip</p></div>
          <p class="text-[13px] text-ink-500">Photosynthesis — explain it</p>
          <div class="flex justify-end"><button class="rounded-lg border-none bg-transparent p-1.5 text-ink-400"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" width="16" height="16"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
        </div>
        <div class="flex flex-col gap-3 px-6 py-5">
          ${over}
          <div class="ve-wave"><div class="ve-in"><div class="ve-bars">${bars(from, to, cuts, 170, s.head)}</div>${marks}</div></div>
          <div class="ve-ruler" style="margin:0 14px">${ruler}</div>
          <div class="ve-row">
            <button class="ve-play" aria-label="${s.playing ? 'Pause' : 'Play'}">${s.playing
              ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>'
              : '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l10.5-6.5z"/></svg>'}</button>
            <span class="ve-time">${fmt(s.head ?? 0)} <em>/ ${fmt(kept)}</em></span>
            <div class="ve-tools">
              <button class="mini"${dis(s.sel)}>Cut<span class="ve-kbd">⌫</span></button>
              <button class="mini"${dis(s.sel)}>Keep only this</button>
              <button class="mini">Split here<span class="ve-kbd">S</span></button>
              <button class="mini">Remove silences</button>
              <button class="mini"${dis(s.undo)}>Undo<span class="ve-kbd">⌘Z</span></button>
            </div>
            <label class="ve-zoom"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5M8 11h6"/></svg><input type="range" min="0" max="100" value="${s.zoom ?? 0}" style="width:110px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5M8 11h6M11 8v6"/></svg></label>
          </div>
          <div class="ve-speed border-t border-ink-300/20 pt-4">
            <span>Speed</span><span class="ends">0.5×</span><input type="range" min="0.5" max="2" step="0.05" value="${s.speed ?? 1}" style="width:260px"><span class="ends">2×</span><span class="v">${(s.speed ?? 1).toFixed(2).replace(/0$/, '')}×</span>
            <span class="ends">The voice keeps its pitch</span>
          </div>
        </div>
        <div class="ve-foot border-t border-ink-300/20 px-4 py-3">
          <span class="ve-sum">${s.summary ?? `Keeps <b>${fmt(kept / (s.speed ?? 1))}</b> of ${fmt(W0.dur)}`}</span>
          <div class="flex gap-2"><button>Cancel</button><button>${s.splits && s.splits.length ? 'Save as new clips' : 'Save as new clip'}</button><button class="primary">Save</button></div>
        </div>
      </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
  }
  return { render, SC };
})();
