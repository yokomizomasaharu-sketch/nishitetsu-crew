/* 西鉄 乗務員支援システム — app.js  v2
   データ: window.APP_DATA (data.js)
   出典: 車掌 輪番表 / 乗務系統表(2026.3.14改正) + 西鉄列車編成両数表(青竹)
*/
(function () {
  'use strict';
  const D = window.APP_DATA;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const CIRC = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';

  const state = { view: 'roster', dayType: 'weekday', pattern: 'H1', diagram: 'H1', diagramRow: null };

  /* ---------- utils ---------- */
  const toMin = (t) => {
    const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/);
    return m ? +m[1] * 60 + +m[2] : null;
  };
  const hm = (t) => String(t || '').replace(':', '<span class="colon">:</span>');
  const fmtDur = (m) => (m == null ? '' : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`);
  const HW = { 'ﾌ': 'フ', 'ﾊ': 'ハ', 'ﾁ': 'チ', 'ﾖ': 'ヨ', 'ﾆ': 'ニ', 'ｺ': 'コ', 'ﾊﾞ': 'バ' };
  const pretty = (s) => String(s == null ? '' : s).replace(/[\uFF66-\uFF9D]/g, (c) => HW[c] || c);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const typeClass = (t) => {
    if (!t) return 'loc';
    if (t.includes('回送')) return 'dead';
    if (t.includes('ライナー') || t.startsWith('特急')) return 'ltd';
    if (t.startsWith('急行')) return 'exp';
    return 'loc';
  };
  const typeShort = (t) => {
    if (!t) return '—';
    if (t.includes('回送')) return '回送';
    if (t.includes('ライナー')) return 'NL';
    if (t.startsWith('特急')) return '特急';
    if (t.startsWith('急行')) return '急行';
    if (t.startsWith('普通')) return '普通';
    return String(t).slice(0, 3);
  };

  /* ---------- station codes ---------- */
  const CODE_COLOR = {
    フ: '#4ea1ff', チ: '#22b8a6', チヨ: '#12897c', ハヨ: '#7bc043', ハ: '#5ec14f', ヨ: '#7d8ca0',
    二: '#a78bfa', 小: '#f0a13c', 善: '#34a86b', 大: '#ef5a52', 太: '#f472b6', 津: '#f6c445',
    聖: '#c084fc', 久: '#60a5fa', 甘: '#a3d927', 柳: '#38bdf8',
  };
  const CODE_INFO = D.codes.reduce((a, c) => (a[c.code] = c, a), {});
  const isStation = (code) => !!CODE_COLOR[code];

  function stationPill(code, withName) {
    if (!isStation(code)) return `<span class="pill mark">${esc(code)}</span>`;
    const info = CODE_INFO[code] || {};
    const name = info.name || code;
    const c = CODE_COLOR[code];
    return `<span class="pill stn" style="--pc:${c}"><b>${esc(code)}</b>${withName ? `<i>${esc(name)}</i>` : ''}</span>`;
  }

  /* ---------- system string parser ---------- */
  const CODES = [...Object.keys(CODE_COLOR), '出', '入', '換', '便', '×', '~', '/', '(', ')', '普', 'H', '解放', '入出']
    .sort((a, b) => b.length - a.length);

  function tokenize(str) {
    const out = [];
    let i = 0;
    while (i < str.length) {
      const rest = str.slice(i);
      const m = rest.match(/^([A-Z]?\d{3,4})/);
      if (m) { out.push({ kind: 'train', v: m[1] }); i += m[1].length; continue; }
      let hit = null;
      for (const c of CODES) if (rest.startsWith(c)) { hit = c; break; }
      if (hit) {
        const kind = isStation(hit) ? 'stn' : 'mark';
        out.push({ kind, v: hit });
        i += hit.length;
        continue;
      }
      out.push({ kind: /\s/.test(str[i]) ? 'ws' : 'other', v: str[i] });
      i += 1;
    }
    return out;
  }

  const trainRec = (dayType, no) => ((D.trains[dayType] || {})[no] || [])[0] || null;

  /* 出勤場所（乗務開始の駅・基地）を系統の頭から判定 */
  const PLACE_RE = /^(チヨ|ハヨ|フ|チ|ハ|二|小|善|大|太|津|聖|久|甘|柳)/;
  function reportPlace(d) {
    const s = (d.duties && d.duties[0] && d.duties[0].start) || '';
    const m = String(s).match(PLACE_RE);
    return m ? m[1] : '';
  }
  function placeLabel(code) {
    const info = CODE_INFO[code];
    return info ? info.name : code;
  }

  /* ---------- helpers ---------- */
  const patternsOf = (dt) => D.patterns.filter((p) => p.dayType === dt);
  const getPattern = (id) => D.patterns.find((p) => p.id === id);
  const workDays = (p) => p.days.filter((d) => d.kind === 'work');
  const totalKousoku = (d) => d.duties.reduce((a, x) => a + (x.kousokuMin || 0), 0);
  const firstDep = (d) => d.duties[0].dep;
  const lastRet = (d) => d.duties[d.duties.length - 1].ret;
  const routeText = (d) => d.duties.map((x) => `${pretty(x.start)} → ${pretty(x.end)}`).join('　／　');
  const trainList = (d, dt) => tokenize(d.system || '').filter((t) => t.kind === 'train');

  /* ================= ROSTER ================= */
  function renderRoster(main) {
    const pats = patternsOf(state.dayType);
    if (!pats.some((p) => p.id === state.pattern)) state.pattern = pats[0].id;
    const p = getPattern(state.pattern);
    const ws = workDays(p);
    const avg = ws.length ? Math.round(ws.reduce((a, d) => a + totalKousoku(d), 0) / ws.length) : 0;
    const offs = p.days.filter((d) => d.kind === 'off').length;
    const weekly = p.days.filter((d) => d.kind === 'weekly').length;

    let html = `
      <div class="seg" id="dayTypeSeg">
        <button data-t="weekday" class="${state.dayType === 'weekday' ? 'on' : ''}">平日</button>
        <button data-t="holiday" class="${state.dayType === 'holiday' ? 'on' : ''}">土日祝</button>
      </div>
      <div class="chips" id="patChips">
        ${pats.map((x) => `<button class="chip ${x.id === state.pattern ? 'on' : ''}" data-p="${x.id}">No.${x.no}</button>`).join('')}
      </div>
      <dl class="summary">
        <div class="stat"><dt>サイクル</dt><dd>${p.cycleDays}<small>日</small></dd></div>
        <div class="stat"><dt>勤務日数</dt><dd>${ws.length}<small>日</small></dd></div>
        <div class="stat"><dt>平均拘束</dt><dd>${fmtDur(avg)}</dd></div>
      </dl>
      <p class="hint-line">${p.label}　公休/代休 ${offs}日 ・ 週休 ${weekly}日　<button class="linkbtn" id="symBtn">記号の見方</button></p>`;

    const weeks = [...new Set(p.days.map((d) => d.week))];
    for (const w of weeks) {
      const ds = p.days.filter((d) => d.week === w);
      const wWork = ds.filter((d) => d.kind === 'work');
      html += `<section class="week">
        <div class="week-head">
          <span class="week-no">${CIRC[w - 1]}</span>
          <h3>行路 ${CIRC[w - 1]}</h3>
          <span class="meta">${w}週目 ・ 勤務 ${wWork.length}日</span>
        </div>
        ${ds.map((d) => dayCard(p, d)).join('')}
      </section>`;
    }
    if (p.extras && p.extras.length) {
      html += `<section class="week"><div class="week-head"><span class="week-no plus">＋</span><h3>端数・特例勤務</h3><span class="meta">${p.extras.length}件</span></div>
        ${p.extras.map((x, i) => `<div class="day work extra" data-extra="${i}" data-p="${p.id}">
          <div class="dn"><b>${esc(x.dep)}</b><span>${esc(x.ret)}</span></div>
          <div class="mid">
            <div class="times"><span class="t">${esc(x.start)}</span><span class="arrow">→</span><span class="t">${esc(x.end)}</span></div>
            <div class="route">${esc(x.name)}</div>
          </div>
          <div class="right"><span class="kousoku">${esc(String(x.kousoku).split('/')[0])}</span><span class="k-label">拘束</span></div>
        </div>`).join('')}
      </section>`;
    }
    main.innerHTML = html;

    $('#dayTypeSeg').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-t]'); if (!b) return;
      state.dayType = b.dataset.t; render();
    });
    $('#patChips').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-p]'); if (!b) return;
      state.pattern = b.dataset.p; render();
    });
    $$('.day.work[data-row]', main).forEach((el) => el.addEventListener('click', () => openDuty(el.dataset.p, +el.dataset.row)));
    $$('.day[data-extra]', main).forEach((el) => el.addEventListener('click', () => openExtra(el.dataset.p, +el.dataset.extra)));
    const sb = $('#symBtn'); if (sb) sb.addEventListener('click', openSymbols);
  }

  function dayCard(p, d) {
    if (d.kind === 'off') {
      return `<div class="day off"><div class="dn"><b>${d.row}</b>日目</div>
        <div class="mid"><div class="route">公休 ・ 代休</div></div>
        <div class="right"><span class="badge off">休</span></div></div>`;
    }
    if (d.kind === 'weekly') {
      return `<div class="day weekly"><div class="dn"><b>${d.row}</b>日目</div>
        <div class="mid"><div class="route">週休</div></div>
        <div class="right"><span class="badge weekly">週休</span></div></div>`;
    }
    const split = d.duties.length > 1;
    return `<div class="day work" data-row="${d.row}" data-p="${p.id}">
      <div class="dn"><b>${d.row}</b>日目</div>
      <div class="mid">
        <div class="times">
          <span class="t">${esc(firstDep(d))}</span><span class="arrow">→</span><span class="t">${esc(lastRet(d))}</span>
          ${split ? '<span class="badge split">分割</span>' : ''}
        </div>
        <div class="route">${reportPlace(d) ? `<span class="place" style="--pc:${CODE_COLOR[reportPlace(d)] || '#7d8ca0'}">${esc(placeLabel(reportPlace(d)))}発</span>` : ''}${esc(routeText(d))}</div>
      </div>
      <div class="right">
        <span class="kousoku">${fmtDur(totalKousoku(d))}</span><span class="k-label">拘束</span>
        <div class="duty-tag">${CIRC[d.dutyNo - 1]}</div>
      </div>
    </div>`;
  }

  /* ================= DUTY DETAIL ================= */
  function openDuty(pid, row) {
    history.replaceState(null, '', '#duty/' + pid + '/' + row);
    const p = getPattern(pid);
    const d = p.days.find((x) => x.row === row);
    if (!d) return;
    showSheet(dutyHeader(p, d) + flowStrip(d, p.dayType) + memoBox(`${pid}:${row}`) + dutyBody(p, d, p.dayType), () => {
      bindMemo(`${pid}:${row}`);
      $$('[data-train]', $('#sheetBody')).forEach((el) => el.addEventListener('click', () => openTrain(el.dataset.train)));
    });
  }

  function openExtra(pid, idx) {
    const p = getPattern(pid);
    const x = p.extras[idx];
    const fake = {
      row: 0, kind: 'work', dutyNo: p.days[p.days.length - 1].dutyNo,
      duties: [{ dep: x.dep, ret: x.ret, start: x.start, end: x.end, kousoku: x.kousoku, kousokuMin: 0 }],
      system: x.system,
    };
    showSheet(dutyHeader(p, fake, x.name) + flowStrip(fake, p.dayType) + dutyBody(p, fake, p.dayType), () => {
      $$('[data-train]', $('#sheetBody')).forEach((el) => el.addEventListener('click', () => openTrain(el.dataset.train)));
    });
  }

  function dutyHeader(p, d, extraName) {
    return `<div class="duty-head">
      <div class="row1">
        <span class="badge work">${p.label}</span>
        <span class="badge off">${CIRC[(d.dutyNo || 1) - 1]} 行路</span>
        ${d.row ? `<span class="badge off">${d.row}日目</span>` : ''}
        ${extraName ? `<span class="badge split">${esc(extraName)}</span>` : ''}
        ${reportPlace(d) ? `<span class="place" style="--pc:${CODE_COLOR[reportPlace(d)] || '#7d8ca0'}">出勤 ${esc(placeLabel(reportPlace(d)))}</span>` : ''}
      </div>
      <div class="times">${esc(firstDep(d))}<i>→</i>${esc(lastRet(d))}<span>拘束 ${fmtDur(totalKousoku(d))}</span></div>
      <div class="route">${d.duties.map((x) => `${esc(x.start)} → ${esc(x.end)}`).join('　／　')}</div>
    </div>`;
  }

  /* big horizontal "1日の流れ" */
  function flowStrip(d, dt) {
    const trains = trainList(d, dt);
    if (!trains.length) return '';
    let items = `<div class="flow-item dep">
        <div class="fi-time">${esc(firstDep(d))}</div>
        <div class="fi-main">出勤</div>
        <div class="fi-sub">${esc(d.duties[0].start)}</div>
      </div><div class="flow-sep"></div>`;
    trains.forEach((t, i) => {
      const r = trainRec(dt, t.v);
      const cls = typeClass(r && r.type);
      items += `<div class="flow-item train ${cls}" data-train="${esc(t.v)}">
        <div class="fi-time">${esc(r ? r.dep : '—')}</div>
        <div class="fi-main"><span class="no">${esc(t.v)}</span><span class="type ${cls}">${esc(typeShort(r && r.type))}</span></div>
        <div class="fi-sub">${esc(r ? canon(r.from) + '→' + canon(r.to) : 'データなし')}</div>
        <div class="fi-end">${esc(r ? r.arr : '')}</div>
      </div>`;
      if (i < trains.length - 1) items += '<div class="flow-sep"></div>';
    });
    items += `<div class="flow-sep"></div><div class="flow-item ret">
        <div class="fi-time">${esc(lastRet(d))}</div>
        <div class="fi-main">退勤</div>
        <div class="fi-sub">${esc(d.duties[d.duties.length - 1].end)}</div>
      </div>`;
    return `<div class="flow-block"><h4 class="tl-title">1日の流れ（${trains.length}列車）</h4>
      <div class="flow">${items}</div>
      <p class="flow-note">各列車の時刻は始発・終着のもの。乗務区間は乗務系統（下段）を参照。</p></div>`;
  }

  function memoBox(key) {
    const v = localStorage.getItem('memo:' + key) || '';
    return `<div class="system-block memo">
      <h4>メモ（この端末にだけ保存）</h4>
      <textarea id="memoBox" placeholder="例：停車位置、持ち替え、申し送り など">${esc(v)}</textarea>
    </div>`;
  }
  function bindMemo(key) {
    const ta = $('#memoBox');
    if (ta) ta.addEventListener('input', () => localStorage.setItem('memo:' + key, ta.value));
  }

  function dutyBody(p, d, dt) {
    if (!d.system) return `<div class="empty">この日の乗務系統は未読取です。</div>`;
    const toks = tokenize(d.system);
    return `<div class="system-block">
        <h4>乗務系統（原本の表記）</h4>
        <div class="system-raw">${toks.map((t) => t.kind === 'train'
          ? `<span class="tok-train">${esc(t.v)}</span>`
          : t.kind === 'stn' ? stationPill(t.v, false)
            : t.kind === 'ws' ? ' '
            : `<span class="tok-mark">${esc(t.v)}</span>`).join('')}</div>
      </div>
      <h4 class="tl-title">乗務タイムライン</h4>
      ${renderTimeline(d.system, dt)}
      <div class="btn-row">
        <button class="btn primary" data-diagram="${p.id}:${d.row}">箱ダイヤで見る</button>
        <button class="btn" data-symbols>記号の見方</button>
      </div>`;
  }

  function renderTimeline(sys, dt) {
    const toks = tokenize(sys);
    let html = '<ul class="tl">';
    let buf = [];
    const flush = () => {
      if (!buf.length) return;
      if (buf.length === 1) {
        html += trainCardHTML(buf[0], dt);
      } else {
        html += `<li class="train"><div class="train-card group">
          <div class="tc-top"><span class="type dead">便乗</span><span class="run">${buf.length}本</span></div>
          <div class="tok-wrap">${buf.map((t) => `<span class="mini ${typeClass((trainRec(dt, t) || {}).type)}" data-train="${esc(t)}">${esc(t)}</span>`).join('')}</div>
        </div></li>`;
      }
      buf = [];
    };
    for (const t of toks) {
      if (t.kind === 'train') { buf.push(t.v); continue; }
      if (t.kind === 'ws') continue;
      if (t.kind === 'mark' && ['(', ')', '普'].includes(t.v)) continue;
      flush();
      if (t.kind === 'stn') html += `<li class="stn"><div class="note">${stationPill(t.v, true)}</div></li>`;
      else if (t.kind === 'mark') html += `<li class="mark"><div class="note"><b>${esc(t.v)}</b>${markDesc(t.v)}</div></li>`;
    }
    flush();
    return html + '</ul>';
  }

  function markDesc(v) {
    const map = { 出: '（出庫）', 入: '（入庫）', 換: '（車両交換・乗換）', 便: '（便乗）', '×': '（回送）', '~': '（同一編成）', 解放: '（車両解放）', H: '（構内留置）', 普: '（普通）' };
    return map[v] ? `<span class="md">${map[v]}</span>` : '';
  }

  function trainCardHTML(no, dt) {
    const r = trainRec(dt, no);
    const cls = typeClass(r && r.type);
    if (!r) return `<li class="train"><div class="train-card dead"><div class="tc-top">
        <span class="no">${esc(no)}</span><span class="type dead">未収録</span></div>
        <div class="sub">列車データが見つかりません</div></div></li>`;
    return `<li class="train"><div class="train-card ${cls}" data-train="${esc(no)}">
      <div class="tc-top">
        <span class="no">${esc(no)}</span>
        <span class="type ${cls}">${esc(typeShort(r.type))}</span>
        <span class="run"><b>${esc(r.dep)}</b> ${esc(canon(r.from))}<i>→</i><b>${esc(r.arr)}</b> ${esc(canon(r.to))}</span>
      </div>
      ${(r.set || r.carType) ? `<div class="sub">${r.set ? esc(r.set) : ''}${r.carType ? ' ・ ' + esc(r.carType) + '形' + esc(r.cars) + '両' : ''}</div>` : ''}
    </div></li>`;
  }

  /* ================= TRAIN SHEET ================= */
  function openTrain(no) {
    const w = trainRec('weekday', no), h = trainRec('holiday', no);
    const card = (label, r) => r ? `<div class="res-card static">
        <div class="t"><span class="no">${esc(r.no)}</span><span class="type ${typeClass(r.type)}">${esc(typeShort(r.type))}</span>
        <span class="run">${esc(r.dep)} ${esc(canon(r.from))} → ${esc(r.arr)} ${esc(canon(r.to))}</span></div>
        <div class="d">${label}${r.set ? ' ・ ' + esc(r.set) : ''}${r.carType ? ' ・ ' + esc(r.carType) + '形' + esc(r.cars) + '両' : ''}${r.note ? ' ・ ' + esc(r.note) : ''}</div>
      </div>` : '';
    const uses = [];
    for (const p of D.patterns) for (const d of p.days)
      if (d.system && tokenize(d.system).some((t) => t.kind === 'train' && t.v === no)) uses.push({ p, d });
    showSheet(`<div class="sheet-head"><h2>列車 ${esc(no)}</h2><button class="sheet-close" data-close>✕</button></div>
      ${card('平日', w)}${card('土日祝', h)}
      ${uses.length ? `<h4 class="tl-title" style="margin-top:14px">この列車を担当する行路（${uses.length}件）</h4>` +
        uses.map((u) => `<div class="res-card" data-goto="${u.p.id}:${u.d.row}">
          <div class="t"><span class="badge work">${u.p.label}</span><span class="badge off">${CIRC[u.d.dutyNo - 1]}</span>
          <span class="run">${u.d.row}日目</span></div></div>`).join('') : ''}`);
    $$('[data-goto]', $('#sheetBody')).forEach((el) => el.addEventListener('click', () => {
      const [pid, r] = el.dataset.goto.split(':');
      closeSheet(); setTimeout(() => openDuty(pid, +r), 80);
    }));
  }

  /* ================= DUTY LIST ================= */
  function renderDutyList(main) {
    const pats = patternsOf(state.dayType);
    let html = `<div class="seg" id="dayTypeSeg">
        <button data-t="weekday" class="${state.dayType === 'weekday' ? 'on' : ''}">平日</button>
        <button data-t="holiday" class="${state.dayType === 'holiday' ? 'on' : ''}">土日祝</button>
      </div>`;
    for (const p of pats) {
      const ws = workDays(p);
      html += `<section class="week">
        <div class="week-head"><span class="week-no">${p.no}</span><h3>${p.label}</h3><span class="meta">${ws.length}行路</span></div>
        ${ws.map((d) => `<div class="day work" data-p="${p.id}" data-row="${d.row}">
          <div class="dn"><span class="duty-strong">${CIRC[d.dutyNo - 1]}</span></div>
          <div class="mid">
            <div class="times"><span class="t">${esc(firstDep(d))}</span><span class="arrow">→</span><span class="t">${esc(lastRet(d))}</span></div>
            <div class="route">${esc(routeText(d))}</div>
          </div>
          <div class="right"><span class="kousoku">${fmtDur(totalKousoku(d))}</span><span class="k-label">拘束</span></div>
        </div>`).join('')}
      </section>`;
    }
    main.innerHTML = html;
    $('#dayTypeSeg').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-t]'); if (!b) return;
      state.dayType = b.dataset.t; render();
    });
    $$('.day.work[data-row]', main).forEach((el) => el.addEventListener('click', () => openDuty(el.dataset.p, +el.dataset.row)));
  }

  /* ================= DIAGRAM ================= */
  const MAIN = D.lines['天神大牟田線'];
  const CANON = { '久留米': '西鉄久留米', '二日市': '西鉄二日市', '小郡': '西鉄小郡', '柳川': '西鉄柳川', '聖マリア': '聖マリア病院前' };
  const canon = (n) => CANON[n] || n;
  const IDX = MAIN.reduce((a, s, i) => (a[s] = i, a), {});
  const SHORT = { '福岡(天神)': '福岡天神', '西鉄二日市': '二日市', '聖マリア病院前': '聖マリア', '西鉄小郡': '小郡', '西鉄久留米': '久留米', '西鉄柳川': '柳川', '西鉄平尾': '平尾', '西鉄中島': '中島', '西鉄渡瀬': '渡瀬', '西鉄銀水': '銀水' };
  const MAJOR = ['福岡(天神)', '大橋', '西鉄二日市', '筑紫', '西鉄小郡', '花畑', '大善寺', '西鉄柳川', '大牟田'];

  function renderDiagram(main) {
    const p = getPattern(state.diagram);
    const ws = workDays(p);
    if (state.diagramRow == null || !ws.some((x) => x.row === state.diagramRow)) state.diagramRow = ws[0].row;
    const d = ws.find((x) => x.row === state.diagramRow);
    main.innerHTML = `
      <div class="seg" id="dayTypeSeg">
        <button data-t="weekday" class="${state.dayType === 'weekday' ? 'on' : ''}">平日</button>
        <button data-t="holiday" class="${state.dayType === 'holiday' ? 'on' : ''}">土日祝</button>
      </div>
      <div class="chips" id="patChips">
        ${patternsOf(state.dayType).map((x) => `<button class="chip ${x.id === state.diagram ? 'on' : ''}" data-p="${x.id}">No.${x.no}</button>`).join('')}
      </div>
      <div class="chips" id="dayChips">${ws.map((x) => `<button class="chip ${x.row === state.diagramRow ? 'on' : ''}" data-r="${x.row}">${CIRC[x.dutyNo - 1]} ${x.row}日目</button>`).join('')}</div>
      <div class="dg-title"><b>${esc(firstDep(d))} → ${esc(lastRet(d))}</b>　${esc(p.label)}・${d.row}日目・行路${CIRC[d.dutyNo - 1]}<span>拘束 ${fmtDur(totalKousoku(d))}</span></div>
      <div class="legend">
        <span><i class="ltd"></i>特急</span><span><i class="exp"></i>急行</span><span><i class="loc"></i>普通</span><span><i class="dead"></i>回送</span>
      </div>
      ${(() => { const g = diagramSVG(d, p.dayType); return `<div class="dg-flex">
        <div class="dg-rail" id="dgRail">${g.rail}</div>
        <div class="diagram-wrap" id="dgWrap">${g.svg}</div>
      </div><p class="dg-hint">${g.note || ''}</p>`; })()}
      <p class="dg-hint">縦軸＝駅、横軸＝時刻（横にスクロールできます）。点線は出勤・退勤。列車線をタップすると列車情報が出ます。</p>
      <div class="btn-row"><button class="btn primary" data-open="${p.id}:${d.row}">この行路の詳細</button></div>`;
    $('#dayTypeSeg').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-t]'); if (!b) return;
      state.dayType = b.dataset.t; state.diagram = patternsOf(state.dayType)[0].id; state.diagramRow = null; render();
    });
    $('#patChips').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-p]'); if (!b) return;
      state.diagram = b.dataset.p; state.diagramRow = null; render();
    });
    $('#dayChips').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-r]'); if (!b) return;
      state.diagramRow = +b.dataset.r; render();
    });
    $$('[data-train]', main).forEach((el) => el.addEventListener('click', () => openTrain(el.dataset.train)));
    $('[data-open]').addEventListener('click', () => { const [pid, r] = $('[data-open]').dataset.open.split(':'); openDuty(pid, +r); });
    const wrap = $('#dgWrap'), svg = wrap && wrap.querySelector('svg');
    if (svg && svg.dataset.xdep) wrap.scrollLeft = Math.max(0, (+svg.dataset.xdep) - 24);
  }

  function diagramSVG(d, dt) {
    const toks = tokenize(d.system || '');
    const segs = [];
    for (const t of toks) {
      if (t.kind !== 'train') continue;
      const r = trainRec(dt, t.v);
      if (!r) continue;
      const a = IDX[canon(r.from)], b = IDX[canon(r.to)];
      if (a == null || b == null) { segs.push({ skip: true, no: t.v }); continue; }
      segs.push({ no: t.v, r, a, b, t1: toMin(r.dep), t2: toMin(r.arr), cls: typeClass(r.type) });
    }
    const draw = segs.filter((x) => !x.skip);
    if (!draw.length) return { svg: '<div class="empty">この行路の列車データがありません</div>', rail: '' };
    const dep = toMin(firstDep(d)), ret = toMin(lastRet(d));
    const t0 = Math.floor((Math.min(dep, ...draw.map((x) => x.t1)) - 15) / 30) * 30;
    const t1 = Math.ceil((Math.max(ret, ...draw.map((x) => x.t2)) + 10) / 30) * 30;
    let sMin = Math.min(...draw.map((x) => Math.min(x.a, x.b)));
    let sMax = Math.max(...draw.map((x) => Math.max(x.a, x.b)));
    sMin = Math.max(0, sMin - 1); sMax = Math.min(MAIN.length - 1, sMax + 1);
    const perMin = 4.6, rowH = 17, leftW = 6, topH = 26, botH = 28;
    const W = leftW + (t1 - t0) * perMin + 16;
    const H = topH + (sMax - sMin) * rowH + botH;
    const X = (m) => leftW + (m - t0) * perMin;
    const Y = (i) => topH + (i - sMin) * rowH;

    let svg = `<svg width="${W.toFixed(0)}" height="${H.toFixed(0)}" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" role="img" aria-label="箱ダイヤ" data-xdep="${X(dep).toFixed(0)}">`;
    let rail = `<div style="height:${topH}px"></div>`;
    for (let i = sMin; i <= sMax; i++) {
      const st = MAIN[i];
      const major = MAJOR.includes(st);
      svg += `<line class="dg-grid${major ? ' mj' : ''}" x1="0" y1="${Y(i)}" x2="${(W - 2).toFixed(0)}" y2="${Y(i)}"/>`;
      rail += `<div class="rail-row${major ? ' major' : ''}">${esc(SHORT[st] || st)}</div>`;
    }
    rail += `<div style="height:${botH}px"></div>`;
    for (let m = Math.ceil(t0 / 60) * 60; m <= t1; m += 60) {
      svg += `<line class="dg-grid hour" x1="${X(m).toFixed(1)}" y1="${topH - 14}" x2="${X(m).toFixed(1)}" y2="${H - botH + 6}"/>`;
      svg += `<text class="dg-hour" x="${X(m).toFixed(1)}" y="${topH - 17}" text-anchor="middle">${Math.floor(m / 60) % 24}</text>`;
    }
    svg += `<line class="dg-mark" x1="${X(dep).toFixed(1)}" y1="${topH - 10}" x2="${X(dep).toFixed(1)}" y2="${H - botH + 6}"/>`;
    svg += `<text class="dg-hinttxt" x="${(X(dep) + 3).toFixed(1)}" y="${topH - 4}" fill="#d8a72f">出勤 ${esc(firstDep(d))}</text>`;
    svg += `<line class="dg-mark" x1="${X(ret).toFixed(1)}" y1="${topH - 10}" x2="${X(ret).toFixed(1)}" y2="${H - botH + 6}"/>`;
    svg += `<text class="dg-hinttxt" x="${(X(ret) - 3).toFixed(1)}" y="${topH - 4}" text-anchor="end" fill="#d8a72f">退勤 ${esc(lastRet(d))}</text>`;
    draw.forEach((g) => {
      svg += `<line class="dg-line ${g.cls}" x1="${X(g.t1).toFixed(1)}" y1="${Y(g.a)}" x2="${X(g.t2).toFixed(1)}" y2="${Y(g.b)}" data-train="${esc(g.no)}"><title>${esc(g.no)} ${esc(g.r.type)} ${esc(g.r.dep)} ${esc(canon(g.r.from))} → ${esc(g.r.arr)} ${esc(canon(g.r.to))}</title></line>`;
      const mx = (X(g.t1) + X(g.t2)) / 2, my = (Y(g.a) + Y(g.b)) / 2;
      svg += `<text class="dg-label" x="${mx.toFixed(1)}" y="${(my - 3).toFixed(1)}" text-anchor="middle">${esc(g.no)}</text>`;
    });
    svg += '</svg>';
    const skipped = segs.filter((x) => x.skip).map((x) => x.no);
    let note = `表示区間：${esc(canon(MAIN[sMin]))} 〜 ${esc(canon(MAIN[sMax]))}`;
    if (skipped.length) note += `／他線区などの列車：${skipped.map(esc).join('、')}`;
    return { svg, rail, note };
  }

  /* ================= SEARCH ================= */
  const TIME_PRESETS = [
    { label: 'すべて', r: '' },
    { label: '〜6:00', r: '0-360' },
    { label: '6:00〜9:00', r: '360-540' },
    { label: '9:00〜12:00', r: '540-720' },
    { label: '12:00〜15:00', r: '720-900' },
    { label: '15:00〜18:00', r: '900-1080' },
    { label: '18:00〜', r: '1080-1560' },
  ];
  const searchState = { mode: 'report', place: '', range: '', from: '', to: '', dt: 'all' };

  function reportIndex() {
    const rows = [];
    for (const p of D.patterns) {
      for (const d of p.days) {
        if (d.kind !== 'work') continue;
        rows.push({ p, d, place: reportPlace(d), dep: toMin(firstDep(d)), ret: toMin(lastRet(d)) });
      }
    }
    return rows;
  }

  function renderSearch(main) {
    main.innerHTML = `
      <div class="seg" id="searchMode">
        <button data-m="report" class="${searchState.mode === 'report' ? 'on' : ''}">出勤で探す</button>
        <button data-m="kw" class="${searchState.mode === 'kw' ? 'on' : ''}">列番・駅で探す</button>
      </div>
      <div id="searchBody"></div>`;
    $('#searchMode').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-m]'); if (!b) return;
      searchState.mode = b.dataset.m; render();
    });
    if (searchState.mode === 'report') renderReportSearch($('#searchBody'));
    else renderKeywordSearch($('#searchBody'));
  }

  function renderReportSearch(host) {
    const rows = reportIndex();
    const places = [];
    const seen = {};
    const order = ['フ', 'チヨ', 'チ', 'ハヨ', 'ハ', '二', '小', '善', '大', '太', '久', '甘', '柳', '津', '聖'];
    for (const r of rows) {
      if (!r.place) continue;
      if (!seen[r.place]) { seen[r.place] = 0; places.push(r.place); }
      seen[r.place]++;
    }
    places.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    host.innerHTML = `
      <div class="filter-block">
        <div class="filter-label">① 出勤場所</div>
        <div class="place-chips" id="placeChips">
          <button class="pchip ${searchState.place === '' ? 'on' : ''}" data-place="">すべて<b>${rows.length}</b></button>
          ${places.map((c) => `<button class="pchip ${searchState.place === c ? 'on' : ''}" data-place="${esc(c)}">
            <i style="background:${CODE_COLOR[c] || '#7d8ca0'}"></i>${esc(placeLabel(c))}<b>${seen[c]}</b></button>`).join('')}
        </div>
      </div>
      <div class="filter-block">
        <div class="filter-label">② 出勤時刻</div>
        <div class="time-chips" id="timeChips">
          ${TIME_PRESETS.map((t) => `<button class="tchip ${searchState.range === t.r ? 'on' : ''}" data-r="${t.r}">${t.label}</button>`).join('')}
        </div>
        <div class="range-row">
          <input type="time" id="tFrom" value="${searchState.from}" aria-label="開始時刻">
          <span>〜</span>
          <input type="time" id="tTo" value="${searchState.to}" aria-label="終了時刻">
          <button class="btn small" id="applyRange">この範囲</button>
        </div>
      </div>
      <div class="filter-block">
        <div class="filter-label">③ ダイヤ</div>
        <div class="time-chips" id="dtChips">
          <button class="tchip ${searchState.dt === 'all' ? 'on' : ''}" data-dt="all">両方</button>
          <button class="tchip ${searchState.dt === 'weekday' ? 'on' : ''}" data-dt="weekday">平日</button>
          <button class="tchip ${searchState.dt === 'holiday' ? 'on' : ''}" data-dt="holiday">土日祝</button>
        </div>
      </div>
      <div id="reportRes"></div>`;

    const apply = () => {
      let from = null, to = null;
      if (searchState.range) {
        const [a, b] = searchState.range.split('-');
        from = +a; to = +b;
      } else if (searchState.from || searchState.to) {
        from = searchState.from ? toMin(searchState.from) : 0;
        to = searchState.to ? toMin(searchState.to) : 24 * 60 + 120;
      }
      const hits = rows.filter((r) => {
        if (searchState.place && r.place !== searchState.place) return false;
        if (searchState.dt !== 'all' && r.p.dayType !== searchState.dt) return false;
        if (from != null && (r.dep == null || r.dep < from)) return false;
        if (to != null && (r.dep == null || r.dep >= to)) return false;
        return true;
      }).sort((a, b) => a.dep - b.dep);
      const res = $('#reportRes');
      if (!hits.length) { res.innerHTML = '<div class="empty">条件に合う勤務がありません</div>'; return; }
      res.innerHTML = `<div class="res-summary">${searchState.place ? esc(placeLabel(searchState.place)) + '発 ・ ' : ''}該当 ${hits.length}件<span>（出勤時刻順）</span></div>
        ${hits.map((r) => `<div class="res-card" data-goto="${r.p.id}:${r.d.row}">
          <div class="t">
            <span class="pill stn" style="--pc:${CODE_COLOR[r.place] || '#7d8ca0'}"><b>${esc(r.place)}</b><i>${esc(placeLabel(r.place))}</i></span>
            <span class="dep-big">${esc(firstDep(r.d))}</span>
            <span class="badge work">${r.p.label}</span>
            <span class="badge off">${CIRC[r.d.dutyNo - 1]}</span>
          </div>
          <div class="d">${r.d.row}日目　${esc(firstDep(r.d))}→${esc(lastRet(r.d))}　拘束 ${fmtDur(totalKousoku(r.d))}　${esc(routeText(r.d))}</div>
        </div>`).join('')}`;
      $$('[data-goto]', res).forEach((el) => el.addEventListener('click', () => {
        const [pid, row] = el.dataset.goto.split(':');
        openDuty(pid, +row);
      }));
    };

    $('#placeChips').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-place]'); if (!b) return;
      searchState.place = b.dataset.place; searchState.range = ''; searchState.from = ''; searchState.to = '';
      $$('#placeChips .pchip').forEach((x) => x.classList.toggle('on', x === b));
      $$('#timeChips .tchip').forEach((x) => x.classList.toggle('on', x.dataset.r === ''));
      apply();
    });
    $('#timeChips').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-r]'); if (!b) return;
      searchState.range = b.dataset.r; searchState.from = ''; searchState.to = '';
      $('#tFrom').value = ''; $('#tTo').value = '';
      $$('#timeChips .tchip').forEach((x) => x.classList.toggle('on', x === b));
      apply();
    });
    $('#dtChips').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-dt]'); if (!b) return;
      searchState.dt = b.dataset.dt;
      $$('#dtChips .tchip').forEach((x) => x.classList.toggle('on', x === b));
      apply();
    });
    $('#applyRange').addEventListener('click', () => {
      searchState.from = $('#tFrom').value; searchState.to = $('#tTo').value;
      searchState.range = '';
      $$('#timeChips .tchip').forEach((x) => x.classList.toggle('on', false));
      apply();
    });
    apply();
  }

  function renderKeywordSearch(host) {
    host.innerHTML = `
      <div class="search-bar">
        <input id="q" type="search" inputmode="search" placeholder="列番 2161 / G140　駅 花畑 / ハ" autocomplete="off" aria-label="検索">
        <button id="qBtn">検索</button>
      </div>
      <div class="quick" id="quick"><span>よく使う：</span>
        <button data-q="2161">2161</button><button data-q="G140">G140</button><button data-q="花畑">花畑</button><button data-q="筑紫">筑紫</button><button data-q="大牟田">大牟田</button>
      </div>
      <div id="res"></div>
      <div id="resDefault"><p class="dg-hint">列番（例 2161・G140・K181）または駅名・記号（例 花畑・ハ・筑紫）で検索できます。</p></div>`;
    const run = () => {
      const q = $('#q').value.trim();
      const res = $('#res'), def = $('#resDefault');
      if (!q) { res.innerHTML = ''; def.hidden = false; return; }
      def.hidden = true;
      let html = '';
      const up = q.toUpperCase().replace(/レ$/, '');
      const hits = [];
      for (const dt of ['weekday', 'holiday']) {
        for (const no of Object.keys(D.trains[dt] || {})) {
          if (no.toUpperCase() === up || no.toUpperCase().startsWith(up)) for (const r of D.trains[dt][no]) hits.push({ dt, r });
        }
      }
      if (hits.length) {
        html += `<h4 class="tl-title">列車（${hits.length}件）</h4>`;
        html += hits.slice(0, 40).map(({ dt, r }) => `<div class="res-card" data-train="${esc(r.no)}">
            <div class="t"><span class="no">${esc(r.no)}</span><span class="type ${typeClass(r.type)}">${esc(typeShort(r.type))}</span>
            <span class="run">${esc(r.dep)} ${esc(canon(r.from))} → ${esc(r.arr)} ${esc(canon(r.to))}</span></div>
            <div class="d">${dt === 'weekday' ? '平日' : '土日祝'}${r.set ? ' ・ ' + esc(r.set) : ''}</div>
          </div>`).join('');
      }
      const codeEntry = D.codes.find((c) => c.code === q || c.name === q || (c.station && c.station === q));
      const dutyHits = [];
      for (const p of D.patterns) for (const d of p.days) {
        if (!d.system) continue;
        if (codeEntry && d.system.includes(codeEntry.code)) dutyHits.push({ p, d });
        else if (!codeEntry && q.length > 1 && [...MAIN, '太宰府', '甘木'].some((n) => n.includes(q))) {
          const codes = D.codes.filter((c) => (c.station || c.name || '').includes(q)).map((c) => c.code);
          if (codes.some((c) => d.system.includes(c))) dutyHits.push({ p, d });
        }
      }
      if (dutyHits.length) {
        html += `<h4 class="tl-title" style="margin-top:14px">この駅・記号を含む行路（${dutyHits.length}件）</h4>`;
        html += dutyHits.slice(0, 40).map(({ p, d }) => `<div class="res-card" data-goto="${p.id}:${d.row}">
            <div class="t"><span class="badge work">${p.label}</span><span class="badge off">${CIRC[d.dutyNo - 1]}</span>
            <span class="run">${d.row}日目 ${esc(firstDep(d))}→${esc(lastRet(d))}</span></div>
          </div>`).join('');
      }
      res.innerHTML = html || '<div class="empty">該当なし</div>';
      $$('[data-train]', res).forEach((el) => el.addEventListener('click', () => openTrain(el.dataset.train)));
      $$('[data-goto]', res).forEach((el) => el.addEventListener('click', () => {
        const [pid, r] = el.dataset.goto.split(':');
        openDuty(pid, +r);
      }));
    };
    $('#qBtn').addEventListener('click', run);
    $('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
    $('#q').addEventListener('input', run);
    $('#quick').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-q]'); if (!b) return;
      $('#q').value = b.dataset.q; run();
    });
  }

  /* ================= SYMBOLS ================= */
  function openSymbols() {
    const st = D.codes.filter((c) => CODE_COLOR[c.code]);
    const mk = D.codes.filter((c) => !CODE_COLOR[c.code]);
    showSheet(`<div class="sheet-head"><h2>記号の見方</h2><button class="sheet-close" data-close>✕</button></div>
      <div class="sym-grid">${st.map((c) => `<div class="sym"><span class="pill stn" style="--pc:${CODE_COLOR[c.code]}"><b>${esc(c.code)}</b><i>${esc(c.name)}</i></span></div>`).join('')}</div>
      <h4 class="tl-title" style="margin-top:14px">動作・マーク</h4>
      <div class="sym-list">${mk.map((c) => `<div><b>${esc(c.code)}</b>　${esc(c.name)}${c.note ? ` <span class="md">（${esc(c.note)}）</span>` : ''}</div>`).join('')}</div>
      <p class="dg-hint">※ 社内表記の読み方の一部は推定を含みます。原本と併せてご確認ください。</p>`);
  }

  /* ================= SHEET ================= */
  function showSheet(html, after) {
    const s = $('#sheet'), b = $('#sheetBackdrop');
    $('#sheetBody').innerHTML = html + `<div class="btn-row"><button class="btn" data-close>閉じる</button></div>`;
    s.hidden = false; b.hidden = false;
    document.body.style.overflow = 'hidden';
    s.scrollTop = 0;
    $$('[data-close]').forEach((el) => el.addEventListener('click', closeSheet));
    const sy = $('[data-symbols]'); if (sy) sy.addEventListener('click', openSymbols);
    const dg = $('[data-diagram]');
    if (dg) dg.addEventListener('click', () => {
      const [pid, r] = dg.dataset.diagram.split(':');
      const p = getPattern(pid);
      state.view = 'diagram'; state.dayType = p.dayType; state.diagram = pid; state.diagramRow = +r;
      closeSheet(); setTimeout(render, 60);
    });
    if (after) after();
  }
  function closeSheet() {
    $('#sheet').hidden = true; $('#sheetBackdrop').hidden = true;
    $('#sheetBody').innerHTML = '';
    document.body.style.overflow = '';
  }
  $('#sheetBackdrop').addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

  let pendingDuty = null;
  function applyHash() {
    const h = (location.hash || '').replace(/^#\/?/, '');
    if (!h) return false;
    const [view, a, b] = h.split('/');
    if (!['roster', 'duty', 'diagram', 'search'].includes(view)) return false;
    state.view = view;
    if (a && D.patterns.some((p) => p.id === a)) {
      state.pattern = a; state.dayType = getPattern(a).dayType;
      state.diagram = a;
      if (b) state.diagramRow = +b;
      if (view === 'duty' && b) pendingDuty = { pid: a, row: +b };
    }
    return true;
  }
  function syncHash() {
    const cur = (location.hash || '').replace(/^#\/?/, '');
    if (cur === state.view) return;
    history.replaceState(null, '', '#' + state.view);
  }

  function render() {
    const main = $('#main');
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === state.view));
    if (state.view === 'roster') renderRoster(main);
    else if (state.view === 'duty') renderDutyList(main);
    else if (state.view === 'diagram') renderDiagram(main);
    else renderSearch(main);
    syncHash();
    window.scrollTo({ top: 0 });
    if (pendingDuty) { const pd = pendingDuty; pendingDuty = null; openDuty(pd.pid, pd.row); }
  }

  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('.tab'); if (!b) return;
    state.view = b.dataset.view;
    if (state.view === 'diagram') {
      const p = getPattern(state.pattern);
      state.dayType = p.dayType; state.diagram = p.id; state.diagramRow = null;
    }
    render();
  });

  const savedTheme = localStorage.getItem('theme');
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;
  $('#themeBtn').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = cur;
    localStorage.setItem('theme', cur);
  });

  if (D && D.version) $('#verBadge').textContent = D.version;
  applyHash();
  render();
  window.addEventListener('hashchange', () => { if (applyHash()) render(); });
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
})();
