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

  const SEL_KEY = 'crew:selection';
  let savedSel = null;
  try { savedSel = JSON.parse(localStorage.getItem(SEL_KEY) || 'null'); } catch (e) {}
  const state = { view: 'roster', dayType: 'weekday', pattern: 'H1', diagram: 'H1', diagramRow: null, dgPerMin: 2.4, dgFit: false,
    depot: (savedSel && savedSel.depot) || 'chikushi', role: (savedSel && savedSel.role) || 'conductor' };

  /* ---------- utils ---------- */
  const toMin = (t) => {
    const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/);
    return m ? +m[1] * 60 + +m[2] : null;
  };
  const hm = (t) => String(t || '').replace(':', '<span class="colon">:</span>');
  const fmtDur = (m) => (m == null ? '' : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`);
  const fmtT = (m) => (m == null ? '—' : `${Math.floor(m / 60) % 24}:${String(m % 60).padStart(2, '0')}`);
  const stName = (code) => ((CODE_INFO[code] || {}).name || code);
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
  const YOBI = ['チヨ', 'ハヨ', 'ヨ'];
  const YOBI_STN = { チヨ: '筑紫', ハヨ: '花畑', ヨ: '筑紫' };
  const DEPOT_OF = { '筑紫': '筑紫車両基地', '花畑': '花畑車両基地' };
  const CODE_COLOR = {
    フ: '#4ea1ff', チ: '#22b8a6', ハ: '#5ec14f', 二: '#a78bfa', 小: '#f0a13c', 善: '#34a86b',
    大: '#ef5a52', 太: '#f472b6', 津: '#f6c445', 聖: '#c084fc', 久: '#60a5fa', 甘: '#a3d927', 柳: '#38bdf8',
    ヤ: '#38bdf8', オ: '#818cf8',
  };
  const CODE_INFO = D.codes.reduce((a, c) => (a[c.code] = c, a), {});
  const isStation = (code) => !!CODE_COLOR[code];
  const isYobi = (code) => YOBI.indexOf(code) >= 0;

  function stationPill(code, withName) {
    if (isYobi(code)) {
      const info = CODE_INFO[code] || {};
      return `<span class="pill yobi"><b>${esc(code)}</b>${withName ? `<i>${esc(info.name || '予備')}</i>` : ''}</span>`;
    }
    if (!isStation(code)) return `<span class="pill mark">${esc(code)}</span>`;
    const info = CODE_INFO[code] || {};
    const name = info.name || code;
    const c = CODE_COLOR[code];
    return `<span class="pill stn" style="--pc:${c}"><b>${esc(code)}</b>${withName ? `<i>${esc(name)}</i>` : ''}</span>`;
  }

  /* ---------- system string parser ---------- */
  const CODES = [...Object.keys(CODE_COLOR), ...YOBI, '入出', '解放', 'H入', 'H出', '出', '入', '換', '便', '×', '~', '/', '(', ')', '普', '手', '予', '番', '優', '北', 'H']
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
        const kind = isStation(hit) ? 'stn' : (isYobi(hit) ? 'yobi' : 'mark');
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

  /* 出勤場所（乗務開始の駅・基地）を系統の頭から判定
     出庫（チ出）なら筑紫車両基地、ふつうのチは筑紫駅（交代）、ヨは予備入出庫で駅 */
  const PLACE_RE = /^(チヨ|ハヨ|フ|チ|ハ|二|小|善|大|太|津|聖|久|甘|柳|ヤ|オ)/;
  const PLACE_LABEL = { 'チヨ': '筑紫車両基地', 'チ': '筑紫駅', 'ハヨ': '花畑車両基地', 'ハ': '花畑駅', 'ヤ': '西鉄柳川駅', 'オ': '大牟田駅' };
  const PLACE_COLOR = { 'チヨ': '#12897c', 'チ': '#22b8a6', 'ハヨ': '#7bc043', 'ハ': '#5ec14f', 'ヤ': '#38bdf8', 'オ': '#818cf8' };
  const PLACE_SYMBOL = { 'チヨ': 'チ', 'チ': 'チ', 'ハヨ': 'ハ', 'ハ': 'ハ', 'ヤ': 'ヤ', 'オ': 'オ' };
  const STN_KEY = { '筑紫': 'チ', '花畑': 'ハ', '西鉄柳川': 'ヤ', '大牟田': 'オ' };
  function reportPlace(d) {
    const s = String((d.duties && d.duties[0] && d.duties[0].start) || '');
    const m = s.match(PLACE_RE);
    if (!m) return '';
    const code = m[1], after = s.slice(code.length);
    if (isYobi(code)) return STN_KEY[YOBI_STN[code]] || code;
    if ((code === 'チ' || code === 'ハ') && /^(入出|出)/.test(after)) {
      return code === 'チ' ? 'チヨ' : 'ハヨ';
    }
    return code;
  }
  function placeLabel(code) {
    if (PLACE_LABEL[code]) return PLACE_LABEL[code];
    const info = CODE_INFO[code];
    return info ? info.name : code;
  }
  const placeColor = (code) => PLACE_COLOR[code] || CODE_COLOR[code] || '#7d8ca0';
  const startPlaceOf = (d) => {
    const lg = legsOf(d)[0];
    if (!lg) return null;
    return { name: lg.bn, depot: lg.btype === 'depot', yobi: lg.byobi };
  };
  const endPlaceOf = (d) => {
    const ls = legsOf(d);
    const lg = ls[ls.length - 1];
    if (!lg) return null;
    return { name: lg.an, depot: lg.atype === 'depot', yobi: lg.ayobi };
  };

  /* ---------- helpers ---------- */
  const inSel = (p) => (p.depot || 'chikushi') === state.depot && (p.role || 'conductor') === state.role;
  const patternsOf = (dt) => D.patterns.filter((p) => p.dayType === dt && inSel(p));
  const getPattern = (id) => D.patterns.find((p) => p.id === id);
  const workDays = (p) => p.days.filter((d) => d.kind === 'work');
  const totalKousoku = (d) => d.duties.reduce((a, x) => a + (x.kousokuMin || 0), 0);
  const firstDep = (d) => d.duties[0].dep;
  const lastRet = (d) => d.duties[d.duties.length - 1].ret;
  const routeText = (d) => d.duties.map((x) => `${pretty(x.start)} → ${pretty(x.end)}`).join('　／　');
  const trainList = (d, dt) => tokenize(d.system || '').filter((t) => t.kind === 'train');
  const legsOf = (d) => (d && d.legs) || [];
  const shortName = (code) => SHORT[stName(code)] || stName(code);

  /* ================= えれサイト4（車号） =================
     えれサイト4（https://www.elesite-next.com）の運用表APIから、列番ごとの車号（編成）を取得する。
     ・西鉄天神大牟田線・甘木線（rosen_code=nishitetsu_omuta / route_id=283）
     ・所定（車両形式・両数）ごとに運用表が分かれているため、全所定をまとめて1枚の対応表にする
     ・アプリの列番（例 K181）→ 車号（例 3113+3105+3104）
     ・投稿型サイトなので、未投稿の運用は「未投稿」として扱う（架空の値は入れない）
     ================================================================= */
  const ES = {
    BASE: 'https://www.elesite-next.com/fastapi/',
    SITE: 'https://www.elesite-next.com/unyou_table',
    ROSEN: 'nishitetsu_omuta',
    ROUTE: 283,
    KEY: 'elesite:unyou:v2',
    TTL: 10 * 60 * 1000,       // 自動再取得の間隔
    STALE: 90 * 60 * 1000,     // これ以上古いと「古い情報」表示
    status: 'idle',            // idle | loading | ready | error
    date: '',
    fetchedAt: 0,
    diaName: '',
    diaType: '',               // weekday | holiday
    counts: { unyou: 0, unyouCar: 0, retsuban: 0, retsubanCar: 0 },
    map: {},                   // 列番 -> [{ cars, pos, name, shotei, uid, shukko, nyuko }]
    table: [],                 // 所定 -> 運用（編成と列番の並び）＝アプリ内の運用表
    error: '',
    staleFailed: false,
  };
  const esPad = (n) => String(n).padStart(2, '0');
  function esDate(d) {
    // えれサイトは4時で日付が変わる（4時前は前日扱い）
    const x = new Date((d || new Date()).getTime());
    if (x.getHours() < 4) x.setDate(x.getDate() - 1);
    return `${x.getFullYear()}-${esPad(x.getMonth() + 1)}-${esPad(x.getDate())}`;
  }
  const esClock = (ts) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${esPad(d.getHours())}:${esPad(d.getMinutes())}`;
  };
  const ES_SUFFIX = /(筑紫以北|筑紫以南|柳川以北|柳川以南)$/;
  const esNorm = (no) => String(no == null ? '' : no).trim().toUpperCase().replace(ES_SUFFIX, '');
  const esDiaType = (name) => (/土|休|祝/.test(String(name || '')) ? 'holiday' : 'weekday');

  async function esGet(path, params) {
    const qs = new URLSearchParams(params || {}).toString();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15000);
    try {
      const res = await fetch(ES.BASE + path + (qs ? '?' + qs : ''), {
        signal: ctl.signal, cache: 'no-store', credentials: 'omit',
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally { clearTimeout(timer); }
  }

  function esLoad() {
    try {
      const raw = localStorage.getItem(ES.KEY);
      if (!raw) return;
      const c = JSON.parse(raw);
      if (!c || !c.map || c.date !== esDate()) return;   // 別の日のキャッシュは捨てる
      ES.date = c.date; ES.fetchedAt = c.fetchedAt || 0; ES.diaName = c.diaName || '';
      ES.diaType = esDiaType(ES.diaName); ES.counts = c.counts || ES.counts;
      ES.map = c.map; ES.table = Array.isArray(c.table) ? c.table : []; ES.status = 'ready';
    } catch (e) { /* 壊れたキャッシュは無視 */ }
  }
  function esSave() {
    try {
      localStorage.setItem(ES.KEY, JSON.stringify({
        date: ES.date, fetchedAt: ES.fetchedAt, diaName: ES.diaName, counts: ES.counts, map: ES.map,
      }));
    } catch (e) { /* 容量不足などは無視（表示は続く） */ }
  }

  async function esFetch(force) {
    if (ES.status === 'loading') return;
    if (!force && ES.status === 'ready' && ES.date === esDate() && Date.now() - ES.fetchedAt < ES.TTL) {
      renderEsBar(); return;
    }
    ES.status = 'loading'; ES.error = ''; renderEsBar();
    const date = esDate();
    try {
      const pat = await esGet('get_today_dia_pattern', { rosen_code: ES.ROSEN, select_date: date });
      const dayId = pat && pat.day_id;
      if (!dayId) throw new Error('その日のダイヤを特定できません');
      const info = await esGet('get_rosen_info', { rosen_code: ES.ROSEN, day_id: dayId, select_date: date, route_id: ES.ROUTE });
      const shotei = (info && info.shotei_list) || [];
      const tables = [];
      const BATCH = 4;   // 相手サイトに負担をかけない程度に並べる
      for (let i = 0; i < shotei.length; i += BATCH) {
        const part = await Promise.all(shotei.slice(i, i + BATCH).map((_, k) => esGet('get_unyoutable', {
          rosen_code: ES.ROSEN, day_id: dayId, select_date: date,
          edit_mode: 'false', selected_shotei_index: String(i + k), route_id: ES.ROUTE,
        }).catch(() => null)));
        tables.push(...part);
      }
      if (!tables.some(Boolean)) throw new Error('運用表が空でした');
      const map = {};
      const table = [];
      const counts = { unyou: 0, unyouCar: 0, retsuban: 0, retsubanCar: 0 };
      for (const t of tables) {
        for (const g of (t && t.unyou_table) || []) {
          const sec = { s: String(g.shotei || ''), rows: [] };
          if (sec.s) table.push(sec);
          for (const u of (g.unyou_group || [])) {
            const cars0 = String(u.display_sharyo || '').trim();
            const seq = [];
            for (const r0 of (u.retsuban_list || [])) {
              const raw0 = String(r0.retsuban == null ? '' : r0.retsuban).trim();
              if (!raw0) continue;
              seq.push({ n: raw0, t: Number(r0.start_time || 0), ty: String(r0.shubetsu || ''), to: String(r0.ikisaki || ''), at: String(r0.start_st || '') });
            }
            if (seq.length) sec.rows.push({ cars: cars0, sk: String(u.shukko || ''), nk: String(u.nyuko || ''), seq });
            counts.unyou++;
            const cars = String(u.display_sharyo || '').trim();
            if (cars) counts.unyouCar++;
            for (const r of (u.retsuban_list || [])) {
              const raw = String(r.retsuban == null ? '' : r.retsuban).trim();
              const no = esNorm(raw);
              if (!no || no === '回送') continue;
              const sm = raw.match(ES_SUFFIX);
              const ent = {
                cars, pos: Number(r.combination_position || 0), name: String(r.combination_name || ''),
                sec: sm ? sm[1] : '', shotei: g.shotei || '', uid: u.unyou_id, shukko: u.shukko || '', nyuko: u.nyuko || '',
              };
              const list = map[no] || (map[no] = []);
              if (!list.some((x) => x.uid === ent.uid && x.pos === ent.pos && x.sec === ent.sec)) list.push(ent);
            }
          }
        }
      }
      counts.retsuban = Object.keys(map).length;
      counts.retsubanCar = Object.keys(map).filter((k) => map[k].some((x) => x.cars)).length;
      ES.map = map; ES.counts = counts;
      ES.table = table.filter((x) => x.rows.length);
      ES.date = date; ES.fetchedAt = Date.now();
      ES.diaName = (pat && pat.name) || ''; ES.diaType = esDiaType(ES.diaName);
      ES.status = 'ready'; ES.error = ''; ES.staleFailed = false;
      esSave(); renderEsBar();
      const ae = document.activeElement;
      const typing = !!ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA');
      const sheetOpen = !$('#sheet').hidden;
      if ($('.es-detail')) openEsDetail();        // 詳細を開いたまま再取得した場合
      else if (!typing && !sheetOpen) renderKeep();  // 入力中・シート表示中は触らない
    } catch (err) {
      const msg = String((err && err.message) || '');
      ES.error = /abort/i.test(msg) || (err && err.name === 'AbortError')
        ? '時間内に応答がありませんでした'
        : /failed to fetch|networkerror|load failed/i.test(msg)
          ? 'えれサイト4に接続できません（通信エラー）'
          : (msg || '通信エラー');
      if (Object.keys(ES.map).length && ES.date === esDate()) {
        // 今日のデータが既にあるなら、古い情報で表示を続ける
        ES.status = 'ready'; ES.staleFailed = true;
      } else {
        ES.status = 'error';
      }
      renderEsBar();
    }
  }

  function esState() { return ES.status; }
  function esApplies(dt) { return ES.status === 'ready' && ES.diaType === dt; }
  const esSecRank = (s) => (/以北$/.test(s) ? 1 : /以南$/.test(s) ? 2 : 0);
  function esCarsOf(no) {
    const ent = ES.map[esNorm(no)];
    if (!ent || !ent.length) return null;                 // えれサイトに列番の掲載なし（回送など）
    const cars = ent.filter((e) => e.cars);
    if (!cars.length) return { none: true, cars: '' };    // 運用はあるが車号が未投稿
    // 同じ列番が「筑紫以北／以南」で別の編成になることがあるので、そのときは区間名を添えて分けて出す
    const secs = Array.from(new Set(cars.map((e) => e.sec || '').filter(Boolean)));
    const bySec = secs.length > 1;
    const groups = {};
    const order = [];
    cars.slice().sort((a, b) => a.pos - b.pos).forEach((e) => {
      const k = bySec ? (e.sec || '') : '';
      if (!groups[k]) { groups[k] = []; order.push(k); }
      const seen = groups[k];
      if (!seen.some((x) => x.cars === e.cars && x.pos === e.pos)) seen.push(e);
    });
    const parts = order.sort((a, b) => esSecRank(a) - esSecRank(b)).map((k) => {
      const body = groups[k].map((e) => (e.name ? `${e.cars}（${e.name}）` : e.cars)).join('＋');
      return k ? `${k} ${body}` : body;
    });
    return { none: false, cars: parts.join(' ／ ') };
  }
  function esCarTag(no, dt) {
    if (!esApplies(dt)) return '';
    const info = esCarsOf(no);
    if (!info) return `<span class="es-car unknown"><i>車</i>—</span>`;
    if (info.none) return `<span class="es-car pending"><i>車</i>未投稿</span>`;
    return `<span class="es-car" title="えれサイト4の運用情報（${esc(esClock(ES.fetchedAt))}取得）"><i>車</i>${esc(info.cars)}</span>`;
  }
  function esCarLine(no, dt) {
    if (!esApplies(dt)) return '';
    const info = esCarsOf(no);
    const when = `${esClock(ES.fetchedAt)}取得・えれサイト4`;
    if (!info) return `<div class="es-line none"><b>車号</b>—<span>${esc(when)}に列番の掲載なし（回送など）</span></div>`;
    if (info.none) return `<div class="es-line none"><b>車号</b>未投稿<span>${esc(when)}</span></div>`;
    return `<div class="es-line"><b>車号</b>${esc(info.cars)}<span>${esc(when)}</span></div>`;
  }
  function esNoteText(dt) {
    if (ES.status === 'ready') {
      if (ES.diaType !== dt) {
        return `今日は${ES.diaType === 'holiday' ? '土日祝' : '平日'}ダイヤ（${esc(ES.diaName)}）のため、${dt === 'holiday' ? '土日祝' : '平日'}の車号（編成番号）は表示していません。形式・両数は編成両数表の情報です。`;
      }
      return `車号＝えれサイト4の運用情報（${esc(esClock(ES.fetchedAt))}取得・利用者の投稿）。「—」は未投稿または回送です。${ES.staleFailed ? '現在再取得できていないため前回の情報です。' : ''}`;
    }
    if (ES.status === 'loading') return '車号を取得しています…（えれサイト4）';
    if (ES.status === 'error') return '車号を取得できませんでした（えれサイト4）。上の車号バーの「↻」で再取得できます。';
    return '';
  }

  function esBarText() {
    if (ES.status === 'loading') return ['load', '取得中…'];
    if (ES.status === 'error') return ['err', '取得できません'];
    if (ES.status === 'ready') {
      const c = ES.counts;
      const stale = ES.staleFailed || Date.now() - ES.fetchedAt > ES.STALE;
      return [stale ? 'stale' : 'ok', `${c.retsubanCar}/${c.retsuban}列車`];
    }
    return ['idle', 'タップで取得'];
  }
  function renderEsBar() {
    const pill = $('#esPill');
    if (!pill) return;
    const [cls, txt] = esBarText();
    pill.dataset.state = cls;
    const v = $('#esVal');
    if (v) v.textContent = txt;
    const rf = $('#allRefresh');
    if (rf) rf.classList.toggle('spin', ES.status === 'loading' || POS.status === 'loading');
  }
  function renderKeep() {
    const y = window.scrollY;
    render();
    window.scrollTo({ top: y });
    renderEsBar();
  }

  function openEsDetail() {
    const c = ES.counts;
    const pending = Object.keys(ES.map).filter((k) => !ES.map[k].some((x) => x.cars)).sort();
    const rows = [
      ['路線', '西鉄天神大牟田線・甘木線'],
      ['対象日', `${ES.date || esDate()}（${ES.diaName || '—'}）`],
      ['取得', ES.fetchedAt ? `${esClock(ES.fetchedAt)}（${Math.max(0, Math.round((Date.now() - ES.fetchedAt) / 60000))}分前）` : '—'],
      ['車号あり', `運用 ${c.unyouCar}/${c.unyou} ・ 列車 ${c.retsubanCar}/${c.retsuban}`],
    ];
    if (ES.status === 'error') rows.unshift(['状態', '取得できませんでした']);
    else if (ES.staleFailed) rows.push(['更新', `失敗（${ES.error}）`]);
    showSheet(`<div class="sheet-head"><h2>車号（えれサイト4）</h2><button class="sheet-close" data-close>✕</button></div>
      <div class="es-detail">
        ${ES.status === 'error' ? `<p class="es-err">${esc(ES.error)}</p>` : ''}
        <dl class="es-dl">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
        <div class="btn-row"><button class="btn primary" id="esTableBtn"${ES.table.length ? '' : ' disabled'}>西鉄の運用表を見る</button>
          <button class="btn" id="esReload"${ES.status === 'loading' ? ' disabled' : ''}>再取得</button></div>
        ${pending.length ? `<details class="es-pend-wrap"><summary>車号が未投稿の列番（${pending.length}件）</summary>
          <p class="es-pending">${pending.slice(0, 200).map(esc).join('　')}${pending.length > 200 ? `　ほか${pending.length - 200}件` : ''}</p></details>` : ''}
        <p class="es-caution">えれサイト4の運用情報は利用者の投稿です。未投稿・誤り・あとからの変更があります。乗務前に運用表（原本）でもご確認ください。今日のダイヤ（${esc(ES.diaName || '—')}）の内容で、ほかのダイヤの日には表示しません。回送列車は列番での掲載がないため車号は出ません。</p>
        <p class="es-caution">公式サイト（えれサイト4）は路線を指定して開くURLがなく、開くと京阪本線が既定で表示されます。公式で見るときは「路線選択 → 九州 → 私鉄 → 西鉄 → 西鉄天神大牟田線・甘木線」を選んでください（一度選ぶと、以後は西鉄が開きます）。</p>
      </div>`, () => {
      const r = $('#esReload');
      if (r) r.addEventListener('click', () => esFetch(true));
      const t = $('#esTableBtn');
      if (t) t.addEventListener('click', openEsTable);
    });
  }

  /* 西鉄の運用表（えれサイト4のAPIから取得した内容をアプリ内で表示）
     公式サイトの路線ディープリンクが無い（＝開くと京阪が既定）ため、ここで西鉄の運用をそのまま見せる */
  const hhmm = (v) => (v ? `${Math.floor(v / 100)}:${String(v % 100).padStart(2, '0')}` : '—');
  function esTableHTML(q) {
    const data = ES.table || [];
    const Q = String(q || '').toUpperCase().replace(/\s/g, '');
    let hit = 0, groups = 0;
    const body = data.map((sec) => {
      const rows = sec.rows.map((r) => {
        const cars = String(r.cars || '').replace(/\s/g, '');
        const byNo = !Q || r.seq.some((t) => String(t.n).toUpperCase().includes(Q));
        const byCar = !Q || (!!cars && cars.includes(Q));
        if (!byNo && !byCar) return '';
        hit++;
        const chips = r.seq.map((t) => {
          const on = Q && String(t.n).toUpperCase().includes(Q);
          return `<span class="etr-chip${on ? ' on' : ''}"><b>${esc(hhmm(t.t))}</b><em>${esc(t.n)}</em><i>${esc(SHORT[canon(t.to)] || t.to || '')}</i></span>`;
        }).join('');
        return `<div class="etr-row"><div class="etr-head"><b>${esc(r.cars || '未投稿')}</b><span>${esc(r.sk)} → ${esc(r.nk)}</span></div><div class="etr-chips">${chips}</div></div>`;
      }).filter(Boolean).join('');
      if (!rows) return '';
      groups++;
      return `<details class="etr-sec"${Q || groups === 1 ? ' open' : ''}><summary>${esc(sec.s)}<span>${sec.rows.length}運用</span></summary>${rows}</details>`;
    }).join('');
    return hit ? body : '<p class="cmd-empty">該当する運用はありません。</p>';
  }
  function openEsTable() {
    if (!ES.table.length) return;
    showSheet(`<div class="sheet-head"><h2>西鉄の運用表</h2><button class="sheet-close" data-close>✕</button></div>
      <div class="es-table">
        <p class="es-table-note">えれサイト4の西鉄天神大牟田線・甘木線の運用情報（${esc(esClock(ES.fetchedAt))}取得・${esc(ES.diaName || '—')}）。投稿にもとづく内容です。</p>
        <input id="esTableQ" class="es-q" type="search" placeholder="列番・編成で絞り込み（例 4056 / 3113）" autocomplete="off">
        <div id="esTableBody">${esTableHTML('')}</div>
      </div>`, () => {
      const q = $('#esTableQ');
      if (q) q.addEventListener('input', () => { $('#esTableBody').innerHTML = esTableHTML(q.value); });
    });
  }

  /* ================= 列車在線位置（西鉄 列車走行位置） =================
     https://busnavi-railway.nnr.co.jp/tenjin_omuta/tenjin-omuta.json
     ・公式サイトは CORS ヘッダを返さないため、ブラウザから直接は読めない
       → 直接 fetch を試し、だめなら中継（r.jina.ai）経由で同じ JSON を読む
     ・60秒ごとに自動更新（画面が見えているときだけ）＋手動更新
     ・列番は trainNumber（ASCII を16進で持つ）の 1〜5 文字目
     ・locationRow は 0=西鉄福岡(天神)（4行）以降 3行ずつ駅に割り当て
     ================================================================= */
  const POS = {
    URL: 'https://busnavi-railway.nnr.co.jp/tenjin_omuta/tenjin-omuta.json',
    SITE: 'https://busnavi-railway.nnr.co.jp/tenjin_omuta/',
    X: 'https://twitter.com/nishitetsu_info',
    INFO: 'https://jik.nishitetsu.jp/traffic/default.htm',
    KEY: 'pos:tenjin:v1',
    RELAY: (u) => 'https://r.jina.ai/' + u,
    status: 'idle',        // idle | loading | ready | error
    source: '',            // direct / relay
    fetchedAt: 0,
    fileTime: '',
    trains: {},            // 列番 -> { st, row, col, dir, delay, delayMin, dest, type, cars, first, at }
    error: '',
    timer: null,
  };
  const posStation = (row) => {
    const r = Number(row);
    if (!isFinite(r) || r < 0) return null;
    const i = r <= 3 ? 0 : 1 + Math.floor((r - 4) / 3);
    return MAIN[i] || null;
  };
  function posDecode(h) {
    let s = '';
    for (let i = 0; i + 1 < String(h).length; i += 2) {
      const c = parseInt(String(h).substr(i, 2), 16);
      if (c >= 32 && c < 127) s += String.fromCharCode(c);
    }
    return s;
  }
  function posParse(text) {
    const i = text.indexOf('{"fileCreatedTime"');
    if (i < 0) throw new Error('在線情報の形式が違います');
    let raw = text.slice(i);
    const j = raw.lastIndexOf('}');
    if (j > 0) raw = raw.slice(0, j + 1);
    return JSON.parse(raw);
  }
  async function posLoad() {
    try {
      const raw = localStorage.getItem(POS.KEY);
      if (!raw) return;
      const c = JSON.parse(raw);
      if (!c || !c.trains || !c.fetchedAt) return;
      if (Date.now() - c.fetchedAt > 30 * 60 * 1000) return;   // 古すぎるものは使わない
      POS.trains = c.trains; POS.fetchedAt = c.fetchedAt; POS.fileTime = c.fileTime || '';
      POS.source = c.source || ''; POS.status = 'ready';
    } catch (e) { /* 無視 */ }
  }
  function posSave() {
    try {
      localStorage.setItem(POS.KEY, JSON.stringify({ trains: POS.trains, fetchedAt: POS.fetchedAt, fileTime: POS.fileTime, source: POS.source }));
    } catch (e) { /* 無視 */ }
  }
  async function posFetch(force) {
    if (POS.status === 'loading') return;
    if (!force && POS.status === 'ready' && Date.now() - POS.fetchedAt < 25 * 1000) return;
    POS.status = 'loading'; POS.error = '';
    renderPosBar();
    const bust = POS.URL + '?t=' + Date.now();
    let text = '';
    let source = '';
    try {
      // 公式サイトは CORS を返さないため、ふだんは中継経由（直接取れるようになっていればそれを使う）
      const res = await fetch(POS.RELAY(bust), { cache: 'no-store', credentials: 'omit' });
      if (!res.ok) throw new Error('中継 HTTP ' + res.status);
      text = await res.text();
      source = 'relay';
    } catch (e) {
      try {
        const res = await fetch(bust, { cache: 'no-store', credentials: 'omit' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        text = await res.text();
        source = 'direct';
      } catch (e2) {
        POS.status = 'error';
        const m = String((e2 && e2.message) || '');
        POS.error = /HTTP/.test(m) ? m : '西鉄の在線情報に接続できません（通信エラー）';
        renderPosBar();
        if (state.view === 'cmd') paintCmd();
        else if (state.view === 'diagram' || !$('#sheet').hidden) renderKeep();
        return;
      }
    }
    try {
      const data = posParse(text);
      const trains = {};
      for (const o of (data.locationObjects || [])) {
        const info = (o.trainInfoObjects || [])[0];
        if (!info) continue;
        const code = posDecode(info.trainNumber);
        const no = code.slice(1, 5);
        if (!no) continue;
        const st = posStation(o.locationRow);
        trains[no] = {
          st, row: Number(o.locationRow), col: o.locationCol, dir: o.trainDirection,
          delay: String(o.delay || ''), delayMin: String(info.delayMinutes || ''),
          dest: info.destStationName || '', type: info.trainType || '', cars: info.carsOfTrain || '',
          doors: info.doorsOfCar || '', destCode: info.destStationNumber || '',
          first: info.firstTrainStationNumber || '', at: Date.now(),
        };
      }
      POS.trains = trains;
      POS.fetchedAt = Date.now();
      POS.fileTime = String(data.fileCreatedTime || '');
      POS.source = source;
      POS.status = 'ready'; POS.error = '';
      posSave();
      renderPosBar();
      if (state.view === 'cmd') paintCmd();
      else if (state.view === 'diagram') renderKeep();
      else if (! $('#sheet').hidden && $('.pos-detail')) openPosDetail();
      else {
        const ae = document.activeElement;
        if (!ae || (ae.tagName !== 'INPUT' && ae.tagName !== 'TEXTAREA')) renderKeep();
      }
    } catch (err) {
      POS.status = 'error';
      POS.error = '在線情報を読めませんでした';
      renderPosBar();
      if (state.view === 'cmd') paintCmd();
    }
  }
  function posTick() {
    const today = todayType();
    // 今日のダイヤの列車だけが対象（他日ダイヤは在線情報の意味がない）
    return POS.status === 'ready' ? POS.trains : null;
  }
  function posInfo(no, dt) {
    if (POS.status !== 'ready' || dt !== todayType()) return null;
    const p = POS.trains[no];
    if (p) {
      const d = p.delay || '';
      return { state: d && d !== '0' ? 'delay' : 'on', delay: Number(d || 0), where: p.st || '', type: p.type, dest: p.dest };
    }
    // 在線情報にない列車：予定と比べる
    const seq = stopsOf(dt, no);
    if (!seq || seq.length < 2) return { state: 'unknown', where: '', delay: 0 };
    const now = nowMin();
    const start = seq[0][2] != null ? seq[0][2] : seq[0][1];
    const end = seq[seq.length - 1][1] != null ? seq[seq.length - 1][1] : seq[seq.length - 1][2];
    if (start == null || end == null) return { state: 'unknown', where: '', delay: 0 };
    if (now < start - 2) return { state: 'before', where: '', delay: 0 };
    if (now >= end - 2) return { state: 'done', where: '', delay: 0 };
    const rec = trainRec(dt, no);
    if (rec && /回送/.test(rec.type || '')) return { state: 'unknown', where: '', delay: 0 };
    return { state: 'missing', where: '', delay: 0 };
  }
  function posBadge(no, dt) {
    const p = posInfo(no, dt);
    if (!p) return '';
    const attrs = ` data-cmd="${esc(no)}" type="button"`;
    if (p.state === 'before') return `<span class="pos-b idle"><i>−</i>運行前</span>`;
    if (p.state === 'done') return `<span class="pos-b idle"><i>−</i>運行終了</span>`;
    if (p.state === 'missing') return `<button class="pos-b warn"${attrs} title="在線情報にこの列番がありません（回送・基地内・運休など）。タップで指令室"><i>⚠</i>在線なし</button>`;
    const info = cmdInfo(no);
    const seg = info ? (info.at ? `${info.short} 停車中` : info.short) : `${p.where}付近`;
    if (p.state === 'on') return `<button class="pos-b on"${attrs} title="西鉄 列車走行位置（${esc(posClock())}）。タップで指令室"><i>在線</i>${esc(seg)}・定時</button>`;
    return `<button class="pos-b delay"${attrs} title="西鉄 列車走行位置（${esc(posClock())}）。タップで指令室"><i>遅延</i>${esc(seg)}・+${p.delay}分</button>`;
  }
  function posLine(no, dt) {
    const p = posInfo(no, dt);
    if (!p) return '';
    const when = `${posClock()} 取得・西鉄 列車走行位置`;
    const info = p.state === 'on' || p.state === 'delay' ? cmdInfo(no) : null;
    if (p.state === 'on') return `<button class="pos-line on" data-cmd="${esc(no)}" type="button"><b>在線</b>${esc(info ? info.where : p.where + '付近')}・定時<span>${esc(when)}</span></button>`;
    if (p.state === 'delay') return `<button class="pos-line delay" data-cmd="${esc(no)}" type="button"><b>遅延</b>${esc(info ? info.where : p.where + '付近')}・+${p.delay}分<span>${esc(when)}</span></button>`;
    if (p.state === 'missing') return `<button class="pos-line warn" data-cmd="${esc(no)}" type="button"><b>⚠</b>在線情報にこの列番がありません<span>回送・基地内・運休のいずれか（${esc(when)}）</span></button>`;
    if (p.state === 'before') return `<div class="pos-line idle"><b>−</b>まだ運行前です<span>${esc(when)}</span></div>`;
    if (p.state === 'done') return `<div class="pos-line idle"><b>−</b>運行を終えた列車です<span>${esc(when)}</span></div>`;
    return '';
  }
  const posClock = (ts) => {
    const d = new Date(ts || POS.fetchedAt || Date.now());
    return `${esPad(d.getHours())}:${esPad(d.getMinutes())}`;
  };
  function nowMin() {
    const d = new Date();
    let m = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
    if (d.getHours() < 4) m += 24 * 60;   // 4時前は前日の続き
    return m;
  }
  function todayType() {
    if (ES.status === 'ready' && ES.diaType) return ES.diaType;
    const d = new Date();
    const w = d.getDay();
    return (w === 0 || w === 6) ? 'holiday' : 'weekday';
  }

  /* 在線情報の集計（運行異常アラート） */
  function posDigest() {
    if (POS.status !== 'ready') return null;
    const now = nowMin();
    let running = 0, delayed = 0, maxDelay = 0, missing = 0;
    const delayedList = [], missingList = [];
    for (const no of Object.keys(POS.trains)) {
      const p = POS.trains[no];
      running++;
      const d = Number(p.delay || 0);
      if (d > 0) { delayed++; if (d > maxDelay) maxDelay = d; delayedList.push({ no, d, where: p.st }); }
    }
    // 今日のダイヤで「今走っているはず」の列車が在線情報にない
    const dt = todayType();
    for (const p of D.patterns) {
      if (p.dayType !== dt || !inSel(p)) continue;
      for (const d of p.days) {
        for (const lg of (d.legs || [])) {
          const no = lg.t[0];
          if (!no || POS.trains[no]) continue;
          const seq = stopsOf(dt, no);
          if (!seq || seq.length < 2) continue;
          const s = seq[0][2] != null ? seq[0][2] : seq[0][1];
          const e = seq[seq.length - 1][1] != null ? seq[seq.length - 1][1] : seq[seq.length - 1][2];
          if (s == null || e == null) continue;
          const rec = (D.trains[dt] || {})[no] && (D.trains[dt] || {})[no][0];
          if (rec && /回送/.test(rec.type || '')) continue;
          if (now > s + 3 && now < e - 2 && !missingList.some((x) => x.no === no)) missingList.push({ no, from: s, to: e, lg });
        }
      }
    }
    missing = missingList.length;
    const stale = Date.now() - POS.fetchedAt > 3 * 60 * 1000;
    return { running, delayed, maxDelay, delayedList, missing, missingList, stale };
  }
  function renderPosBar() {
    const pill = $('#posPill');
    if (!pill) return;
    let cls = 'idle', txt = 'タップで取得';
    if (POS.status === 'loading') { cls = 'load'; txt = '取得中…'; }
    else if (POS.status === 'error') { cls = 'err'; txt = '取得できません'; }
    else if (POS.status === 'ready') {
      const dg = posDigest();
      const parts = [`${dg.running}本`];
      if (dg.delayed) parts.push(`遅延${dg.delayed}`);
      if (dg.missing) parts.push(`なし${dg.missing}`);
      cls = (dg.maxDelay >= 5) || dg.missing >= 3 || dg.stale ? 'warn' : 'ok';
      txt = parts.join('・');
    }
    pill.dataset.state = cls;
    const v = $('#posVal');
    if (v) v.textContent = txt;
    const rf = $('#allRefresh');
    if (rf) rf.classList.toggle('spin', ES.status === 'loading' || POS.status === 'loading');
  }
  function openPosDetail() {
    const dg = posDigest();
    const rows = Object.keys(POS.trains).map((no) => ({ no, ...POS.trains[no] }))
      .sort((a, b) => (b.delay || 0) - (a.delay || 0) || a.no.localeCompare(b.no));
    showSheet(`<div class="sheet-head"><h2>在線位置（西鉄）</h2><button class="sheet-close" data-close>✕</button></div>
      <div class="pos-detail">
        <dl class="es-dl">
          <dt>状態</dt><dd>${POS.status === 'ready' ? '取得済み' : POS.status === 'error' ? '取得できません' : '取得中'}</dd>
          <dt>更新</dt><dd>${POS.status === 'ready' ? `${posClock()}（${Math.max(0, Math.round((Date.now() - POS.fetchedAt) / 1000))}秒前）・${POS.fileTime ? '公式生成 ' + POS.fileTime.slice(8, 10) + ':' + POS.fileTime.slice(10, 12) : ''}` : '—'}</dd>
          <dt>取得経路</dt><dd>${POS.source === 'direct' ? '公式サイトから直接' : POS.source === 'relay' ? '中継サービス（r.jina.ai）経由' : '—'}</dd>
          <dt>在線</dt><dd>${dg ? `在線 ${dg.running}本 ・ 遅延 ${dg.delayed}本${dg.maxDelay ? `（最大 ${dg.maxDelay}分）` : ''}` : '—'}</dd>
        </dl>
        <div class="btn-row"><button class="btn primary" id="posReload"${POS.status === 'loading' ? ' disabled' : ''}>再取得</button>
          <a class="btn" href="${POS.SITE}" target="_blank" rel="noopener noreferrer">公式の在線位置</a>
          <a class="btn" href="${POS.X}" target="_blank" rel="noopener noreferrer">西鉄公式X</a></div>
        ${POS.status === 'error' ? `<p class="es-err">${esc(POS.error)}</p>` : ''}
        <h4 class="tl-title" style="margin-top:14px">在線中の列車（${rows.length}本）</h4>
        <div class="pos-list">
          ${rows.map((r) => `<div class="${Number(r.delay || 0) > 0 ? 'dl' : ''}"><span class="no">${esc(r.no)}</span><span class="ty">${esc(r.type)}</span><span class="wh">${esc(r.st || '—')}付近</span><b>${Number(r.delay || 0) ? r.delay + '分遅れ' : '定時'}</b><i>${esc(r.dest)}行</i></div>`).join('')}
        </div>
        <p class="es-caution">西鉄「列車走行位置」のデータをそのまま表示しています（位置は駅単位・数分前の情報）。公式サイトは CORS の制限で直接読めないため、中継サービス経由で取得しています。公式ページ・公式Xの発表とあわせてご確認ください。</p>
      </div>`, () => {
      const r = $('#posReload');
      if (r) r.addEventListener('click', () => posFetch(true));
    });
  }
  function openPosAlert() {
    if (POS.status === 'ready') openPosDetail();
    else posFetch(true);
  }

  /* ================= 公式運行情報（西鉄公式X・公式ページ） =================
     147.98MHz の指令無線を常時受信する運用は、電波法と受信環境の面でできない。
     代わりに西鉄公式が発表している運行情報を取得して、指令タブと行路（1日の流れ・
     タイムライン・ダイヤ）に反映する。
       ・公式X @nishitetsu_info … 列車が20分以上遅延する場合・運転見合わせ等のお知らせ
       ・公式 遅延証明書（www.nnr.co.jp/train/chien/）… 5分以上の遅延を時間帯別に掲載
       ・公式 運行状況（jik.nishitetsu.jp/traffic/）… 電車・バスの運行状況
     公式サイトは CORS を返さないため、中継（r.jina.ai）経由で本文を読む（在線位置と同じ）。
     取得できないときは「未取得」と明示して公式へのリンクを出す。推測で埋めない。
     在線データからの推定（遅延5分以上・未在線3本以上）は別枠の「推定」として扱う。
     ===================================================================== */
  const OFF = {
    X: 'https://x.com/nishitetsu_info',
    CHIEN: 'https://www.nnr.co.jp/train/chien/',
    JIK: 'https://jik.nishitetsu.jp/traffic/default.htm',
    KEY: 'off:nishitetsu:v1',
    RELAY: (u) => 'https://r.jina.ai/' + u,
    TTL: { x: 55 * 1000, chien: 120 * 1000, jik: 180 * 1000 },
    x: { status: 'idle', at: 0, posts: [], error: '', failed: false },
    chien: { status: 'idle', at: 0, day: '', rows: [], error: '', failed: false },
    jik: { status: 'idle', at: 0, text: '', secs: [], error: '', failed: false },
  };

  const offHM = (ts) => {
    const d = new Date(ts);
    return `${esPad(d.getHours())}:${esPad(d.getMinutes())}`;
  };
  /* 日付は4時で切り替わる（在線・えれサイトと同じ扱い） */
  function offToday() {
    const d = new Date();
    if (d.getHours() < 4) d.setDate(d.getDate() - 1);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
  function offClean(s) {
    return String(s == null ? '' : s)
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[>#`]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function offAgeLbl(label) {
    const m = String(label || '').trim().match(/^(\d+)\s*([mhd])$/i);
    if (!m) return null;
    const n = +m[1], u = m[2].toLowerCase();
    return u === 'm' ? n : u === 'h' ? n * 60 : n * 1440;
  }
  async function offRelay(url) {
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), 18000);
    try {
      const res = await fetch(OFF.RELAY(url), { cache: 'no-store', credentials: 'omit', signal: ctl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.text();
    } finally { clearTimeout(tm); }
  }
  /* 公式Xの公開ページ（中継で読んだ本文）から投稿を抜く */
  function offParseX(md) {
    const text = String(md || '');
    const out = [];
    const blocks = text.split(/\[\]\(https:\/\/x\.com\/compose\/post\?in_reply_to=\d+\)/);
    for (const b of blocks) {
      const ids = [...b.matchAll(/https:\/\/x\.com\/nishitetsu_info\/status\/(\d+)\)/g)];
      if (!ids.length) continue;
      const last = ids[ids.length - 1];
      const id = last[1];
      const body = offClean(b.slice(last.index + last[0].length));
      if (!body || body.length < 4) continue;
      const labels = [...b.matchAll(new RegExp('\\[([^\\]]*)\\]\\(https://x\\.com/nishitetsu_info/status/' + id + '\\)', 'g'))]
        .map((m) => m[1]).filter(Boolean);
      out.push({ id, label: labels.length ? labels[labels.length - 1] : '', body });
    }
    const seen = {};
    return out.filter((p) => (seen[p.id] ? false : (seen[p.id] = 1)));
  }
  /* 公式 遅延証明書の表（日付ごと・時間帯ごと） */
  function offParseChien(md) {
    const lines = String(md || '').split(/\r?\n/);
    let day = '';
    const byDay = {};
    for (const raw of lines) {
      const s = raw.trim();
      const dh = s.match(/^\|\s*(\d{4})年(\d{1,2})月(\d{1,2})日\s*\|/);
      if (dh) { day = `${+dh[2]}/${+dh[3]}`; byDay[day] = []; continue; }
      const rm = s.match(/^\|([^|]+)\|([^|]+)\|$/);
      if (!rm || !day) continue;
      const band = offClean(rm[1]);
      const val = offClean(rm[2]);
      if (!band || band === '---') continue;
      const mm = val.match(/(\d+)\s*分の遅延/);
      byDay[day].push({ band, text: val, min: mm ? +mm[1] : 0 });
    }
    const today = offToday();
    return { day: today, rows: byDay[today] || [], days: byDay };
  }
  /* 公式 運行状況ページ（見出しごとの本文） */
  function offParseJik(md) {
    const text = String(md || '');
    const i = text.indexOf('Markdown Content');
    const body = i >= 0 ? text.slice(i) : text;
    const secs = [];
    for (const part of body.split(/^#{2,4}\s*/m)) {
      const nl = part.indexOf('\n');
      if (nl < 0) continue;
      const title = offClean(part.slice(0, nl));
      let txt = offClean(part.slice(nl + 1));
      const cut = txt.indexOf('以下のサイトから');
      if (cut >= 0) txt = txt.slice(0, cut).trim();
      if (!title || !txt || txt.length < 4) continue;
      if (!/高速バス|電車|列車|運行/.test(title)) continue;
      secs.push({ title, text: txt.slice(0, 400) });
    }
    return secs;
  }

  async function offFetchX(force) {
    if (!force && (OFF.x.status === 'loading' || (OFF.x.at && Date.now() - OFF.x.at < OFF.TTL.x))) return;
    OFF.x.status = 'loading';
    try {
      const md = await offRelay(OFF.X);
      const posts = offParseX(md);
      if (!posts.length) throw new Error('投稿を読めませんでした');
      OFF.x.posts = posts.slice(0, 12);
      OFF.x.at = Date.now(); OFF.x.status = 'ready'; OFF.x.error = ''; OFF.x.failed = false;
    } catch (e) {
      OFF.x.failed = true;
      OFF.x.error = /HTTP 4\d\d/.test(String((e && e.message) || '')) ? '中継の回数制限で取得できませんでした' : '公式Xを取得できません';
      OFF.x.status = OFF.x.posts.length ? 'ready' : 'error';
    }
    offSave(); offRepaint();
  }
  async function offFetchChien(force) {
    if (!force && (OFF.chien.status === 'loading' || (OFF.chien.at && Date.now() - OFF.chien.at < OFF.TTL.chien))) return;
    OFF.chien.status = 'loading';
    try {
      const md = await offRelay(OFF.CHIEN);
      const d = offParseChien(md);
      if (!d.rows.length && !Object.keys(d.days).length) throw new Error('表を読めませんでした');
      OFF.chien.day = d.day; OFF.chien.rows = d.rows;
      OFF.chien.at = Date.now(); OFF.chien.status = 'ready'; OFF.chien.error = ''; OFF.chien.failed = false;
    } catch (e) {
      OFF.chien.failed = true;
      OFF.chien.error = '遅延証明書を取得できません';
      OFF.chien.status = OFF.chien.rows.length ? 'ready' : 'error';
    }
    offSave(); offRepaint();
  }
  async function offFetchJik(force) {
    if (!force && (OFF.jik.status === 'loading' || (OFF.jik.at && Date.now() - OFF.jik.at < OFF.TTL.jik))) return;
    OFF.jik.status = 'loading';
    try {
      const md = await offRelay(OFF.JIK);
      const secs = offParseJik(md);
      OFF.jik.secs = secs;
      OFF.jik.text = secs.map((s) => `${s.title}：${s.text}`).join(' ／ ').slice(0, 800);
      OFF.jik.at = Date.now(); OFF.jik.status = 'ready'; OFF.jik.error = ''; OFF.jik.failed = false;
    } catch (e) {
      OFF.jik.failed = true;
      OFF.jik.error = '運行状況ページを取得できません';
      OFF.jik.status = OFF.jik.text ? 'ready' : 'error';
    }
    offSave(); offRepaint();
  }
  function offFetchAll(force) {
    offFetchX(force);
    offFetchChien(force);
    offFetchJik(force);
  }
  function offLoad() {
    try {
      const raw = localStorage.getItem(OFF.KEY);
      if (!raw) return;
      const c = JSON.parse(raw) || {};
      if (c.x && c.x.at && Array.isArray(c.x.posts) && c.x.posts.length) {
        OFF.x = { status: 'ready', at: c.x.at, posts: c.x.posts, error: '', failed: false };
      }
      if (c.chien && c.chien.at) {
        OFF.chien = { status: 'ready', at: c.chien.at, day: c.chien.day || '', rows: c.chien.rows || [], error: '', failed: false };
      }
      if (c.jik && c.jik.at) {
        OFF.jik = { status: 'ready', at: c.jik.at, text: c.jik.text || '', secs: c.jik.secs || [], error: '', failed: false };
      }
    } catch (e) { /* 無視 */ }
  }
  function offSave() {
    try {
      localStorage.setItem(OFF.KEY, JSON.stringify({
        x: { at: OFF.x.at, posts: OFF.x.posts },
        chien: { at: OFF.chien.at, day: OFF.chien.day, rows: OFF.chien.rows },
        jik: { at: OFF.jik.at, text: OFF.jik.text, secs: OFF.jik.secs },
      }));
    } catch (e) { /* 無視 */ }
  }

  const OFF_OK = /(運転を再開|運転再開|通常どおり|平常どおり|通常運転|平常運転)/;
  const OFF_NG = /(運転を見合わせ|見合わせ|運転中止|運休|取りやめ|遅れ|遅延|人身|事故|信号|架線|車両故障|車両点検|徐行|折り返し運転|一部列車|乱れ|直通)/;
  /* 投稿に線区・区分・時刻を付ける（新しい順のまま） */
  function offPosts() {
    return OFF.x.posts.map((p) => {
      const b = String(p.body || '');
      const kind = OFF_OK.test(b) ? 'normal' : OFF_NG.test(b) ? 'abnormal' : 'info';
      const d = b.match(/(\d{1,2})月(\d{1,2})日(\d{1,2})時/);
      const atLabel = d ? `${d[1]}月${d[2]}日${d[3]}時 現在` : '';
      let ageMin = offAgeLbl(p.label);
      if (d) {
        const now = new Date();
        let t = new Date(now.getFullYear(), +d[1] - 1, +d[2], +d[3], 0, 0);
        if (t.getTime() - now.getTime() > 3 * 3600e3) t = new Date(t.getTime() - 86400e3);
        ageMin = Math.round((now.getTime() - t.getTime()) / 60000);
      }
      const line = /天神大牟田線|太宰府線|甘木線/.test(b) ? 'tmm' : /貝塚線/.test(b) ? 'kzk' : '';
      return { id: p.id, label: p.label, body: b, kind, atLabel, ageMin, line };
    });
  }
  /* 公式の状態をひとつにまとめる（公式X → 遅延証明書 の順に新しい事実を採る） */
  function offDigest() {
    const posts = offPosts();
    const pick = (ln) => posts.find((p) => p.line === ln) || null;
    const tmm = pick('tmm'), kzk = pick('kzk');
    const rows = OFF.chien.day === offToday() ? (OFF.chien.rows || []) : [];
    const dely = rows.filter((r) => r.min >= 5);
    const cur = rows.length ? rows[rows.length - 1] : null;
    const dg = posDigest();
    const est = !!(dg && (dg.maxDelay >= 5 || dg.missing >= 3));
    const recent = (p) => !!(p && p.ageMin != null && p.ageMin <= 360);
    const live = (p) => !!(p && p.kind === 'abnormal' && recent(p));
    let level = 'unknown', head = '公式の運行情報：未取得', body = 'タップすると公式Xの取得を試みます。', when = '', src = '', srcTime = '';
    if (live(tmm) || live(kzk)) {
      const p = live(tmm) ? tmm : kzk;
      level = 'alert';
      head = `${p.line === 'kzk' ? '貝塚線' : '天神大牟田線'}：運行異常のお知らせ`;
      body = p.body;
      when = p.atLabel || (p.label ? `${p.label}前` : '');
      src = '公式X @nishitetsu_info'; srcTime = OFF.x.at ? offHM(OFF.x.at) : '';
    } else if (cur && cur.min >= 5) {
      level = 'delay';
      head = `本日 ${cur.min}分の遅延（公式 遅延証明書）`;
      body = `${cur.band}の時間帯に${cur.min}分の遅延が記録されています。${tmm ? `（公式Xの最新：${tmm.atLabel || '最新'} ${tmm.body}）` : ''}`;
      when = cur.band;
      src = '公式 遅延証明書'; srcTime = OFF.chien.at ? offHM(OFF.chien.at) : '';
    } else if (tmm && tmm.kind === 'normal' && recent(tmm)) {
      level = 'normal';
      head = /再開/.test(tmm.body) ? '運転を再開' : '平常運転';
      body = tmm.body;
      when = tmm.atLabel || '';
      src = '公式X @nishitetsu_info'; srcTime = OFF.x.at ? offHM(OFF.x.at) : '';
    } else if (rows.length) {
      level = 'normal';
      head = '本日ここまで5分以上の遅延なし';
      body = tmm ? `公式Xの最新：${tmm.atLabel || ''} ${tmm.body}` : '公式Xの新しい発表はありません。';
      src = '公式 遅延証明書'; srcTime = OFF.chien.at ? offHM(OFF.chien.at) : '';
    }
    return { posts, tmm, kzk, rows, dely, cur, level, head, body, when, src, srcTime, est, dg };
  }

  /* 指令タブ上部の常設バナー */
  function offBannerHTML() {
    const g = offDigest();
    const ng = OFF.x.failed ? `<em class="ob-ng">更新できませんでした</em>` : '';
    const srcTxt = g.src ? `出典：${esc(g.src)}${g.srcTime ? `（${esc(g.srcTime)}取得）` : ''}` : '出典：西鉄公式（未取得）';
    return `<div class="offb ${g.level}">
        <button class="offb-main" type="button" data-off-detail>
          <span class="ob-tag">公式</span>
          <span class="ob-head"><b>${esc(g.head)}</b>${g.when ? `<em>${esc(g.when)}</em>` : ''}</span>
          <span class="ob-body">${esc(g.body)}</span>
          <span class="ob-src">${srcTxt}${ng}</span>
        </button>
        <div class="ob-links">
          <a href="${OFF.X}" target="_blank" rel="noopener noreferrer">公式X</a>
          <a href="${OFF.CHIEN}" target="_blank" rel="noopener noreferrer">遅延証明書</a>
          <button type="button" data-off-refresh>更新</button>
        </div>
      </div>${g.est ? `<div class="offb-est"><b>推定</b>在線データでは遅延 最大${g.dg.maxDelay}分・未在線 ${g.dg.missing}本（公式発表ではありません）</div>` : ''}`;
  }
  /* 行路・ダイヤ用の1行ストリップ */
  function offStripHTML() {
    const g = offDigest();
    const t = g.level === 'unknown'
      ? '公式の運行情報はまだ取得していません（タップで取得）'
      : `${g.head}${g.when ? `・${g.when}` : ''}`;
    const sub = (g.level === 'alert' || g.level === 'delay') ? g.body : '';
    const est = g.est && g.level !== 'alert' ? `在線推定 +${g.dg.maxDelay}分` : '';
    return `<button class="off-strip ${g.level}" type="button" data-off-detail>
        <span class="os-tag">${g.level === 'alert' || g.level === 'delay' ? '⚠ 公式' : '公式'}</span>
        <span class="os-text"><b>${esc(t)}</b>${sub ? `<i>${esc(sub)}</i>` : ''}${est ? `<i>${esc(est)}</i>` : ''}</span>
        <span class="os-go">›</span>
      </button>`;
  }
  function offRepaint() {
    const b = $('#offBanner');
    if (b) b.innerHTML = offBannerHTML();
    $$('.off-strip').forEach((el) => { el.outerHTML = offStripHTML(); });
  }
  /* 公式の内訳（出典ごとに分けて表示） */
  function openOffDetail() {
    const g = offDigest();
    const posts = g.posts.slice(0, 6);
    const lineName = (l) => (l === 'tmm' ? '天神大牟田線' : l === 'kzk' ? '貝塚線' : 'お知らせ');
    const postHTML = posts.length
      ? posts.map((p) => `<div class="off-post ${p.kind}">
          <div class="op-h"><span>${esc(lineName(p.line))}</span><em>${esc(p.atLabel || (p.label ? p.label + '前' : ''))}</em></div>
          <p>${esc(p.body)}</p></div>`).join('')
      : `<p class="empty">${OFF.x.status === 'loading' ? '取得中…' : '公式Xを取得できていません。'}</p>`;
    const chienHTML = g.rows.length
      ? `<div class="off-tbl">${g.rows.map((r) => `<div class="otr ${r.min >= 5 ? 'warn' : ''}"><span>${esc(r.band)}</span><b>${r.min >= 5 ? `${r.min}分の遅延` : '遅延なし'}</b></div>`).join('')}</div>`
      : `<p class="empty">${OFF.chien.status === 'loading' ? '取得中…' : '本日の掲載はまだありません。'}</p>`;
    const jikHTML = (OFF.jik.secs && OFF.jik.secs.length)
      ? OFF.jik.secs.map((s) => `<div class="off-sec"><b>${esc(s.title)}</b><p>${esc(s.text)}</p></div>`).join('')
      : `<p class="empty">${OFF.jik.status === 'loading' ? '取得中…' : '取得できていません。'}</p>`;
    showSheet(`<div class="sheet-head"><h2>西鉄公式 運行情報</h2><button class="sheet-close" data-close>✕</button></div>
      <div class="off-detail">
        <div class="off-hero ${g.level}"><b>${esc(g.head)}</b><span>${esc(g.body)}</span></div>
        <div class="btn-row">
          <button class="btn primary" data-off-reload>再取得</button>
          <a class="btn" href="${OFF.X}" target="_blank" rel="noopener noreferrer">公式X</a>
          <a class="btn" href="${OFF.CHIEN}" target="_blank" rel="noopener noreferrer">遅延証明書</a>
          <a class="btn" href="${OFF.JIK}" target="_blank" rel="noopener noreferrer">運行状況</a>
        </div>
        <h4 class="tl-title">公式X @nishitetsu_info<span class="off-when">${OFF.x.at ? `${esc(esClock(OFF.x.at))} 取得` : '未取得'}${OFF.x.failed ? '・更新できませんでした' : ''}</span></h4>
        <p class="off-note">西鉄電車の運行情報の公式アカウントです（列車が20分以上遅延する場合等に発表）。</p>
        <div class="off-posts">${postHTML}</div>
        <h4 class="tl-title">公式 遅延証明書（本日・5分以上）<span class="off-when">${OFF.chien.at ? `${esc(esClock(OFF.chien.at))} 取得` : '未取得'}</span></h4>
        ${chienHTML}
        <h4 class="tl-title">公式 運行状況<span class="off-when">${OFF.jik.at ? `${esc(esClock(OFF.jik.at))} 取得` : '未取得'}</span></h4>
        ${jikHTML}
        <h4 class="tl-title">在線データからの推定</h4>
        ${g.dg ? `<p class="off-note">在線 ${g.dg.running}本 ・ 遅延 ${g.dg.delayed}本${g.dg.maxDelay ? `（最大 ${g.dg.maxDelay}分）` : ''} ・ 未在線 ${g.dg.missing}本。公式発表ではなく、在線位置と定刻の突き合わせによる推定です。</p>` : '<p class="empty">在線データを取得していません。</p>'}
        <p class="es-caution">公式サイトは CORS の制限で直接読めないため、中継サービス（r.jina.ai）経由で本文を取得しています。取得できないときは「未取得」と表示し、公式ページへのリンクを出しています。遅延証明書は5分以上の遅延のみ・時間帯単位の掲載です。乗務前は公式の発表と駅の案内でご確認ください。</p>
      </div>`, () => {
      const rb = $('#sheetBody [data-off-reload]');
      if (rb) rb.addEventListener('click', async () => {
        rb.disabled = true; rb.textContent = '取得中…';
        await Promise.all([offFetchX(true), offFetchChien(true), offFetchJik(true)]);
        openOffDetail();
      });
    });
  }

  /* ================= 指令室（運行管理卓） =================
     西鉄「列車走行位置」（busnavi-railway.nnr.co.jp）の在線情報を、駅ブロック単位の
     位置として路線ボード（指令室）に並べ、列番・種別・行先・遅延・車号・行路を連携する。
     ・位置＝公式の在線情報（駅ブロック単位・数十秒〜数分前の情報）
     ・「停車中／駅間走行中」＝公式の位置行と定刻（＋遅延）の突き合わせによる推定
     ・在線情報に無い列車＝定刻上は運転中なら「未在線（運休・見合わせ等の可能性）」として推定表示
     ・太宰府線・甘木線は公式の在線情報の対象外（分岐駅の情報と時刻表から推定）
     ・回送列車も公式の対象外のため、乗務データ（行路 legs）の時刻から位置を推定する
     公式に無い値を埋めることはしない。推定は画面上でも「推定」と明示する。
     ========================================================= */
  const CMD = {
    filter: 'all',          // all | delay | lost | roster
    zoom: 160,              // 配線図ボード（画像）の表示幅 %
    scroll: 0,
    sel: null,
    more: false,
    auto: localStorage.getItem('cmd:auto') !== '0',
  };
  const CMD_ZOOM_STEPS = [100, 160, 230];
  const CMD_TYPE_COLOR = { ltd: '#ff6b61', exp: '#3ecf8e', loc: '#6aa9ff', dead: '#9aa4b5' };
  const CMD_DEPOT = { '筑紫': '筑紫基地', '花畑': '花畑基地', '西鉄柳川': '柳川基地' };
  const CMD_MAJOR = ['福岡(天神)', '大橋', '西鉄二日市', '筑紫', '西鉄小郡', '花畑', '西鉄久留米', '大善寺', '西鉄柳川', '大牟田'];
  /* ボード用の短縮駅名（縦書きで4文字以内に収める） */
  const CMD_SHORT = {
    '福岡(天神)': '天神', '西鉄平尾': '平尾', '都府楼前': '都府楼', '西鉄二日市': '二日市', '朝倉街道': '朝倉',
    '三国が丘': '三国', '西鉄小郡': '小郡', '西鉄久留米': '久留米', '聖マリア病院前': '聖マリア',
    '八丁牟田': '八丁', '西鉄柳川': '柳川', '西鉄中島': '中島', '西鉄渡瀬': '渡瀬', '西鉄銀水': '銀水',
    '西鉄五条': '五条',
  };
  const cmdName = (n) => CMD_SHORT[n] || SHORT[n] || n;
  const CMD_BRANCH = [
    {
      id: 'dz', name: '太宰府線', join: '西鉄二日市',
      order: ['西鉄二日市', '西鉄五条', '太宰府'],
      code: { '西鉄二日市': 'T13', '西鉄五条': 'D01', '太宰府': 'D02' },
    },
    {
      id: 'ag', name: '甘木線', join: '宮の陣',
      order: ['宮の陣', '五郎丸', '学校前', '古賀茶屋', '北野', '大城', '金島', '大堰', '本郷', '上浦', '馬田', '甘木'],
      code: { '宮の陣': 'T25', '五郎丸': 'A11', '学校前': 'A10', '古賀茶屋': 'A09', '北野': 'A08', '大城': 'A07', '金島': 'A06', '大堰': 'A05', '本郷': 'A04', '上浦': 'A03', '馬田': 'A02', '甘木': 'A01' },
    },
  ];
  const CMD_BRANCH_OF = {};
  CMD_BRANCH.forEach((b) => b.order.forEach((n) => { if (!CMD_BRANCH_OF[n]) CMD_BRANCH_OF[n] = b.id; }));
  /* 本線に無い（支線だけの）駅。MAIN は後段で定義されるため、ここでは実名で持つ */
  const CMD_BRANCH_STN = ['西鉄五条', '太宰府', '五郎丸', '学校前', '古賀茶屋', '北野', '大城', '金島', '大堰', '本郷', '上浦', '馬田', '甘木'];
  const cmdIsBranch = (name) => CMD_BRANCH_STN.indexOf(name) >= 0;

  /* ---- 列番の頭数字＝線区【2026-11-19 本人確認「6が太宰府線、7が甘木線」】----
     4桁列番の千の位で系統が決まる：6xxx＝太宰府線、7xxx＝甘木線。
     編成両数表のデータでも裏が取れている（平日：6xxx 149本すべてが西鉄二日市⇔太宰府、
     7xxx 80本すべてが甘木発着＝甘木側が支線で、反対側は本線へ直通）。
     6xxx は本線を走らないので、公式在線の row（本線の駅ブロック）では表せない。
     7xxx は甘木線と本線を直通するため、支線の区間だけを支線として扱う。 */
  const CMD_LINE_OF_NO = { '6': 'dz', '7': 'ag' };
  const CMD_LINE_NAME = { dz: '太宰府線', ag: '甘木線' };
  const CMD_LINE_HEAD = { dz: '6', ag: '7' };
  const CMD_LINE_TERM = { dz: '太宰府', ag: '甘木' };
  const cmdLineOfNo = (no) => CMD_LINE_OF_NO[String(no == null ? '' : no).charAt(0)] || null;
  /* 公式在線の col は線の並び。支線（太宰府線・甘木線）を走る列車は 5・6 に入り、
     本線の列車は 1〜4。支線の列車の row は本線の駅に読み替えられない座標になる */
  const CMD_BRANCH_COL = 5;

  /* 支線区間：停車駅の並びのうち、支線の駅が連続している部分を切り出す。
     直通列車（7xxx の本線側・太宰府直通の急行）でも支線内だけを支線として扱える。
     戻り値：{ b, i0, i1, ks }（i0/i1＝停車駅 index、ks[i]＝その駅の支線の駅順） */
  function cmdBranchSeg(sch, bid) {
    if (!sch || sch.length < 2) return null;
    const b = CMD_BRANCH.find((x) => x.id === bid);
    if (!b) return null;
    const ks = sch.map((s) => b.order.indexOf(s.name));
    let best = null;
    for (let i = 0; i < ks.length; i++) {
      if (ks[i] < 0) continue;
      let j = i;
      while (j + 1 < ks.length && ks[j + 1] >= 0) j++;
      if (!best || (j - i) > (best.i1 - best.i0)) best = { i0: i, i1: j };
      i = j;
    }
    if (!best) return null;
    return { b, i0: best.i0, i1: best.i1, ks };
  }
  /* 支線区間内の位置（支線の駅順の小数＝0が分岐駅、末尾が終点）を時刻から求める。
     区間の外なら null。at＝駅に停車中／prev〜next＝駅間 */
  function cmdBranchAt(sch, seg, t) {
    if (!seg || t == null || !isFinite(t)) return null;
    const ks = seg.ks;
    for (let i = seg.i0; i <= seg.i1; i++) {
      const s = sch[i];
      const a = s.arr, d = s.dep;
      if (a != null && d != null && t >= a && t < d) return { pos: ks[i], at: true, name: s.name, prev: null, next: null };
      if (a == null && d != null && t < d) return { pos: ks[i], at: true, name: s.name, prev: null, next: null };
      if (i < seg.i1) {
        const n = sch[i + 1];
        const d0 = d != null ? d : a;
        const a1 = n.arr != null ? n.arr : n.dep;
        if (d0 != null && a1 != null && t >= d0 && t < a1) {
          const fr = Math.max(0, Math.min(1, (t - d0) / Math.max(1, a1 - d0)));
          return { pos: ks[i] + (ks[i + 1] - ks[i]) * fr, at: false, name: null, prev: s.name, next: n.name };
        }
      }
    }
    return null;
  }
  /* この列車の系統の支線：列番の頭数字（6/7）を第一に、無ければ支線だけの駅で判定する。
     分岐駅（西鉄二日市・宮の陣）だけでは支線と決めない（本線の列車も発着するため） */
  function cmdBranchOfNo(dt, no) {
    const lineNo = cmdLineOfNo(no);
    if (lineNo) return lineNo;
    const rec = trainRec(dt, no);
    if (!rec) return null;
    const f = canon(rec.from), t = canon(rec.to);
    const a = cmdIsBranch(f) ? CMD_BRANCH_OF[f] : null;
    const b = cmdIsBranch(t) ? CMD_BRANCH_OF[t] : null;
    return a || b || null;
  }
  /* 列車の支線内の位置（時刻 t のとき）。支線区間の外なら null */
  function cmdBranchPos(dt, no, t, sch0) {
    const bid = cmdBranchOfNo(dt, no);
    if (!bid) return null;
    const sch = sch0 || trainSched(dt, no);
    const seg = cmdBranchSeg(sch, bid);
    const at = cmdBranchAt(sch, seg, t);
    if (!at) return null;
    return { bid, seg, at };
  }
  /* 支線を走っている列車の cmdInfo。位置は時刻表の各駅時刻から推定する
     （公式在線の row は支線の座標系で、本線の駅に読み替えられないため） */
  function cmdBranchInfo(no, p, dt, t, dl) {
    const bid0 = cmdBranchOfNo(dt, no);
    if (!bid0) return null;
    const sch = trainSched(dt, no);
    const seg = cmdBranchSeg(sch, bid0);
    if (!seg) return null;
    const b = seg.b;
    let br = cmdBranchAt(sch, seg, t);
    if (!br) {
      /* 公式の col が支線側の線なのに時刻が区間の外なら、分岐駅／終点に寄せて出す
         （本線の駅に置かないため）。col が本線側なら本線の列車として扱う */
      if (!(Number(p.col) >= CMD_BRANCH_COL)) return null;
      const s0 = sch[seg.i0], s1 = sch[seg.i1];
      const t0 = s0.dep != null ? s0.dep : s0.arr;
      const k = (t != null && t0 != null && t < t0) ? seg.ks[seg.i0] : seg.ks[seg.i1];
      br = { pos: k, at: true, name: b.order[k], prev: null, next: null, edge: true };
    }
    const rec = trainRec(dt, no) || {};
    const dir = seg.ks[seg.i1] < seg.ks[seg.i0] ? 'up' : 'down';
    return {
      no, branch: b.id, line: b.name, lineHead: CMD_LINE_HEAD[b.id], est: true,
      bpos: br.pos, bsize: Math.max(1, b.order.length - 1),
      idx: null, row: Number(p.row), col: Number(p.col) || 0,
      st: br.at ? br.name : '', prev: br.prev, next: br.next, frac: 0, dir,
      delay: dl, at: br.at, pred: br, done: false, edge: !!br.edge,
      type: p.type || rec.type || '', dest: p.dest || (rec.to ? canon(rec.to) : ''),
      cars: p.cars || '', doors: p.doors || '',
      where: br.at ? `${b.name} ${br.name} 停車中` : `${b.name} ${br.prev}〜${br.next} 走行中`,
      short: br.at ? cmdName(br.name) : `${cmdName(br.prev)}〜${cmdName(br.next)}`,
    };
  }

  /* ---- 公式在線情報の行番号 ↔ 駅（0〜3＝西鉄福岡(天神)、以降1駅3行） ---- */
  const posIdxOf = (row) => {
    const r = Number(row);
    if (!isFinite(r) || r < 0) return null;
    return r <= 3 ? 0 : 1 + Math.floor((r - 4) / 3);
  };
  const posRowBase = (i) => (i <= 0 ? 0 : 4 + (i - 1) * 3);
  const posRowSpan = (i) => (i === 0 ? 4 : 3);
  const posFracOf = (row, i) => {
    const v = (Number(row) - posRowBase(i)) / posRowSpan(i);
    return Math.max(0, Math.min(1, isFinite(v) ? v : 0.5));
  };
  const tCode = (i) => 'T' + String(i + 1).padStart(2, '0');
  const delayOf = (no) => {
    const p = POS.trains[no];
    if (!p) return null;
    if (String(p.delay || '') !== '') { const d = Number(p.delay); if (isFinite(d)) return d; }
    const m = String(p.delayMin || '').match(/(\d+)\s*分/);
    return m ? +m[1] : 0;
  };
  /* 公式JSONの生成時刻（4時前は前日扱いの分） */
  function posFileMin() {
    const s = String(POS.fileTime || '');
    if (s.length < 12) return null;
    const h = +s.slice(8, 10), m = +s.slice(10, 12);
    if (!isFinite(h) || !isFinite(m)) return null;
    return (h < 4 ? h + 24 : h) * 60 + m;
  }
  /* 列番の時刻表（stops.js 優先、無ければ編成両数表の始発・終着だけ） */
  function trainSched(dt, no) {
    const seq = stopsOf(dt, no);
    if (seq && seq.length >= 2) {
      const a = seq.map(([si, ar, dp]) => ({ name: stopName(si), arr: ar, dep: dp }));
      a.full = true;
      return a;
    }
    const r = trainRec(dt, no);
    if (!r) return null;
    const a = toMin(r.dep), b = toMin(r.arr);
    if (a == null || b == null) return null;
    const list = [{ name: canon(r.from), arr: null, dep: a }, { name: canon(r.to), arr: b, dep: null }];
    list.full = false;          // 各駅の時刻が無い（始発・終着だけ）
    return list;
  }
  /* 定刻＋遅延で「いま駅に停まっているか／駅間か」を推定 */
  function schedAt(sch, t) {
    if (!sch || !sch.length) return null;
    for (let i = 0; i < sch.length; i++) {
      const s = sch[i], a = s.arr, d = s.dep;
      if (a == null && d != null && t < d) return { at: true, name: s.name, i };
      if (a != null && d != null && t >= a && t < d) return { at: true, name: s.name, i };
      if (a != null && t < a) return { at: false, name: s.name, from: i > 0 ? sch[i - 1].name : null, i };
    }
    return { at: false, name: sch[sch.length - 1].name, from: sch.length > 1 ? sch[sch.length - 2].name : null, done: true, i: sch.length - 1 };
  }

  /* 列番1本ぶんの現在位置（公式の位置＋定刻からの推定） */
  function cmdInfo(no) {
    const p = POS.trains[no];
    if (!p) return null;
    const dt = todayType();
    const dl = delayOf(no) || 0;
    const f = posFileMin();
    /* 支線（6＝太宰府線／7＝甘木線、太宰府直通の急行）は先に支線で判定する。
       支線の列車の row は本線の駅に読み替えられないため、本線の配置には使わない */
    const bi = cmdBranchInfo(no, p, dt, f == null ? null : f + dl, dl);
    if (bi) return bi;
    const idx = posIdxOf(p.row);
    if (idx == null || idx >= MAIN.length) return null;
    const st = MAIN[idx];
    const prev = idx > 0 ? MAIN[idx - 1] : null;
    const next = idx < MAIN.length - 1 ? MAIN[idx + 1] : null;
    const sch = trainSched(dt, no);
    const pred = sch && f != null ? schedAt(sch, f + dl) : null;
    const at = !!(pred && pred.at && pred.name === st);
    const done = !!(pred && pred.done);
    const rec = trainRec(dt, no) || {};
    return {
      no, idx, row: Number(p.row), col: Number(p.col) || 0, st, prev, next,
      frac: posFracOf(p.row, idx),
      dir: String(p.dir) === '2' ? 'down' : 'up',
      delay: dl, at, pred, done,
      line: cmdLineOfNo(no) ? CMD_LINE_NAME[cmdLineOfNo(no)] : '',
      lineHead: cmdLineOfNo(no) ? CMD_LINE_HEAD[cmdLineOfNo(no)] : '',
      type: p.type || rec.type || '', dest: p.dest || (rec.to ? canon(rec.to) : ''),
      cars: p.cars || '', doors: p.doors || '',
      where: at ? `${st} 停車中` : (prev && next ? `${prev}〜${next} 走行中` : `${st} 付近`),
      short: at ? st : (prev && next ? `${SHORT[prev] || prev}〜${SHORT[next] || next}` : st),
    };
  }

  /* 在線情報に無い列車（定刻上は運転中）＝未在線の推定 */
  function cmdGhosts(dt) {
    if (POS.status !== 'ready') return [];
    const f = posFileMin();
    const data = STOPS.ready && STOPS.data && STOPS.data[dt] ? STOPS.data[dt] : null;
    if (f == null || !data) return [];
    const out = [];
    for (const no of Object.keys(data)) {
      if (POS.trains[no]) continue;
      const sch = trainSched(dt, no);
      if (!sch || sch.length < 2) continue;
      const s0 = sch[0], s1 = sch[sch.length - 1];
      const start = s0.dep != null ? s0.dep : s0.arr;
      const end = s1.arr != null ? s1.arr : s1.dep;
      if (start == null || end == null) continue;
      if (f < start + 3 || f >= end) continue;
      const rec = trainRec(dt, no) || {};
      if (/回送/.test(rec.type || '')) continue;
      const pred = schedAt(sch, f);
      const nm = (pred && pred.name) || s0.name;
      const i0 = MAIN.indexOf(s0.name), i1 = MAIN.indexOf(s1.name);
      /* 支線の判定：列番の頭数字（6＝太宰府線／7＝甘木線）で系統を決め、その支線の
         区間内にいれば支線として扱う。6xxxは本線を走らないので、西鉄二日市にいても
         「未在線（運休の可能性）」にしない。7xxxは本線区間にいれば未在線のまま */
      const lineNo = cmdBranchOfNo(dt, no);
      const bhit = lineNo ? cmdBranchPos(dt, no, f, sch) : null;
      const branch = !!bhit || cmdIsBranch(nm) || (i0 < 0 && i1 < 0);
      const bid = bhit ? bhit.bid : (cmdIsBranch(nm) ? CMD_BRANCH_OF[nm] : (i0 < 0 && i1 < 0 ? lineNo : null));
      const dir = bhit ? (bhit.seg.ks[bhit.seg.i1] < bhit.seg.ks[bhit.seg.i0] ? 'up' : 'down')
        : (i0 >= 0 && i1 >= 0 ? (i1 > i0 ? 'down' : 'up') : 'down');
      out.push({
        no, type: rec.type || '', from: s0.name, to: s1.name, start, end,
        at: nm, branch, bid, bpos: bhit ? bhit.at.pos : null,
        line: bid ? CMD_LINE_NAME[bid] : '', lineHead: bid ? CMD_LINE_HEAD[bid] : '',
        dir, dest: s1.name,
        minLate: Math.max(0, Math.round(f - start)),
      });
    }
    return out;
  }

  /* 支線内の列車（公式在線情報の対象外・時刻表から推定） */
  function cmdBranchTrains(dt) {
    const f = posFileMin();
    const res = { dz: [], ag: [] };
    if (f == null) return res;
    const all = D.trains[dt] || {};
    for (const no of Object.keys(all)) {
      const r = trainRec(dt, no);
      if (!r) continue;
      const from = canon(r.from), to = canon(r.to);
      const a = toMin(r.dep), b = toMin(r.arr);
      if (a == null || b == null) continue;
      const t = f + (delayOf(no) || 0);
      if (t < a || t >= b) continue;
      const bid = CMD_BRANCH_OF[from] || CMD_BRANCH_OF[to];
      if (!bid) continue;
      const br = CMD_BRANCH.find((x) => x.id === bid);
      const i0 = br.order.indexOf(from), i1 = br.order.indexOf(to);
      if (i0 < 0 || i1 < 0) continue;     // 支線→本線をまたぐ列車は本線側で扱う
      const frac = Math.max(0, Math.min(1, (t - a) / Math.max(1, b - a)));
      res[bid].push({ no, type: r.type || '', pos: i0 + (i1 - i0) * frac, dest: to, delay: delayOf(no) || 0 });
    }
    return res;
  }

  /* 回送列車の推定（在線情報に載らないため、乗務データ＝行路 legs から導出する）
     識別根拠：leg の列番について D.trains の種別が「回送／回送ワ」であること。
     系統文字列に「回」の表記は無く、基地発着 leg でも営業列車（入出庫作業つき）は
     回送運転そのものではないため、種別を唯一の根拠にする。
     ・単独列番の leg：leg の bt/at と発着（bst/ast・基地種別）がそのまま回送区間
       （trainRec の dep/arr と一致することをデータで確認済み）。
     ・複数列番の leg（営業列車から続けて乗務する等）：回送列車自身の
       trainRec（始発・終着・時刻）を区間として切り出す。
     位置は発駅→着駅を MAIN の駅順に時刻で線形補間する（支線推定と同じ考え方）。
     運行時に APP_DATA から導出するので、legs が補完されれば対象は自動で増える。 */
  const CMD_DEPOT_NAME = {};
  (D.depots || []).forEach((x) => { CMD_DEPOT_NAME[x.station] = x.name; });
  const CMD_DEPOT_SHORT = { '筑紫車両基地': '筑紫基地', '花畑車両基地': '花畑基地', '柳川車両基地': '柳川基地' };
  const cmdStnIdx = (name) => {
    if (!name) return -1;
    const n = String(name).replace(/（/g, '(').replace(/）/g, ')').replace(/駅$/, '');
    if (IDX[n] != null) return IDX[n];
    const c = canon(n);
    if (IDX[c] != null) return IDX[c];
    const s = n.replace(/^西鉄/, '');
    if (IDX[s] != null) return IDX[s];
    return -1;
  };
  function cmdDeadheads(dt) {
    const now = nowMin();
    const out = [];
    const seen = new Set();
    for (const p of D.patterns) {
      if (p.dayType !== dt) continue;
      for (const d of p.days) {
        for (const lg of (d.legs || [])) {
          for (const no of lg.t) {
            if (seen.has(no)) continue;
            const r = trainRec(dt, no);
            if (!r || !/回送/.test(r.type || '')) continue;
            seen.add(no);
            if (POS.trains[no]) continue;            // 在線フィードに同列番があればフィード優先
            let from, to, bt, at, fromDepot = false, toDepot = false;
            if (lg.t.length === 1) {
              bt = lg.bt; at = lg.at;
              from = lg.bst || lg.bn || ''; to = lg.ast || lg.an || '';
              fromDepot = lg.btype === 'depot'; toDepot = lg.atype === 'depot';
            } else {
              bt = toMin(r.dep); at = toMin(r.arr);
              from = r.from || ''; to = r.to || '';
              const fi = cmdStnIdx(from), ti = cmdStnIdx(to);
              if (lg.btype === 'depot' && fi >= 0 && cmdStnIdx(lg.bst || lg.bn || '') === fi) fromDepot = true;
              if (lg.atype === 'depot' && ti >= 0 && cmdStnIdx(lg.ast || lg.an || '') === ti) toDepot = true;
            }
            if (bt == null || at == null || at <= bt) continue;
            if (now < bt || now >= at) continue;
            const i0 = cmdStnIdx(from), i1 = cmdStnIdx(to);
            if (i0 < 0 || i1 < 0 || i0 === i1) continue;
            const frac = (now - bt) / (at - bt);
            const pos = i0 + (i1 - i0) * frac;
            const fName = MAIN[i0], tName = MAIN[i1];
            const fDisp = fromDepot ? (CMD_DEPOT_SHORT[CMD_DEPOT_NAME[fName]] || CMD_DEPOT_NAME[fName] || fName) : fName;
            const tDisp = toDepot ? (CMD_DEPOT_SHORT[CMD_DEPOT_NAME[tName]] || CMD_DEPOT_NAME[tName] || tName) : tName;
            out.push({
              no, type: r.type, from: fName, to: tName, bt, at, frac, pos,
              dir: i1 > i0 ? 'down' : 'up',
              fromDepot, toDepot,
              dest: tDisp,
              at: MAIN[Math.max(0, Math.min(MAIN.length - 1, Math.round(pos)))],
              where: `${fDisp} → ${tDisp} 回送中（推定）`,
            });
          }
        }
      }
    }
    return out;
  }

  /* 指令室の集計（1回の描画で使い回す） */
  let CMD_DG = { key: '', val: null };
  function cmdDigest() {
    const dt = todayType();
    const key = [POS.fetchedAt, POS.status, POS.fileTime, STOPS.status, dt, ES.status, ES.fetchedAt, Math.floor(Date.now() / 60000)].join('|');
    if (CMD_DG.key === key && CMD_DG.val) return CMD_DG.val;
    const live = Object.keys(POS.trains).map(cmdInfo).filter(Boolean);
    const ghosts = cmdGhosts(dt);
    const deads = cmdDeadheads(dt);
    const lost = ghosts.filter((g) => !g.branch);
    const onBranch = ghosts.filter((g) => g.branch);
    /* 支線内にいる列車：公式在線で支線の線にいるもの（6xxx・支線区間の7xxx）と
       在線情報に無い推定（ghosts）を合わせる。列番の頭数字 6＝太宰府線、7＝甘木線 */
    const branchLive = live.filter((t) => t.branch);
    const lineCount = {};
    CMD_BRANCH.forEach((b) => { lineCount[b.id] = 0; });
    live.forEach((t) => { if (t.branch) lineCount[t.branch] = (lineCount[t.branch] || 0) + 1; });
    onBranch.forEach((g) => { if (g.bid) lineCount[g.bid] = (lineCount[g.bid] || 0) + 1; });
    let delayed = 0, maxDelay = 0;
    live.forEach((t) => { if (t.delay > 0) { delayed++; if (t.delay > maxDelay) maxDelay = t.delay; } });
    const stale = POS.status === 'ready' && Date.now() - POS.fetchedAt > 3 * 60 * 1000;
    const val = { dt, live, ghosts, deads, lost, onBranch, branchLive, lineCount, delayed, maxDelay, stale, running: live.length };
    CMD_DG = { key, val };
    return val;
  }

  /* 指令室の輪番フィルタ用：選択中パターンの「今日のダイヤ種別・同No」の列番
     輪番画面で別種別（平日⇔土日祝）を選んだまま指令室へ来ても、今日の種別に読み替える */
  function rosterNos() {
    const sel = getPattern(state.pattern);
    const set = new Set();
    if (!sel) return { set, label: '', day: null };
    let p = sel;
    const dt = todayType();
    if (sel.dayType !== dt) p = patternsOf(dt).find((x) => x.no === sel.no) || sel;
    const ws = workDays(p);
    if (!ws.length) return { set, label: p.label, day: null };
    let day = null;
    if (state.diagramRow != null) day = ws.find((d) => d.row === state.diagramRow) || null;
    if (!day) {
      const now = nowMin();
      day = ws.find((d) => { const a = toMin(firstDep(d)), b = toMin(lastRet(d)); return a != null && b != null && now >= a && now <= b; }) || null;
    }
    if (!day) day = ws[0];
    tokenize(day.system || '').forEach((t) => { if (t.kind === 'train') set.add(t.v); });
    return { set, label: `${p.label} ${CIRC[day.dutyNo - 1]} ${day.row}日目`, day };
  }

  /* ---------- 指令室ボード ---------- */
  const cmdChipW = (step) => Math.max(30, Math.min(58, step - 8));
  function cmdChipHTML(it, step) {
    const w = cmdChipW(step);
    const dl = it.delay || 0;
    const cls = [typeClass(it.type), dl > 0 ? 'late' : '', it.kind !== 'live' ? it.kind : '', it.dim ? 'dim' : '', CMD.sel === it.no ? 'sel' : ''].filter(Boolean).join(' ');
    const carTxt = it.cars ? ` ・ 車 ${it.cars}` : '';
    const title = `${it.no} ${it.type || ''}${it.dest ? ' ' + it.dest + '行' : ''}　${it.where || ''}${dl ? '・' + dl + '分遅れ' : '・定時'}${carTxt}${it.kind === 'ghost' ? '（在線情報になし・推定）' : it.kind === 'branch' ? '（支線内・推定）' : ''}`;
    return `<button class="cchip ${cls}" style="left:${it.x.toFixed(1)}px;width:${w}px" data-cmd-train="${esc(it.no)}" title="${esc(title)}">
        <b>${esc(it.no)}</b>${dl > 0 && w >= 40 ? `<i>+${dl}</i>` : ''}${it.kind === 'ghost' ? '<u>?</u>' : ''}</button>`;
  }
  function cmdLanesHTML(items, step, pad) {
    const chipW = cmdChipW(step);
    const list = items.slice();
    list.forEach((it) => {
      it.x = pad + it.idx * step + ((it.frac == null ? 0.4 : it.frac) * 0.78 + 0.11) * step;
    });
    list.sort((a, b) => a.x - b.x);
    const lanes = [[], [], []];
    const last = [-1e9, -1e9, -1e9];
    list.forEach((it) => {
      const gap = chipW + 3;
      const free = (li) => it.x - last[li] >= gap;
      const pre = (it.col === 2 || it.col === 4) ? 1 : 0;
      const order = [pre, 1 - pre, 2];
      let li = order.find((k) => free(k));
      if (li == null) li = (it.x - last[0] > it.x - last[1]) ? 0 : 1;
      last[li] = it.x;
      lanes[li].push(it);
    });
    return lanes.filter((arr) => arr.length).map((arr) => `<div class="cmdb-lane">${arr.map((it) => cmdChipHTML(it, step)).join('')}</div>`).join('');
  }
  function cmdStationsHTML(names, codes, step, pad) {
    return names.map((n, i) => {
      const major = CMD_MAJOR.indexOf(n) >= 0;
      const dep = CMD_DEPOT[n];
      return `<div class="cstn${major ? ' major' : ''}${dep ? ' depot' : ''}" style="left:${(pad + i * step).toFixed(1)}px" title="${esc(n)}${codes[i] ? '（' + codes[i] + '）' : ''}">
        <i class="tick"></i><b class="tc">${esc(codes[i] || '')}</b><span class="nm">${esc(cmdName(n))}</span>${dep ? `<em class="dep">${esc(dep)}</em>` : ''}</div>`;
    }).join('');
  }
  /* ---------- 配線図ボード（v32） ----------
     実物の配線略図を土台に在線チップを重ねる：raildiag 図番号1285
     「西日本鉄道(西鉄) 配線略図」（紺狐）の画像（assets/track-map.jpg、
     1320×1124）から貝塚線の段（原図 y844〜961）を切り取って上下を繋いだ
     ものを使い、在線チップを絶対配置（%座標）で線路上に重ねる。
     v32（ユーザー指示 2026-11-19）：チップは指令室の壁面パネルのように
     線路の真上に乗る小さなマーカー（高さ13px）にし、線の割り当ては
     「上の線＝下り線／下の線＝上り線」に統一した（支線の単線オフセットも
     下り＝上側／上り＝下側）。遅延はチップ右上の小さなバッジで示す。
     駅座標は画像から実測したマッピング表（TKIMG_*）を使う：本線は段ごと
     （10駅）の駅プレート中心x・下り線y（上側）・上り線y（下側）、支線は
     駅ごとの点。甘木線は切り取り分（118px）だけ全体が上にずれている。
     位置は従来どおり駅ブロック単位で、番線レベルの特定はしない。
     番線レベルの詳細は下部の駅詳細パネル（二日市・天神）にだけ置く。 */
  const TKIMG_W = 1320, TKIMG_H = 1124;
  /* 本線：段ごと（MAIN index 0-9 / 10-19 / …）の駅中心x・下り線y（上側）・上り線y（下側）（画像px） */
  const TKIMG_BANDS = [
    { xs: [159, 274.5, 343.5, 413, 501.5, 603.5, 673, 742, 830.5, 933], dn: 53, up: 60 },
    { xs: [156, 225, 403, 504.5, 574, 643, 732, 979, 1047.5, 1117], dn: 250, up: 257 },
    { xs: [156, 244.5, 347, 416, 485, 584, 686, 821, 922.5, 1071], dn: 382, up: 389 },
    { xs: [176, 297.5, 399.5, 518, 600, 682.5, 751.5, 834, 932.5, 1127], dn: 524, up: 530 },
    { xs: [176, 346.5, 436, 537.5, 639.5, 761.5, 844, 926.5, 995, 1114], dn: 612, up: 619 },
  ];
  /* 支線：駅ごとの点（画像px）。単線のため方向で線の上下に密着させて置く（下り＝上側／上り＝下側） */
  const TKIMG_BRANCH = {
    dz: [{ x: 250, y: 750 }, { x: 389.5, y: 790 }, { x: 501.5, y: 790 }],
    ag: [{ x: 140, y: 899 }, { x: 235, y: 899 }, { x: 324, y: 899 }, { x: 412.5, y: 899 }, { x: 491.5, y: 899 }, { x: 570.5, y: 899 }, { x: 659.5, y: 899 }, { x: 748, y: 899 }, { x: 837, y: 899 }, { x: 926, y: 899 }, { x: 995, y: 899 }, { x: 1084, y: 899 }],
  };
  /* 車両基地ヤードの位置（原図px）：筑紫＝MAIN 16、西鉄柳川＝MAIN 38 */
  const TKIMG_YARD = { 16: { x: 880, y: 165 }, 38: { x: 1080, y: 490 } };
  /* 画像ボード用ラベル：v33（ユーザー指示 2026-11-19「特急 大牟田とか
     いらない、列番だけでいい」）で列車番号のみに変更した。種別・行先は
     出さない（種別はチップの色、詳細はタイトルとクリック時の詳細パネルで
     確認する）。遅延はラベルに入れず、従来どおりチップ右上の小さな
     バッジ（.dl）と late の枠で示す。推定（ghost）は破線＋赤系の見た目で
     区別する（従来の「?」も付けない） */
  const tkimgLabel = (it) => String(it.no);
  /* 画像ボード用チップ幅（画像px）：高さ13px・文字8.5pxの小さなタグ前提。
     v33 でラベルが列番のみになったため幅は列番の長さで決まる */
  const tkimgChipW = (label) => {
    let w = 10;
    for (const ch of label) w += /[ -~]/.test(ch) ? 5.2 : 8.6;
    return Math.max(30, Math.ceil(w));
  };
  const tkbKeep = (ros, filt) => (no, delay, kind) =>
    filt === 'all' || (filt === 'delay' && delay > 0) || (filt === 'lost' && kind === 'ghost') || (filt === 'roster' && ros.has(no));

  /* 画像上の位置：駅index（小数可）→ 原図px。本線は段の駅配列で補間し、
     段の端では最寄り駅間の傾きで外挿する（接続記号付近まで） */
  function tkimgInterp(xs, v) {
    const n = xs.length;
    if (v <= 0) return xs[0] + v * (xs[1] - xs[0]);
    if (v >= n - 1) return xs[n - 1] + (v - (n - 1)) * (xs[n - 1] - xs[n - 2]);
    const i = Math.floor(v), f = v - i;
    return xs[i] + (xs[i + 1] - xs[i]) * f;
  }
  function tkimgMain(pos, dir) {
    const band = Math.max(0, Math.min(4, Math.floor(pos / 10)));
    const b = TKIMG_BANDS[band];
    return { x: tkimgInterp(b.xs, pos - band * 10), y: dir === 'up' ? b.up : b.dn, zone: 'm' + band + (dir === 'up' ? 'u' : 'd'), side: dir === 'up' ? 'up' : 'dn' };
  }
  function tkimgBranch(id, pos, upSide) {
    const pts = TKIMG_BRANCH[id];
    const n = pts.length;
    let x, y;
    if (pos <= 0) { x = pts[0].x + pos * (pts[1].x - pts[0].x); y = pts[0].y + pos * (pts[1].y - pts[0].y); }
    else if (pos >= n - 1) { x = pts[n - 1].x + (pos - (n - 1)) * (pts[n - 1].x - pts[n - 2].x); y = pts[n - 1].y + (pos - (n - 1)) * (pts[n - 1].y - pts[n - 2].y); }
    else { const i = Math.floor(pos), f = pos - i; x = pts[i].x + (pts[i + 1].x - pts[i].x) * f; y = pts[i].y + (pts[i + 1].y - pts[i].y) * f; }
    return { x, y: y + (upSide ? 8 : -8), zone: 'b' + id + (upSide ? 'u' : 'd'), side: upSide ? 'up' : 'dn' };
  }
  /* 支線で線の上側（下り側）に置いたチップは上へ段ずらしするため、
     隣の段（太宰府線は本線側・甘木線は太宰府線との区切り）へ侵入しないよう段数を絞る */
  const TKIMG_MAXLV = { bagd: 1, bdzd: 2 };
  /* 同じ帯（zone）の中でチップを段ずらしし、画像内にクランプする（画像pxで計算）。
     段ずらしは線から離れる方向だけ：下り（上の線）＝上へ／上り（下の線）＝下へ */
  function tkimgPlace(arr) {
    const sign = arr[0].stack != null ? arr[0].stack : (arr[0].side === 'dn' ? -1 : 1);
    const maxLv = TKIMG_MAXLV[arr[0].zone] != null ? TKIMG_MAXLV[arr[0].zone] : 3;
    arr.forEach((it) => { it.pw = tkimgChipW(tkimgLabel(it)) + 6 + ((it.delay || 0) > 0 ? 8 : 0); });
    const placed = [];
    arr.slice().sort((a, b) => a.px0 - b.px0).forEach((it) => {
      let lv = maxLv;
      for (let L = 0; L <= maxLv; L++) {
        if (!placed.some((p) => p.level === L && Math.abs(p.px0 - it.px0) < (p.pw + it.pw) / 2 + 4)) { lv = L; break; }
      }
      it.level = lv;
      it.px = Math.max(it.pw / 2 + 2, Math.min(TKIMG_W - it.pw / 2 - 2, it.px0));
      it.py = Math.max(9, Math.min(TKIMG_H - 9, it.py0 + sign * lv * 15));
      placed.push(it);
    });
  }
  /* チップHTML：中心 (x, y) を W×H の座標系に対する % で絶対配置する。
     ボード（全体画像）と駅詳細（切り出し画像）で共用する */
  function tkChipHTML(it, x, y, W, H) {
    const label = tkimgLabel(it);
    const cls = ['tkb-chip', 'img-chip', typeClass(it.type), it.kind !== 'live' ? it.kind : '', (it.delay || 0) > 0 ? 'late' : '', it.dim ? 'dim' : '', CMD.sel === it.no ? 'sel' : ''].filter(Boolean).join(' ');
    const carTxt = it.cars ? ` ・ 車 ${it.cars}` : '';
    const title = `${it.no} ${it.type || ''}${it.dest ? ' ' + it.dest + '行' : ''}　${it.where || ''}${it.kind === 'dead' ? '' : (it.delay || 0) ? '・' + it.delay + '分遅れ' : '・定時'}${carTxt}${it.kind === 'ghost' ? '（在線情報になし・推定）' : it.kind === 'branch' ? '（支線内・推定）' : it.kind === 'dead' ? '（回送・乗務データからの推定）' : ''}`;
    return `<button class="${cls}" data-cmd-train="${esc(it.no)}" data-x="${x.toFixed(0)}" data-y="${y.toFixed(0)}" data-w="${it.pw}" style="left:${(x / W * 100).toFixed(2)}%;top:${(y / H * 100).toFixed(2)}%" title="${esc(title)}">${esc(label)}${(it.delay || 0) > 0 ? `<i class="dl">+${it.delay}</i>` : ''}</button>`;
  }
  function tkimgChipHTML(it) {
    return tkChipHTML(it, it.px, it.py, TKIMG_W, TKIMG_H);
  }
  /* 駅詳細用：配線略図から crop（{x0,y0,w,h} 画像px）を切り出した拡大図を
     土台にし、markers（{it, x, y} 画像px座標）を小さなマーカーで重ねる。
     同じ線（y）に複数ある場合はアンカー x を中心に横にずらす */
  function tkdetHTML(crop, markers, alt) {
    const groups = {};
    markers.forEach((m) => {
      m.it.pw = tkimgChipW(tkimgLabel(m.it)) + 6 + ((m.it.delay || 0) > 0 ? 8 : 0);
      m.lx = m.x - crop.x0;
      m.ly = m.y - crop.y0;
      (groups[m.ly] = groups[m.ly] || []).push(m);
    });
    const chips = [];
    Object.keys(groups).forEach((gy) => {
      const arr = groups[gy].slice().sort((a, b) => a.it.no.localeCompare(b.it.no));
      const total = arr.reduce((s, m) => s + m.it.pw, 0) + 8 * (arr.length - 1);
      let cur = arr[0].lx - total / 2;
      arr.forEach((m) => {
        const cx = Math.max(m.it.pw / 2 + 2, Math.min(crop.w - m.it.pw / 2 - 2, cur + m.it.pw / 2));
        chips.push(tkChipHTML(m.it, cx, m.ly, crop.w, crop.h));
        cur += m.it.pw + 8;
      });
    });
    return `<div class="cmdb tkb-img tkb-det">
        <div class="tkb-det-wrap" style="aspect-ratio:${crop.w}/${crop.h}" data-det-x0="${crop.x0}" data-det-y0="${crop.y0}" data-det-w="${crop.w}" data-det-h="${crop.h}">
          <img class="tkb-det-map" src="assets/track-map.jpg" alt="${esc(alt)}" draggable="false" style="width:${(TKIMG_W / crop.w * 100).toFixed(2)}%;left:${(-crop.x0 / crop.w * 100).toFixed(2)}%;top:${(-crop.y0 / crop.h * 100).toFixed(2)}%">
          ${chips.join('')}
        </div>
      </div>`;
  }

  function cmdBoardHTML(dg) {
    const ros = rosterNos().set;
    const keep = tkbKeep(ros, CMD.filter);
    const items = [];
    dg.live.forEach((t) => {
      if (t.branch) {
        /* 支線内（6＝太宰府線・7＝甘木線）：チップは支線の線に置く。位置は時刻表から推定 */
        const p = tkimgBranch(t.branch, t.bpos, t.dir === 'up');
        items.push({ no: t.no, delay: t.delay, type: t.type, dest: t.dest, where: t.where, cars: t.cars, kind: 'live', px0: p.x, py0: p.y, zone: p.zone, side: p.side, dim: !keep(t.no, t.delay, 'live') });
        return;
      }
      const pos = t.idx + ((t.frac == null ? 0.4 : t.frac) - 0.5) * 0.8;
      const p = tkimgMain(pos, t.dir);
      items.push({ no: t.no, delay: t.delay, type: t.type, dest: t.dest, where: t.where, cars: t.cars, kind: 'live', dim: !keep(t.no, t.delay, 'live'), px0: p.x, py0: p.y, zone: p.zone, side: p.side });
    });
    dg.ghosts.forEach((g) => {
      if (g.branch) return;                    // 支線内の推定は下の onBranch で置く
      const idx = MAIN.indexOf(g.at);
      if (idx < 0) return;
      const p = tkimgMain(idx, g.dir);
      items.push({ no: g.no, delay: 0, type: g.type, dest: g.dest, kind: 'ghost', where: `${g.at} 付近（在線情報になし・推定）`, px0: p.x, py0: p.y, zone: p.zone, side: p.side, dim: !keep(g.no, 0, 'ghost') });
    });
    (dg.deads || []).forEach((t) => {
      const yIdx = (t.fromDepot && t.frac <= 0.15) ? MAIN.indexOf(t.from) : (t.toDepot && t.frac >= 0.85) ? MAIN.indexOf(t.to) : -1;
      if (TKIMG_YARD[yIdx]) {
        const yd = TKIMG_YARD[yIdx];
        items.push({ no: t.no, delay: 0, type: t.type, dest: t.dest, kind: 'dead', where: t.where, px0: yd.x, py0: yd.y, zone: 'yard' + yIdx, side: 'dn', stack: 1, dim: !keep(t.no, 0, 'dead') });
        return;
      }
      const p = tkimgMain(t.pos, t.dir);
      items.push({ no: t.no, delay: 0, type: t.type, dest: t.dest, kind: 'dead', where: t.where, px0: p.x, py0: p.y, zone: p.zone, side: p.side, dim: !keep(t.no, 0, 'dead') });
    });
    const brt = cmdBranchTrains(dg.dt);
    const placed = {};
    items.forEach((it) => { placed[it.no] = 1; });
    CMD_BRANCH.forEach((b) => {
      (brt[b.id] || []).forEach((t) => {
        if (placed[t.no]) return;              // 公式在線にある列車は上で置いている
        placed[t.no] = 1;
        const upSide = b.order.indexOf(t.dest) === 0;
        const p = tkimgBranch(b.id, t.pos, upSide);
        items.push({ no: t.no, delay: t.delay, type: t.type, dest: t.dest, kind: 'branch', where: `${b.name}内（推定）`, px0: p.x, py0: p.y, zone: p.zone, side: p.side, dim: CMD.filter === 'all' ? false : CMD.filter === 'roster' ? !ros.has(t.no) : true });
      });
    });
    (dg.onBranch || []).forEach((g) => {
      if (placed[g.no]) return;
      placed[g.no] = 1;
      const b = (g.bid && CMD_BRANCH.find((x) => x.id === g.bid)) || CMD_BRANCH.find((x) => x.order.indexOf(g.at) >= 0);
      if (!b) return;
      const bpos = g.bpos != null ? g.bpos : b.order.indexOf(g.at);
      const p = tkimgBranch(b.id, bpos, g.dir === 'up');
      items.push({ no: g.no, delay: 0, type: g.type, dest: g.dest, kind: 'ghost', where: `${g.at} 付近（支線内・推定）`, px0: p.x, py0: p.y, zone: p.zone, side: p.side, dim: !keep(g.no, 0, 'ghost') });
    });
    const zones = {};
    items.forEach((it) => { (zones[it.zone] = zones[it.zone] || []).push(it); });
    Object.keys(zones).forEach((k) => tkimgPlace(zones[k]));
    const chips = items.map(tkimgChipHTML).join('');
    const jumps = CMD_MAJOR.map((n) => `<button class="cjb" data-cmd-jump="${MAIN.indexOf(n)}">${esc(cmdName(n))}</button>`).join('');
    return `<div class="cmd-bhead">
        <b>配線図ボード（天神大牟田線＋太宰府線・甘木線）</b><span class="cmd-note">列番6＝太宰府線・7＝甘木線（支線は時刻表から位置を推定）／上の線＝下り・下の線＝上り</span>
        <span class="cmd-zoom"><button data-cmd-zoom="-"${CMD.zoom <= CMD_ZOOM_STEPS[0] ? ' disabled' : ''}>−</button><button data-cmd-zoom="+"${CMD.zoom >= CMD_ZOOM_STEPS[CMD_ZOOM_STEPS.length - 1] ? ' disabled' : ''}>＋</button></span>
      </div>
      <div class="cmd-jump">${jumps}</div>
      <div class="cmdb tkb-img" id="cmdImgBox">
        <div class="tkb-img-inner" style="width:${CMD.zoom}%">
          <div class="tkb-img-wrap">
            <img class="tkb-img-map" src="assets/track-map.jpg" alt="西鉄 配線略図（raildiag 図番号1285・紺狐、貝塚線の段を除く）" draggable="false">
            ${chips}
          </div>
        </div>
      </div>`;
  }


  /* 駅詳細の切り出し範囲（画像px）。線の位置は配線略図から実測した */
  const TKDET_FUT = { x0: 250, y0: 195, w: 410, h: 100 };
  const TKDET_TEN = { x0: 90, y0: 35, w: 340, h: 80 };

  /* 駅詳細：西鉄二日市（4面5線・のりば1〜7）
     v32：手描きSVGをやめ、実物の配線略図（二日市付近の拡大）を土台にする。
     番線割当（推定）：太宰府直通の下り＝2番線（4番のりば・下り副本線）／太宰府からの上り直通＝1番線
     太宰府線シャトル（二日市発着）は1番線（1番のりば）【2026-11-18 本人確認】
     下り 特急・急行＝3番線（主本線）・普通＝2番線（副本線）／上り 特急・急行＝4番線（主本線）・普通＝5番線（副本線）
     v34：マーカー位置を配線略図の実測で作り直し。全マーカーを駅プレート中心
     （x=403）の真上に置く。図の線（実測・画像px）：北側の線 y=237（駅上空を
     x357〜429で通過し、西は太宰府線分岐・東は下り線へ接続）／下り線 y=250／
     上り線 y=257／南側の線 y=270（駅下を x376〜429で通過する副本線ループ）。
     対応：1番線・2番線＝北側の線（図では同じ線に重なる）／3番線＝下り線／
     4番線＝上り線／5番線＝南側の線。
     ※v33までは2番線を駅西側の分岐リード（x=312,y=244）に置いており、駅の上に
     マーカーが来ない不具合があった。5番線も南側の線ではなく上り線に置いていた */
  function cmdFutsukaichiHTML(dg) {
    const stn = '西鉄二日市';
    const ros = rosterNos().set;
    const keep = tkbKeep(ros, CMD.filter);
    const list = [];
    dg.live.forEach((t) => {
      /* 西鉄二日市にいる列車：本線の列車と、太宰府線（列番6）で分岐駅にいる列車 */
      if (t.branch === 'dz' ? !(t.bpos != null && t.bpos <= 0.4) : t.idx !== MAIN.indexOf(stn)) return;
      list.push({ no: t.no, delay: t.delay, type: t.type, dest: t.dest, where: t.where, cars: t.cars, dir: t.dir, kind: 'live', dim: !keep(t.no, t.delay, 'live') });
    });
    dg.ghosts.forEach((g) => {
      if (g.branch === 'dz') { if (!(g.bpos != null && g.bpos <= 0.4)) return; }
      else if (g.at !== stn) return;
      list.push({ no: g.no, delay: 0, type: g.type, dest: g.dest, where: `${g.at} 付近（${g.branch ? '支線内' : '在線情報になし'}・推定）`, dir: g.dir, kind: 'ghost', dim: !keep(g.no, 0, 'ghost') });
    });
    (dg.deads || []).forEach((t) => { if (t.at === stn) list.push({ no: t.no, delay: 0, type: t.type, dest: t.dest, where: t.where, dir: t.dir, kind: 'dead', dim: !keep(t.no, 0, 'dead') }); });
    const trackOf = (it) => {
      const rec = trainRec(dg.dt, it.no);
      const from = rec ? canon(rec.from) : '';
      const tc = typeClass(it.type);
      const dzStn = (n) => n === '太宰府' || n === '西鉄五条';
      if (dzStn(it.dest) || dzStn(from)) {
        /* 太宰府線：二日市発着のシャトルは1番線（1番のりば）／直通は下り2番線・上り1番線 */
        if (it.dir === 'up') return 1;
        return from === '西鉄二日市' ? 1 : 2;
      }
      if (it.dir === 'down') return (tc === 'ltd' || tc === 'exp') ? 3 : 2;
      return (tc === 'ltd' || tc === 'exp') ? 4 : 5;
    };
    const lineOf = {
      1: { x: 403, y: 237 },
      2: { x: 403, y: 237 },
      3: { x: 403, y: 250 },
      4: { x: 403, y: 257 },
      5: { x: 403, y: 270 },
    };
    const markers = list.map((it) => { const L = lineOf[trackOf(it)]; return { it, x: L.x, y: L.y }; });
    return `<details class="cmd-track" open>
      <summary>駅詳細：西鉄二日市<span>4面5線・のりば1〜7／番線は推定</span></summary>
      ${tkdetHTML(TKDET_FUT, markers, '西鉄二日市駅 配線略図（二日市付近の拡大）')}
      <p class="cmd-note det-note">配線略図（二日市付近の拡大）に表示しています。マーカーは駅の真上に置いています。番線の割当（推定）：1番線＝太宰府線シャトル・太宰府からの上り直通／2番線＝下り副本線（太宰府直通の下り・普通）／3番線＝下り本線／4番線＝上り本線／5番線＝上り副本線。図では1・2番線は駅北側の同じ線、5番線は駅南側の線に表示します。</p>
    </details>`;
  }

  /* 駅詳細：西鉄福岡(天神)（頭端式3線）
     v32：手描きSVGをやめ、実物の配線略図（天神付近の拡大）を土台にする。
     行き先・種別ごとの専用ホームはないため番線は特定せず、発車（下り）は
     ターミナル部の上側の線、到着（上り）は下側の線に置く。
     v34：位置を実測で作り直し。ターミナルの3線は y=53／66／79（x≈137の
     車止めから x≈193まで）、駅プレート中心は x=159.5。マーカーはプレート
     中心 x=160 の真上に、発車（下り）＝一番上の線 y=53、到着（上り）＝
     一番下の線 y=79 に置く（v33までは x=170 で駅中心からずれていた） */
  function cmdTenjinHTML(dg) {
    const stn = '福岡(天神)';
    const ros = rosterNos().set;
    const keep = tkbKeep(ros, CMD.filter);
    const list = [];
    dg.live.forEach((t) => { if (t.idx === 0) list.push({ no: t.no, delay: t.delay, type: t.type, dest: t.dest, where: t.where, cars: t.cars, dir: t.dir, kind: 'live', dim: !keep(t.no, t.delay, 'live') }); });
    dg.ghosts.forEach((g) => { if (g.at === stn) list.push({ no: g.no, delay: 0, type: g.type, dest: g.dest, where: `${g.at} 付近（在線情報になし・推定）`, dir: g.dir, kind: 'ghost', dim: !keep(g.no, 0, 'ghost') }); });
    (dg.deads || []).forEach((t) => { if (t.at === stn) list.push({ no: t.no, delay: 0, type: t.type, dest: t.dest, where: t.where, dir: t.dir, kind: 'dead', dim: !keep(t.no, 0, 'dead') }); });
    const markers = list.map((it) => it.dir === 'down' ? { it, x: 160, y: 53 } : { it, x: 160, y: 79 });
    return `<details class="cmd-track" open>
      <summary>駅詳細：西鉄福岡(天神)<span>頭端式 3線／専用ホームなし・番線は特定しない</span></summary>
      ${tkdetHTML(TKDET_TEN, markers, '西鉄福岡(天神)駅 配線略図（天神付近の拡大）')}
      <p class="cmd-note det-note">配線略図（天神付近の拡大）に表示しています。発車（下り）はターミナル部の上側の線、到着（上り）は下側の線に置いています。西鉄福岡（天神）に行き先・種別ごとの専用ホームはなく、番線はその都度変わるため特定しません。</p>
    </details>`;
  }

  function cmdTrackDetailsHTML(dg) {
    return `${cmdFutsukaichiHTML(dg)}
      ${cmdTenjinHTML(dg)}
      <p class="cmd-foot">番線レベルの配置は推定です：在線データは駅ブロック単位のため、西鉄二日市の番線は種別・行先と番線ルール（太宰府直通は4番線＝下り副本線／太宰府線シャトルは1番のりば／追い越し時は追い越される列車が副本線・追い越す列車が主本線）にもとづいて置いています。西鉄福岡（天神）には行き先・種別ごとの専用ホームがないため、番線を特定せず発着レベルで表示しています。実際の番線は駅の案内・指令の指示でご確認ください。</p>
      <p class="cmd-foot">配線図は raildiag 図番号1285「西日本鉄道(西鉄) 配線略図」（紺狐）を使用しています（貝塚線の段は切り取って除いています）。列車の位置は駅ブロック単位で図の線路上に重ねて表示しており、番線レベルの特定はしません。チップは線路の真上に小さく表示し、上の線が下り線・下の線が上り線です。遅延はチップ右上の小さな数字で示します。</p>`;
  }

  /* 支線（太宰府線・甘木線）のセクション：列番の頭数字 6＝太宰府線、7＝甘木線。
     公式在線にある列車（6xxx・支線区間の7xxx・太宰府直通の急行）と、
     時刻表から推定した列車を合わせて出す */
  function cmdBranchHTML(dg) {
    const dt = dg ? dg.dt : todayType();
    const ros = rosterNos().set;
    const keepB = (no, delay, kind) => (CMD.filter === 'all' ? true : CMD.filter === 'delay' ? delay > 0 : CMD.filter === 'lost' ? kind === 'ghost' : ros.has(no));
    const step = 54, pad = 34;
    const byB = {};
    CMD_BRANCH.forEach((b) => { byB[b.id] = []; });
    const push = (bid, x) => {
      if (!byB[bid] || byB[bid].some((y) => y.no === x.no)) return;
      byB[bid].push(x);
    };
    (dg ? dg.live : []).forEach((t) => {
      if (!t.branch) return;
      push(t.branch, { no: t.no, pos: t.bpos == null ? 0 : t.bpos, delay: t.delay, type: t.type, dest: t.dest, kind: 'live',
        where: t.where, dim: !keepB(t.no, t.delay, 'live') });
    });
    (dg ? dg.onBranch : []).forEach((g) => {
      const bid = g.bid || CMD_BRANCH_OF[g.at];
      const b = CMD_BRANCH.find((x) => x.id === bid);
      if (!b) return;
      push(b.id, { no: g.no, pos: g.bpos == null ? b.order.indexOf(g.at) : g.bpos, delay: 0, type: g.type, dest: g.dest, kind: 'ghost',
        where: `${g.at} 付近（在線情報になし・推定）`, dim: !keepB(g.no, 0, 'ghost') });
    });
    const brt = cmdBranchTrains(dt);
    CMD_BRANCH.forEach((b) => {
      (brt[b.id] || []).forEach((t) => push(b.id, { no: t.no, pos: t.pos, delay: t.delay, type: t.type, dest: t.dest, kind: 'branch',
        where: `${b.name}内（推定）`, dim: !keepB(t.no, t.delay, 'branch') }));
    });
    const n = CMD_BRANCH.reduce((a, b) => a + byB[b.id].length, 0);
    const body = CMD_BRANCH.map((b) => {
      const W = Math.round(pad * 2 + (b.order.length - 1) * step);
      const codes = b.order.map((n) => b.code[n] || '');
      const items = byB[b.id].map((t) => ({
        no: t.no, idx: Math.floor(t.pos), frac: t.pos - Math.floor(t.pos), col: 1,
        delay: t.delay, type: t.type, kind: t.kind, dest: t.dest,
        where: t.where, dim: t.dim,
      }));
      const live = byB[b.id].filter((x) => x.kind === 'live').length;
      return `<div class="cmd-bhead sub sub2">
          <b>${esc(b.name)}</b><span class="cmd-note">列番${CMD_LINE_HEAD[b.id]}／${esc(b.join)} 分岐・いま${byB[b.id].length}本（うち公式在線 ${live}本・位置は時刻表から推定）</span>
        </div>
        <div class="cmdb branch">
          <div class="cmdb-lanes lane-up br">${cmdLanesHTML(items, step, pad)}</div>
          <div class="cmdb-rail" style="width:${W}px"><i class="rail-line single"></i>${cmdStationsHTML(b.order, codes, step, pad)}</div>
        </div>`;
    }).join('');
    return `<details class="cmd-branch">
      <summary>支線（太宰府線・甘木線）<span>${n ? `${n}本 走行中` : 'いま走行中の列車なし'}</span></summary>
      ${body}
    </details>`;
  }
  function cmdListHTML(dg) {
    const ros = rosterNos();
    const filt = CMD.filter;
    const rows = [];
    dg.live.forEach((t) => rows.push({
      no: t.no, type: t.type, dest: t.dest, where: t.where, delay: t.delay, kind: 'live',
      line: t.line || '',
      cars: esApplies(dg.dt) ? (esCarsOf(t.no) || {}) : null, roster: ros.set.has(t.no),
    }));
    dg.ghosts.forEach((g) => rows.push({
      no: g.no, type: g.type, dest: g.dest,
      where: g.branch ? `${g.at} 付近（支線内・推定）` : `${g.at} 付近（在線情報になし・推定）`,
      delay: 0, kind: 'ghost', branch: g.branch, cars: null, roster: ros.set.has(g.no),
      line: g.line || '',
    }));
    (dg.deads || []).forEach((t) => rows.push({
      no: t.no, type: t.type, dest: t.dest, where: t.where,
      delay: 0, kind: 'dead', cars: null, roster: ros.set.has(t.no),
    }));
    rows.sort((a, b) => {
      const rank = (r) => (r.kind === 'ghost' && !r.branch ? 0 : r.delay > 0 ? 1 : r.kind === 'dead' ? 3 : 2);
      return rank(a) - rank(b) || b.delay - a.delay || a.no.localeCompare(b.no);
    });
    const shown = rows.filter((r) => filt === 'all' || (filt === 'delay' && r.delay > 0) || (filt === 'lost' && r.kind === 'ghost' && !r.branch) || (filt === 'roster' && r.roster));
    if (!shown.length) return '<p class="cmd-empty">該当する列車はありません。</p>';
    const LIMIT = 10;
    const cut = CMD.more ? shown : shown.slice(0, LIMIT);
    const moreBtn = shown.length > LIMIT
      ? `<button class="cmd-more" data-cmd-more="1">${CMD.more ? 'たたむ' : `残り ${shown.length - LIMIT}本を表示`}</button>` : '';
    return `<div class="cmd-list">${cut.map((r) => {
      const car = r.cars && !r.cars.none && r.cars.cars ? r.cars.cars : '';
      const cls = [typeClass(r.type), r.delay > 0 ? 'late' : '', r.kind === 'ghost' ? 'ghost' : '', CMD.sel === r.no ? 'sel' : ''].filter(Boolean).join(' ');
      return `<button class="cmd-row ${cls}" data-cmd-train="${esc(r.no)}">
        <span class="no">${esc(r.no)}</span>
        <span class="ty">${esc(typeShort(r.type))}</span>
        <span class="dest">${esc(SHORT[r.dest] || r.dest || '—')} 行</span>
        <span class="dl">${r.delay > 0 ? `+${r.delay}分` : r.kind === 'ghost' ? (r.branch ? '支線内?' : '未在線?') : r.kind === 'dead' ? '回送' : '定時'}</span>
        <span class="sub"><span class="ps">${esc(r.where)}</span>${r.line && !String(r.where || '').startsWith(r.line) ? `<span class="ln">${esc(r.line)}</span>` : ''}${car ? `<span class="car">車 ${esc(car)}</span>` : ''}${r.roster ? '<span class="ros">輪番</span>' : ''}</span>
      </button>`;
    }).join('')}</div>${moreBtn}`;
  }
  function cmdLiveHTML() {
    const dg = cmdDigest();
    const ros = rosterNos();
    const ok = POS.status === 'ready';
    const time = ok ? posClock() : '—';
    const src = POS.source === 'direct' ? '公式から直接' : POS.source === 'relay' ? '中継経由' : '—';
    const ft = String(POS.fileTime || '');
    const gen = ft.length >= 12 ? `${ft.slice(8, 10)}:${ft.slice(10, 12)}:${ft.slice(12, 14)}` : '—';
    const stale = dg.stale ? `<span class="cmd-stale">情報が更新されていません</span>` : '';
    const alert = ok && (dg.maxDelay >= 5 || dg.lost.length >= 3)
      ? `<div class="cmd-alert"><b>⚠ 在線データからの推定（公式発表ではありません）</b><span>${dg.maxDelay >= 5 ? `遅延 ${dg.delayed}本（最大 ${dg.maxDelay}分）` : ''}${dg.maxDelay >= 5 && dg.lost.length >= 3 ? ' ／ ' : ''}${dg.lost.length >= 3 ? `在線情報にない列車 ${dg.lost.length}本` : ''}</span>
          <a href="${POS.SITE}" target="_blank" rel="noopener noreferrer">公式の在線位置</a><a href="${POS.X}" target="_blank" rel="noopener noreferrer">西鉄公式X</a></div>`
      : '';
    const errBox = POS.status === 'error'
      ? `<div class="cmd-alert err"><b>⚠ 在線情報を取得できません</b><span>${esc(POS.error || '')}</span>
          <a href="${POS.SITE}" target="_blank" rel="noopener noreferrer">公式の在線位置</a></div>` : '';
    const loadBox = (POS.status === 'loading' || POS.status === 'idle')
      ? `<div class="cmd-alert load"><b>在線情報を取得しています…</b><span>西鉄「列車走行位置」</span></div>` : '';
    return `<div class="cmd-meta">
        <span class="cmd-live"><i></i>${ok ? 'LIVE' : POS.status === 'error' ? 'OFF' : '…'}</span>
        <span>${esc(dg.dt === 'holiday' ? '土日祝ダイヤ' : '平日ダイヤ')} ・ ${time} 現在</span>
        <span>公式生成 ${esc(gen)}</span>
        <span>${esc(src)}</span>
        <span class="cmd-count">次回 <b id="cmdCount">--</b></span>
        ${stale}
      </div>
      <div class="cmd-sum">
        <div class="tile"><span>在線</span><b>${dg.running}</b><i>本</i></div>
        <div class="tile ${dg.delayed ? 'warn' : ''}"><span>遅延</span><b>${dg.delayed}</b><i>本</i></div>
        <div class="tile ${dg.maxDelay >= 5 ? 'warn' : ''}"><span>最大</span><b>${dg.maxDelay ? '+' + dg.maxDelay : '±0'}</b><i>分</i></div>
        <div class="tile ${dg.lost.length ? 'alert' : ''}"><span>未在線<em>推定</em></span><b>${dg.lost.length}</b><i>本</i></div>
      </div>
      <div class="cmd-sum two">
        <div class="tile ${dg.lineCount.dz ? 'on' : ''}"><span>太宰府線<em>列番6</em></span><b>${dg.lineCount.dz || 0}</b><i>本</i></div>
        <div class="tile ${dg.lineCount.ag ? 'on' : ''}"><span>甘木線<em>列番7</em></span><b>${dg.lineCount.ag || 0}</b><i>本</i></div>
      </div>
      <p class="cmd-line-note">太宰府線・甘木線の本数は、いま支線内にいる列車（公式在線＋時刻表からの推定）。</p>
      ${loadBox}${errBox}${alert}
      <div class="cmd-filters">
        <button data-cmd-filter="all" class="${CMD.filter === 'all' ? 'on' : ''}">全列車 <b>${dg.running + dg.ghosts.length + (dg.deads || []).length}</b></button>
        <button data-cmd-filter="delay" class="${CMD.filter === 'delay' ? 'on' : ''}">遅延 <b>${dg.delayed}</b></button>
        <button data-cmd-filter="lost" class="${CMD.filter === 'lost' ? 'on' : ''}">未在線 <b>${dg.lost.length}</b></button>
        <button data-cmd-filter="roster" class="${CMD.filter === 'roster' ? 'on' : ''}">輪番 <b>No.${esc(String((getPattern(state.pattern) || {}).no || ''))}</b></button>
      </div>
      ${cmdBoardHTML(dg)}
      ${cmdBranchHTML(dg)}
      ${cmdTrackDetailsHTML(dg)}
      <div class="cmd-lhead"><b>在線・運転状況</b><span>${CMD.filter === 'roster' ? esc(ros.label) : CMD.filter === 'delay' ? '遅延のみ' : CMD.filter === 'lost' ? '未在線の推定のみ' : '全列車'}</span></div>
      ${cmdListHTML(dg)}
      <details class="cmd-help">
        <summary>位置・推定の見方</summary>
        <p>位置＝西鉄「列車走行位置」の在線情報（駅ブロック単位・数十秒〜数分前）。「停車中／走行中」は公式の位置と定刻（＋遅延）を突き合わせた<b>推定</b>です。</p>
        <p>破線＝在線情報に該当が無い列車（定刻上は運転中＝運休・運転見合わせ等の可能性、<b>推定</b>）。回送・基地内・運休のいずれかで、運休と断定はできません。</p>
        <p>太宰府線・甘木線は公式の在線情報でも支線の線（別の列）にあり、位置の行（row）は本線の駅に読み替えられません。そのため列番の頭数字で系統を決め（<b>6＝太宰府線、7＝甘木線</b>）、時刻表の各駅時刻から位置を<b>推定</b>して表示しています。公式の発表・駅の案内とあわせてご確認ください。</p>
        <p>灰色＝回送列車。在線情報に載らないため、乗務データ（行路）の時刻から発駅→着駅を補間して位置を<b>推定</b>表示しています。勤務基準の時刻で、実際の運行とはずれることがあります。</p>
      </details>`;
  }
  function renderCmd(main) {
    main.innerHTML = `<section class="cmd">
      <div class="cmd-top">
        <div class="cmd-title"><span class="cmd-badge">指令</span><h2>運行管理卓</h2></div>
        <div class="cmd-tools">
          <button class="cmd-btn" data-cmd-refresh aria-label="再取得"${POS.status === 'loading' ? ' disabled' : ''}>↻</button>
          <button class="cmd-btn ${CMD.auto ? 'on' : ''}" data-cmd-auto aria-label="自動更新">自動</button>
        </div>
      </div>
      <div id="offBanner">${offBannerHTML()}</div>
      <div id="cmdLive">${cmdLiveHTML()}</div>
    </section>`;
    bindCmdScroll(CMD.scroll);
    updateCmdClock();
  }
  function paintCmd() {
    const live = $('#cmdLive');
    if (!live) return;
    const saved = $$('#cmdLive .cmdb').map((b) => b.scrollLeft);
    live.innerHTML = cmdLiveHTML();
    const ob = $('#offBanner');
    if (ob) ob.innerHTML = offBannerHTML();
    bindCmdScroll(saved);
    updateCmdClock();
  }
  function bindCmdScroll(saved) {
    $$('#cmdLive .cmdb').forEach((box, i) => {
      box.scrollLeft = Array.isArray(saved) ? (saved[i] || 0) : (i === 0 ? (saved || 0) : 0);
      box.addEventListener('scroll', () => { CMD.scroll = box.scrollLeft; }, { passive: true });
    });
  }
  function updateCmdClock() {
    const el = $('#cmdCount');
    if (!el) return;
    if (!CMD.auto) { el.textContent = '停止'; return; }
    if (POS.status !== 'ready') { el.textContent = '--'; return; }
    const left = Math.max(0, Math.round(60 - (Date.now() - POS.fetchedAt) / 1000));
    el.textContent = left + '秒';
  }
  function cmdScrollToIdx(idx) {
    const box = document.querySelector('#cmdImgBox');
    if (!box) return;
    const band = Math.max(0, Math.min(4, Math.floor(idx / 10)));
    const b = TKIMG_BANDS[band];
    const fx = tkimgInterp(b.xs, idx - band * 10) / TKIMG_W;
    const fy = ((b.up + b.dn) / 2) / TKIMG_H;
    const inner = box.querySelector('.tkb-img-inner');
    const iw = inner ? inner.offsetWidth : 0;
    if (iw > 0) {
      box.scrollLeft = Math.max(0, fx * iw - box.clientWidth / 2);
      CMD.scroll = box.scrollLeft;
    }
    const wrap = box.querySelector('.tkb-img-wrap');
    if (wrap && wrap.getBoundingClientRect) {
      const r = wrap.getBoundingClientRect();
      const y = r.top + (window.scrollY || 0) + fy * r.height - (window.innerHeight || 0) / 2;
      if (isFinite(y)) window.scrollTo(0, Math.max(0, y));
    }
  }
  /* 列車の詳細（指令室から開く） */
  function openCmdTrain(no) {
    const dt = todayType();
    const info = cmdInfo(no);
    const ghost = cmdGhosts(dt).find((g) => g.no === no) || null;
    const rec = trainRec(dt, no);
    const sch = trainSched(dt, no) || [];
    const live = !!info;
    const dl = live ? info.delay : 0;
    const type = (live ? info.type : ghost ? ghost.type : rec ? rec.type : '') || '';
    const dest = (live ? info.dest : ghost ? ghost.dest : rec && canon(rec.to)) || '';
    const rows = [];
    /* 線区（列番の頭数字 6＝太宰府線、7＝甘木線） */
    const lineId = (live && info.branch) || (ghost && ghost.bid) || cmdLineOfNo(no);
    if (lineId) {
      const b = CMD_BRANCH.find((x) => x.id === lineId);
      const ends = rec ? [canon(rec.from), canon(rec.to)].filter((n) => MAIN.indexOf(n) >= 0 && n !== b.join) : [];
      rows.push(['線区', `${CMD_LINE_NAME[lineId]}（列番${CMD_LINE_HEAD[lineId]}・${esc(b.join)}分岐）${ends.length ? `・本線直通（${esc(ends[0])}）` : ''}`]);
    }
    if (live) {
      if (info.branch) {
        const b = CMD_BRANCH.find((x) => x.id === info.branch);
        const seg = info.at ? info.st : `${info.prev}〜${info.next}`;
        rows.push(['現在位置', `${seg}${info.at ? ' 停車中' : ' 走行中'}（${esc(b.name)}内・位置は時刻表から推定）`]);
        rows.push(['方向', info.dir === 'up' ? `上り ・ ${esc(b.join)}（天神）方面` : `下り ・ ${esc(CMD_LINE_TERM[b.id])}方面`]);
        if (info.cars) rows.push(['両数', `${info.cars}両${info.doors ? ` ・ ${info.doors}ドア` : ''}`]);
      } else {
        const seg = info.prev && info.next ? `${info.prev}〜${info.next}` : info.st;
        rows.push(['現在位置', `${info.st} 付近（${seg} 間）・${info.at ? '停車中' : '走行中（推定）'}`]);
        rows.push(['方向', info.dir === 'up' ? '上り ・ 天神方面' : '下り ・ 大牟田方面']);
        if (info.cars) rows.push(['両数', `${info.cars}両${info.doors ? ` ・ ${info.doors}ドア` : ''}`]);
      }
    } else if (ghost) {
      const gl = ghost.bid ? CMD_LINE_NAME[ghost.bid] : '';
      rows.push(['状態', ghost.branch ? `${gl ? gl + '内' : '支線内'}（${ghost.at} 付近・推定）` : '在線情報に該当なし（運休・見合わせ等の可能性／推定）']);
      rows.push(['定刻', `${fmtMin(ghost.start)} ${ghost.from} → ${fmtMin(ghost.end)} ${ghost.to}`]);
      rows.push(['運転開始から', `${ghost.minLate}分経過`]);
    } else {
      rows.push(['状態', '在線情報にも時刻表にも見つかりません']);
    }
    if (rec && (rec.from || rec.to)) rows.push(['全区間', `${esc(rec.dep)} ${esc(canon(rec.from))} → ${esc(rec.arr)} ${esc(canon(rec.to))}${rec.carType ? ` ・ ${esc(rec.carType)}形${esc(rec.cars)}両` : ''}`]);
    const uses = [];
    for (const pp of D.patterns) for (const dd of pp.days)
      if (dd.system && tokenize(dd.system).some((t) => t.kind === 'train' && t.v === no)) {
        const lg = (dd.legs || []).find((x) => x.t.includes(no));
        uses.push({ pp, dd, lg });
      }
    const stops = sch.length ? `<h4 class="tl-title" style="margin-top:14px">${sch.full ? '各駅の着発' : '始発・終着（各駅の時刻は未収録）'}</h4>
      <div class="stop-list cmd-stops">${sch.map((s) => {
        const here = live && s.name === info.st;
        return `<div class="${here ? 'here' : ''}"><span>${esc(s.name)}${here ? ' ◀ いま' : ''}</span><b>${s.arr != null ? fmtMin(s.arr) : '〃'}</b><i>${s.dep != null ? fmtMin(s.dep) : '〃'}</i></div>`;
      }).join('')}</div>` : '';
    showSheet(`<div class="sheet-head"><h2>列車 ${esc(no)}</h2><button class="sheet-close" data-close>✕</button></div>
      <div class="cmd-sheet">
        <div class="cs-hero ${typeClass(type)}">
          <span class="no">${esc(no)}</span>
          <span class="ty">${esc(typeShort(type))}</span>
          <span class="dest">${esc(dest || '—')} 行</span>
          <span class="st ${live ? (dl > 0 ? 'late' : 'on') : 'lost'}">${live ? (dl > 0 ? `+${dl}分` : '定時') : '未在線?'}</span>
        </div>
        <dl class="es-dl">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>
        ${esCarLine(no, dt)}
        ${stops}
        ${uses.length ? `<h4 class="tl-title" style="margin-top:14px">この列車を担当する行路（${uses.length}件）</h4>` +
          uses.map((u) => `<div class="res-card" data-goto="${u.pp.id}:${u.dd.row}">
            <div class="t"><span class="badge work">${u.pp.label}</span><span class="badge off">${CIRC[u.dd.dutyNo - 1]}</span>
            <span class="run">${u.dd.row}日目 ${esc(firstDep(u.dd))}→${esc(lastRet(u.dd))}</span></div></div>`).join('') : ''}
        <div class="btn-row">
          <a class="btn" href="${POS.SITE}" target="_blank" rel="noopener noreferrer">公式の在線位置</a>
          <a class="btn" href="${POS.X}" target="_blank" rel="noopener noreferrer">西鉄公式X</a>
        </div>
        <p class="es-caution">位置は西鉄「列車走行位置」の在線情報（駅ブロック単位）です。停車中／走行中は公式の位置行と定刻（＋遅延）から推定したもので、実際と異なることがあります。在線情報に無い列車は、回送・基地内・運休・運転見合わせのいずれかで、運休と断定はできません。</p>
      </div>`, () => {
      $$('[data-goto]', $('#sheetBody')).forEach((el) => el.addEventListener('click', () => {
        const [pid, r] = el.dataset.goto.split(':');
        closeSheet(); setTimeout(() => openDuty(pid, +r), 80);
      }));
      const here = $('#sheetBody .cmd-stops .here');
      const sheet = $('#sheet');
      if (here && sheet) sheet.scrollTop = Math.max(0, here.offsetTop - 190);
    });
  }
  /* 行路・検索・ダイヤから指令室の列車へ */
  function goCmd(no) {
    state.view = 'cmd';
    CMD.sel = no;
    CMD.filter = 'all';
    closeSheet();
    render();
    setTimeout(() => {
      const info = cmdInfo(no);
      if (info) {
        if (info.branch) cmdScrollToBranch(info.branch, info.bpos);
        else cmdScrollToIdx(info.idx);
      }
      const chip = document.querySelector(`[data-cmd-train="${no}"]`);
      if (chip) chip.classList.add('sel');
      openCmdTrain(no);
    }, 90);
  }
  function cmdJumpTo(idx) {
    if (idx == null || idx < 0) return;
    cmdScrollToIdx(idx);
  }
  /* 支線（太宰府線・甘木線）の列車へボードを寄せる */
  function cmdScrollToBranch(bid, pos) {
    const box = document.querySelector('#cmdImgBox');
    if (!box) return;
    const p = tkimgBranch(bid, pos == null ? 0 : pos, false);
    const inner = box.querySelector('.tkb-img-inner');
    const iw = inner ? inner.offsetWidth : 0;
    if (iw > 0) {
      box.scrollLeft = Math.max(0, (p.x / TKIMG_W) * iw - box.clientWidth / 2);
      CMD.scroll = box.scrollLeft;
    }
    const wrap = box.querySelector('.tkb-img-wrap');
    if (wrap && wrap.getBoundingClientRect) {
      const r = wrap.getBoundingClientRect();
      const y = r.top + (window.scrollY || 0) + (p.y / TKIMG_H) * r.height - (window.innerHeight || 0) / 2;
      if (isFinite(y)) window.scrollTo(0, Math.max(0, y));
    }
  }

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
        ${pats.map((x) => `<button class="chip ${x.id === state.pattern ? 'on' : ''}" data-p="${x.id}">${esc(x.chip || ('No.' + x.no))}</button>`).join('')}
      </div>
      <p class="roster-stats">
        <span>勤務 <b>${ws.length}</b>日</span>
        <span>公休 <b>${offs}</b>日</span>
        <span>週休 <b>${weekly}</b>日</span>
        <span>平均拘束 <b>${fmtDur(avg)}</b></span>
        <button class="linkbtn small sym" id="symBtn">？ 記号</button>
      </p>`;

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
      return `<div class="day off"><div class="dn">${d.row}<i>日目</i></div>
        <div class="mid"><span class="route">公休・代休</span></div><span class="badge off">休</span></div>`;
    }
    if (d.kind === 'weekly') {
      return `<div class="day weekly"><div class="dn">${d.row}<i>日目</i></div>
        <div class="mid"><span class="route">週休</span></div><span class="badge weekly">週休</span></div>`;
    }
    const split = d.duties.length > 1;
    return `<div class="day work" data-row="${d.row}" data-p="${p.id}">
      <div class="dn">${d.row}<i>日目</i></div>
      <div class="mid">
        <div class="times">
          <span class="t">${esc(firstDep(d))}</span><span class="arrow">→</span><span class="t">${esc(lastRet(d))}</span>
          ${split ? '<span class="badge split">分割</span>' : ''}
          <span class="kousoku">${fmtDur(totalKousoku(d))}</span>
        </div>
        <div class="route">${reportPlace(d) ? `<span class="place" style="--pc:${placeColor(reportPlace(d))}">${esc(placeLabel(reportPlace(d)))}発</span>` : ''}${esc(routeText(d))}</div>
      </div>
      <span class="chev">›</span>
    </div>`;
  }

  /* ================= DUTY DETAIL ================= */
  function openDuty(pid, row) {
    history.replaceState(null, '', '#duty/' + pid + '/' + row);
    const p = getPattern(pid);
    const d = p.days.find((x) => x.row === row);
    if (!d) return;
    showSheet(dutyHeader(p, d) + dutyBody(p, d, p.dayType, `${pid}:${row}`), () => {
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
      system: x.system, legs: x.legs || [],
    };
    showSheet(dutyHeader(p, fake, x.name) + dutyBody(p, fake, p.dayType, `x:${pid}:${idx}`), () => {
      $$('[data-train]', $('#sheetBody')).forEach((el) => el.addEventListener('click', () => openTrain(el.dataset.train)));
    });
  }

  function dutyHeader(p, d, extraName) {
    const sp = startPlaceOf(d), ep = endPlaceOf(d);
    return `<div class="duty-head">
      <div class="dh-top">
        <b>${esc(p.label)}</b><span class="dh-duty">${CIRC[(d.dutyNo || 1) - 1]} 行路</span>
        ${d.row ? `<span class="dh-day">${d.row}日目</span>` : ''}
        ${extraName ? `<span class="dh-day">${esc(extraName)}</span>` : ''}
      </div>
      <div class="dh-times">${esc(firstDep(d))}<i>→</i>${esc(lastRet(d))}<em>拘束 ${fmtDur(totalKousoku(d))}</em></div>
      <div class="dh-meta">
        <span class="place" style="--pc:${placeColor(reportPlace(d))}">出勤 ${esc(placeLabel(reportPlace(d)))}</span>
        ${ep ? `<span class="place" style="--pc:${ep.depot ? '#12897c' : '#8698a9'}">退勤 ${esc(ep.name)}${ep.yobi ? '（予備）' : ''}</span>` : ''}
      </div>
    </div>`;
  }

  /* big horizontal "1日の流れ" */
  function flowStrip(d, dt) {
    const legs = legsOf(d);
    if (!legs.length) return '';
    const sp = startPlaceOf(d), ep = endPlaceOf(d);
    const cards = [];
    cards.push(`<div class="flow-item dep">
        <div class="fi-time">${esc(firstDep(d))}</div>
        <div class="fi-main">出勤</div>
        <div class="fi-sub">${esc(sp ? sp.name : d.duties[0].start)}${sp && sp.yobi ? ' ・予備' : ''}</div>
      </div>`);
    let prevT = toMin(firstDep(d));
    legs.forEach((lg) => {
      if (lg.byobi && lg.bt != null && prevT != null && lg.bt - prevT >= 2) {
        cards.push(`<div class="flow-item rest">
          <div class="fi-time">${fmtT(prevT)}–${fmtT(lg.bt)}</div>
          <div class="fi-main">休憩 ${lg.bt - prevT}分</div>
          <div class="fi-sub">予備入出庫</div></div>`);
      }
      if (lg.flag === 'bundle') {
        const bl = bundleBranch(lg, dt, null);
        const bname = bl ? bl.name : '支線';
        cards.push(`<div class="flow-item train loc bundle">
          <div class="fi-time">${fmtT(lg.bt)}</div>
          <div class="fi-main"><span class="no">${esc(bname)}シャトル ${lg.t.length}本</span></div>
          <div class="fi-sub">${esc(lg.bn)} → ${esc(lg.an)}（各列車の時刻は未取得）</div>
          <div class="fi-end">${fmtT(lg.at)} ${esc(SHORT[lg.an] || lg.an)}</div>
        </div>`);
        if (lg.at != null) prevT = lg.at;
        return;
      }
      const r = trainRec(dt, lg.t[0]);
      const cls = typeClass(r && r.type);
      cards.push(`<div class="flow-item train ${cls}${lg.flag === 'conflict' ? ' warn' : ''}" data-train="${esc(lg.t[0])}">
        <div class="fi-time">${fmtT(lg.bt)}</div>
        <div class="fi-main"><span class="no">${esc(lg.t.join('→'))}</span><span class="type ${cls}">${esc(typeShort(r && r.type))}</span></div>
        <div class="fi-sub">${esc(lg.bn)} → ${esc(lg.an)}</div>
        <div class="fi-end">${fmtT(lg.at)} ${esc(SHORT[lg.an] || lg.an)}</div>
        ${(() => { const ci = esApplies(dt) ? esCarsOf(lg.t[0]) : null; return ci && !ci.none ? `<div class="fi-car" title="車号 ${esc(ci.cars)}">車 ${esc(ci.cars)}</div>` : ''; })()}
      </div>`);
      if (lg.at != null) prevT = lg.at;
    });
    cards.push(`<div class="flow-item ret">
        <div class="fi-time">${esc(lastRet(d))}</div>
        <div class="fi-main">退勤</div>
        <div class="fi-sub">${esc(ep ? ep.name : d.duties[d.duties.length - 1].end)}${ep && ep.yobi ? ' ・予備' : ''}</div>
      </div>`);
    return `<div class="flow-block"><h4 class="tl-title">1日の流れ（${legs.length}区間）</h4>
      <div class="flow">${cards.join('<div class="flow-sep"></div>')}</div>
      <p class="flow-note">時刻は<b>乗り込む駅の発車〜降りる駅の到着</b>（西鉄公式時刻表）。列車の始発・終着は各列車の詳細で確認できます。</p></div>`;
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

  function dutyBody(p, d, dt, memoKey) {
    if (!d.system) return `<div class="empty">この日の乗務系統は未読取です。</div>`;
    const toks = tokenize(d.system);
    const diaWarn = (ES.status === 'ready' && ES.diaType !== dt)
      ? `<p class="es-note warn-dia">今日は${ES.diaType === 'holiday' ? '土日祝' : '平日'}ダイヤのため、${dt === 'holiday' ? '土日祝' : '平日'}の車号（編成番号）は表示していません。形式・両数は編成両数表の情報です。</p>`
      : '';
    return `${offStripHTML()}<h4 class="tl-title">乗務タイムライン</h4>
      ${diaWarn}
      ${renderTimeline(d, dt)}
      <div class="btn-row tight">
        <button class="btn small" data-diagram="${p.id}:${d.row}">ダイヤで見る</button>
        <button class="btn small" data-symbols>記号の見方</button>
      </div>
      <details class="fold">
        <summary>1日の流れ（${legsOf(d).length}区間）</summary>
        <div class="fold-body">${flowStrip(d, dt)}</div>
      </details>
      <details class="fold">
        <summary>乗務系統（原本の表記）</summary>
        <div class="fold-body">
          <div class="system-raw">${toks.map((t) => t.kind === 'train'
            ? `<span class="tok-train">${esc(t.v)}</span>`
            : t.kind === 'stn' || t.kind === 'yobi' ? stationPill(t.v, false)
              : t.kind === 'ws' ? ' '
              : `<span class="tok-mark">${esc(t.v)}</span>`).join('')}</div>
          <p class="sys-legend"><b>チ</b>筑紫駅（交代）　<b>チ出・チ入</b>筑紫車両基地　<b>チヨ・ヨ</b>予備（予備入出庫＝休憩）　<b>ハ</b>花畑駅</p>
        </div>
      </details>
      ${memoKey ? `<details class="fold">
        <summary>メモ・申し送り</summary>
        <div class="fold-body">${memoBox(memoKey)}</div>
      </details>` : ''}`;
  }

  function placeSpan(name, depot, yobi, hand) {
    const tags = [];
    if (depot && !/基地/.test(name)) tags.push('<em class="ptag depot">基地</em>');
    if (yobi) tags.push('<em class="ptag yobi">予備入出庫</em>');
    if (hand) tags.push('<em class="ptag hand">交代</em>');
    return `<span class="leg-s">${esc(name)}${tags.join('')}</span>`;
  }

  /* 続行・折り返しで列番が複数ある区間は、列車ごとの時刻を出す（太宰府線の往復など） */
  function trainChips(lg, dt) {
    if (!lg || !lg.t || lg.t.length < 2) return '';
    const chips = lg.t.map((no) => {
      const seq = stopsOf(dt, no);
      if (!seq || seq.length < 2) return `<span class="tchip-s">${esc(no)}</span>`;
      const a = seq[0], z = seq[seq.length - 1];
      const t1 = a[2] != null ? a[2] : a[1], t2 = z[1] != null ? z[1] : z[2];
      return `<span class="tchip-s"><b>${esc(no)}</b> ${fmtMin(t1)} ${esc(stopName(a[0]))}→${fmtMin(t2)} ${esc(stopName(z[0]))}</span>`;
    });
    return `<div class="tchips">${chips.join('')}</div>`;
  }

  function renderTimeline(d, dt) {
    const legs = legsOf(d);
    if (!legs.length) return '<div class="empty">乗務区間を取得できませんでした。</div>';
    let html = '<ul class="tl">';
    let prevAt = toMin(firstDep(d));
    let hasDepot = false, hasYobi = false;
    const markLine = (arr, yobi) => {
      const mk = (arr || []).filter((m) => MARK_INFO[m] && m !== '普' && m !== '~');
      if (!mk.length) return '';
      const mkCls = (m) => (/^(出|入|入出)$/.test(m) ? 'depot' : m === '×' ? 'sw' : /^H/.test(m) ? 'h' : m === '換' ? 'ex' : '');
      return mk.map((m) => `<li class="mark"><div class="note"><b class="mkb ${mkCls(m)}">${esc(m)}</b>${yobi && (m === '出' || m === '入' || m === '入出') ? '<span class="md">（予備入出庫・本人は休憩）</span>' : markDesc(m)}</div></li>`).join('');
    };
    legs.forEach((lg) => {
      const r = trainRec(dt, lg.t[0]);
      const cls = typeClass(r && r.type);
      const warn = lg.flag === 'conflict';
      if (lg.btype === 'depot' || lg.atype === 'depot') hasDepot = true;
      if (lg.byobi || lg.ayobi) hasYobi = true;
      if (lg.byobi) {
        const rest = (lg.bt != null && prevAt != null) ? lg.bt - prevAt : null;
        html += `<li class="rest"><div class="note"><b>休憩</b><span class="md">予備入出庫${rest != null ? `（${fmtT(prevAt)}〜${fmtT(lg.bt)} 約${rest}分）` : ''}。本人は${esc(lg.bn)}から乗り込み</span></div></li>`;
      }
      html += markLine(lg.pre, lg.byobi);
      if (lg.flag === 'bundle') {
        const bl = bundleBranch(lg, dt, null);
        const bname = bl ? bl.name : '支線';
        html += `<li class="train"><div class="train-card loc bundle">
          <div class="tc-top">
            <span class="no">${esc(bname)}シャトル ${lg.t.length}本</span>
            <span class="type loc">まとめ</span>
          </div>
          <div class="leg">
            <div class="leg-row">
              <span class="leg-k">乗</span><b class="leg-t">${fmtT(lg.bt)}</b>${placeSpan(lg.bn, lg.btype === 'depot', lg.byobi, lg.bhand)}
              <span class="leg-arrow">→</span>
              <span class="leg-k">降</span><b class="leg-t">${fmtT(lg.at)}</b>${placeSpan(lg.an, lg.atype === 'depot', lg.ayobi, lg.ahand)}
            </div>
          </div>
          <div class="sub">${esc(bname)}のシャトル ${lg.t.length}本をまとめて表示しています（各列車の発着時刻は未取得）</div>
        </div></li>`;
        html += markLine(lg.post, lg.ayobi);
        if (lg.ayobi) {
          html += `<li class="rest"><div class="note"><b>予備</b><span class="md">予備入出庫。本人は${esc(lg.an)}で降車</span></div></li>`;
        }
        if (lg.at != null) prevAt = lg.at;
        return;
      }
      html += `<li class="train"><div class="train-card ${cls}${warn ? ' warn' : ''}" data-train="${esc(lg.t[0])}">
        <div class="tc-top">
          <span class="no">${esc(lg.t.join('→'))}</span>
          <span class="type ${cls}">${esc(typeShort(r && r.type))}</span>
          ${warn ? `<span class="flag" title="原本の系統表記と公式時刻の整合が取れていません">⚠ 要確認</span>` : ''}
          <span class="run">${(lg.marks || []).filter((m) => m === '×' || m === '換').map((m) => `<em class="mk">${esc(m)}</em>`).join('')}</span>
        </div>
        <div class="leg">
          <div class="leg-row">
            <span class="leg-k">乗</span><b class="leg-t">${fmtT(lg.bt)}</b>${placeSpan(lg.bn, lg.btype === 'depot', lg.byobi, lg.bhand)}
            <span class="leg-arrow">→</span>
            <span class="leg-k">降</span><b class="leg-t">${fmtT(lg.at)}</b>${placeSpan(lg.an, lg.atype === 'depot', lg.ayobi, lg.ahand)}
            ${lg.db === lg.da && !lg.byobi && !lg.ayobi ? '<span class="leg-via">（折り返し）</span>' : ''}
          </div>
        </div>
        ${r ? `<div class="sub">全区間 ${esc(r.dep)} ${esc(canon(r.from))} → ${esc(r.arr)} ${esc(canon(r.to))}${r.set ? ' ・ ' + esc(r.set) : ''}${r.carType ? ' ・ ' + esc(r.carType) + '形' + esc(r.cars) + '両' : ''}</div>` : '<div class="sub">列車データが見つかりません</div>'}
        ${trainChips(lg, dt)}
        ${esCarTag(lg.t[0], dt)}${posBadge(lg.t[0], dt)}
        ${lg.flag === 'whole' ? '<div class="sub">※ 乗務区間の途中時刻を原本から特定できず、列車の全区間を表示しています</div>' : ''}
        ${lg.flag === 'notime' ? '<div class="sub">※ 時刻未取得（この区間の発着時刻は収録データにありません。「—」は未取得の時刻です）</div>' : ''}
      </div></li>`;
      html += markLine(lg.post, lg.ayobi);
      if (lg.ayobi) {
        html += `<li class="rest"><div class="note"><b>予備</b><span class="md">予備入出庫。本人は${esc(lg.an)}で降車</span></div></li>`;
      }
      if (lg.at != null) prevAt = lg.at;
    });
    html += '</ul>';
    const notes = [];
    if (hasDepot) notes.push('※ 車両基地発着（チ出・チ入）の区間は、時刻は筑紫駅の発着です。基地内の乗降はその直前・直後になります。');
    if (hasYobi) notes.push('※ 「予備入出庫」は予備車両の入出庫のため、本人は駅で乗降し、その分休憩できます。');
    return html + (notes.length ? `<p class="flow-note">${notes.join('<br>')}</p>` : '');
  }

  const MARK_INFO = {
    出: '（出庫・車両基地発）', 入: '（入庫・車両基地着）', 入出: '（入庫して再出庫）',
    換: '（車両交換・乗り換え）', 便: '（便乗）',
    '×': '（入れ替えをして同じ車両に再び乗務）', '~': '（同一編成で続行）', 解放: '（車両解放）',
    H: '（構内留置）', H入: '（駅構内留置線へ入換）', H出: '（駅構内留置線から出換）', 普: '（同じ車両のまま列番変更）',
  };
  function markDesc(v) {
    return MARK_INFO[v] ? `<span class="md">${MARK_INFO[v]}</span>` : '';
  }

  /* ================= TRAIN SHEET ================= */
  function openTrain(no) {
    const w = trainRec('weekday', no), h = trainRec('holiday', no);
    const card = (label, r, dt) => r ? `<div class="res-card static">
        <div class="t"><span class="no">${esc(r.no)}</span><span class="type ${typeClass(r.type)}">${esc(typeShort(r.type))}</span>
        <span class="run">${esc(r.dep)} ${esc(canon(r.from))} → ${esc(r.arr)} ${esc(canon(r.to))}</span></div>
        <div class="d">${label}${r.set ? ' ・ ' + esc(r.set) : ''}${r.carType ? ' ・ ' + esc(r.carType) + '形' + esc(r.cars) + '両' : ''}${r.note ? ' ・ ' + esc(r.note) : ''}</div>
        ${esCarLine(r.no, dt)}
        ${posLine(r.no, dt)}
      </div>` : '';
    const uses = [];
    for (const p of D.patterns) for (const d of p.days)
      if (d.system && tokenize(d.system).some((t) => t.kind === 'train' && t.v === no)) {
        const lg = (d.legs || []).find((x) => x.t.includes(no));
        uses.push({ p, d, lg });
      }
    showSheet(`<div class="sheet-head"><h2>列車 ${esc(no)}</h2><button class="sheet-close" data-close>✕</button></div>
      ${card('平日', w, 'weekday')}${card('土日祝', h, 'holiday')}
      ${uses.length ? `<h4 class="tl-title" style="margin-top:14px">この列車を担当する行路（${uses.length}件）</h4>` +
        uses.map((u) => `<div class="res-card" data-goto="${u.p.id}:${u.d.row}">
          <div class="t"><span class="badge work">${u.p.label}</span><span class="badge off">${CIRC[u.d.dutyNo - 1]}</span>
          <span class="run">${u.lg ? `${fmtT(u.lg.bt)} ${esc(u.lg.bn)} → ${fmtT(u.lg.at)} ${esc(u.lg.an)}` : u.d.row + '日目'}</span></div></div>`).join('') : ''}
      <div class="btn-row tight"><button class="btn small" data-cmd="${esc(no)}">指令室で見る</button></div>`);
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
      </div>${offStripHTML()}`;
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

  /* ================= ダイヤグラム ================= */
  const MAIN = D.lines['天神大牟田線'];
  const CANON = { '久留米': '西鉄久留米', '二日市': '西鉄二日市', '小郡': '西鉄小郡', '柳川': '西鉄柳川', '聖マリア': '聖マリア病院前' };
  const canon = (n) => CANON[n] || n;
  const IDX = MAIN.reduce((a, s, i) => (a[s] = i, a), {});
  const DEPOT_STATION = { '筑紫': '筑紫車両基地', '花畑': '花畑車両基地' };
  const DG_RAIL = { '筑紫車両基地': '筑紫基地', '花畑車両基地': '花畑基地' };
  const SHORT = {
    '福岡(天神)': '福岡天神', '西鉄二日市': '二日市', '聖マリア病院前': '聖マリア', '西鉄小郡': '小郡',
    '西鉄久留米': '久留米', '西鉄柳川': '柳川', '西鉄平尾': '平尾', '西鉄中島': '中島', '西鉄渡瀬': '渡瀬',
    '西鉄銀水': '銀水', '西鉄五条': '五条', '古賀茶屋': '古賀茶屋', '筑紫車両基地': '筑紫基地', '花畑車両基地': '花畑基地',
  };
  const MAJOR = ['福岡(天神)', '大橋', '西鉄二日市', '筑紫', '西鉄小郡', '花畑', '大善寺', '西鉄柳川', '大牟田', '太宰府', '甘木'];

  /* ---- 各駅着発（stops.js を必要になったら読む） ---- */
  const STOPS = { ready: false, data: null, status: 'idle' };
  function loadStops() {
    if (STOPS.status !== 'idle') return;
    STOPS.status = 'loading';
    const s = document.createElement('script');
    s.src = 'stops.js?v41';
    s.async = true;
    s.onload = () => {
      STOPS.data = window.APP_STOPS || null;
      STOPS.ready = !!STOPS.data;
      STOPS.status = STOPS.ready ? 'ready' : 'error';
      DG_CACHE = null;                       // 支線（太宰府・甘木）の行を作り直す
      if (state.view === 'diagram' || !$('#sheet').hidden) renderKeep();
    };
    s.onerror = () => {
      STOPS.status = 'error';
      if (state.view === 'diagram') renderKeep();
    };
    document.head.appendChild(s);
  }
  const stopsOf = (dt, no) => (STOPS.ready && STOPS.data && STOPS.data[dt] ? STOPS.data[dt][no] : null);
  const stopName = (si) => (STOPS.data && STOPS.data.stations ? STOPS.data.stations[si] : '');
  const fmtMin = (m) => (m == null ? '—' : `${Math.floor(m / 60) % 24}:${String(Math.round(m) % 60).padStart(2, '0')}`);

  /* ---- ダイヤグラムの軸（駅の並び・車両基地の行・支線） ---- */
  let DG_CACHE = null;
  function dgAxis() {
    if (DG_CACHE) return DG_CACHE;
    const extra = (STOPS.data && STOPS.data.stations ? STOPS.data.stations : []).filter((s) => MAIN.indexOf(s) < 0);
    const dz = extra.filter((s) => s === '太宰府');
    const ag = extra.filter((s) => s !== '太宰府');
    const rows = [];
    for (const st of MAIN) {
      rows.push({ name: st });
      if (DEPOT_STATION[st]) rows.push({ name: DEPOT_STATION[st], depot: true, of: st });
      if (st === '西鉄二日市') dz.forEach((n) => rows.push({ name: n, branch: '太宰府線' }));
      if (st === '宮の陣') ag.forEach((n) => rows.push({ name: n, branch: '甘木線' }));
    }
    const idx = {};
    rows.forEach((r, i) => { idx[r.name] = i; });
    DG_CACHE = { rows, idx };
    return DG_CACHE;
  }

  function renderDiagram(main) {
    const p = getPattern(state.diagram);
    const ws = workDays(p);
    if (state.diagramRow == null || !ws.some((x) => x.row === state.diagramRow)) state.diagramRow = ws[0].row;
    const d = ws.find((x) => x.row === state.diagramRow);
    const perMinTxt = state.dgFit ? '全体' : `1時間 ≒ ${Math.round(state.dgPerMin * 60)}px`;
    main.innerHTML = `
      <div class="seg" id="dayTypeSeg">
        <button data-t="weekday" class="${state.dayType === 'weekday' ? 'on' : ''}">平日</button>
        <button data-t="holiday" class="${state.dayType === 'holiday' ? 'on' : ''}">土日祝</button>
      </div>
      ${offStripHTML()}
      <div class="chips" id="patChips">
        ${patternsOf(state.dayType).map((x) => `<button class="chip ${x.id === state.diagram ? 'on' : ''}" data-p="${x.id}">${esc(x.chip || ('No.' + x.no))}</button>`).join('')}
      </div>
      <div class="chips" id="dayChips">${ws.map((x) => `<button class="chip ${x.row === state.diagramRow ? 'on' : ''}" data-r="${x.row}">${x.row}日目</button>`).join('')}</div>
      <div class="dg-title compact">
        <b>${esc(firstDep(d))} → ${esc(lastRet(d))}</b>
        <span>拘束 ${fmtDur(totalKousoku(d))}${state.dgFit ? '' : ` ・ 1時間≒${Math.round(state.dgPerMin * 60)}px`}</span>
        <span class="dg-tools">
          <button class="tchip ${state.dgFit ? 'on' : ''}" data-zoom="fit">全体</button>
          <button class="tchip" data-zoom="out">−</button>
          <button class="tchip" data-zoom="in">＋</button>
        </span>
      </div>
      ${STOPS.status === 'loading' ? '<p class="dg-hint">各駅の着発時刻を読み込み中…</p>' : ''}
      ${(() => { const g = diagramSVG(d, p.dayType); return `<div class="dg-flex">
        <div class="dg-rail" id="dgRail">${g.rail}</div>
        <div class="diagram-wrap" id="dgWrap">${g.svg}</div>
      </div><p class="dg-hint">${g.note || ''}</p>`; })()}
      <div class="btn-row tight"><button class="btn primary" data-open="${p.id}:${d.row}">この行路の詳細</button></div>
      <details class="fold">
        <summary>凡例・見方</summary>
        <div class="fold-body">
          <div class="legend">
            <span><i class="ltd"></i>特急</span><span><i class="exp"></i>急行</span><span><i class="loc"></i>普通</span><span><i class="dead"></i>回送</span>
            <span><i class="rest"></i>休憩（予備入出庫）</span><span><i class="bundle"></i>支線シャトル（まとめ表示）</span>
            <span class="lg-sym">○乗／降　◇入換（×）　■留置（H入）　┄出入庫</span>
          </div>
          <p class="dg-hint">縦軸＝駅、横軸＝時刻（横にスクロール）。細い実線が各列車のスジ（全区間）、○はこの行路の乗・降、◇は入換（×）、■は留置（H入・H出）、┄は入出庫です。スジをタップすると列車の詳細（列番・時刻・車号・入換）が出ます。<br>支線は分岐駅のすぐ下の行に並べています（太宰府は二日市、甘木線は宮の陣）。支線シャトルは時刻を特定できた列車から列車ごとに分割して表示しています。</p>
        </div>
      </details>`;
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
    $('.dg-tools').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-zoom]'); if (!b) return;
      const z = b.dataset.zoom;
      if (z === 'fit') state.dgFit = !state.dgFit;
      else {
        state.dgFit = false;
        state.dgPerMin = Math.max(1.2, Math.min(12, state.dgPerMin * (z === 'in' ? 1.35 : 1 / 1.35)));
      }
      render();
    });
    $$('[data-tr]', main).forEach((el) => el.addEventListener('click', () => {
      openDiagramTrain(el.dataset.tr, p.dayType, +el.dataset.li);
    }));
    $('[data-open]').addEventListener('click', () => { const [pid, r] = $('[data-open]').dataset.open.split(':'); openDuty(pid, +r); });
    const wrap = $('#dgWrap'), svg = wrap && wrap.querySelector('svg');
    if (svg && svg.dataset.xdep) wrap.scrollLeft = Math.max(0, (+svg.dataset.xdep) - 24);
  }

  /* まとめ区間（支線シャトル）の所属支線。RIDX を渡すと軸上の分岐駅・終着駅の行も返す */
  function bundleBranch(lg, dt, RIDX) {
    let id = null;
    for (const t of lg.t) {
      const sec = (trainRec(dt, t) || {}).section || '';
      if (sec.indexOf('dazaifu') >= 0) { id = 'dz'; break; }
      if (sec.indexOf('amagi') >= 0) { id = 'ag'; break; }
    }
    if (!id && (lg.b === '太' || lg.a === '太')) id = 'dz';
    if (id === 'dz') {
      const out = { id, name: '太宰府線' };
      if (RIDX) { out.jRow = RIDX['西鉄二日市']; out.tRow = RIDX['太宰府']; if (out.jRow == null || out.tRow == null) return null; }
      return out;
    }
    if (id === 'ag') {
      const out = { id, name: '甘木線' };
      if (RIDX) { out.jRow = RIDX['宮の陣']; out.tRow = RIDX['甘木']; if (out.jRow == null || out.tRow == null) return null; }
      return out;
    }
    return null;
  }

  /* 行路の1日を、列車ごとのスジ（全区間の各駅着発）で描く */
  function diagramSVG(d, dt) {
    const AX = dgAxis();
    const RIDX = AX.idx;
    const legs = legsOf(d);
    const stationRow = (name) => {
      if (!name) return null;
      const n = name === '西鉄福岡(天神)' ? '福岡(天神)' : name;
      return RIDX[n] != null ? RIDX[n] : null;
    };
    const rowFor = (name, depot) => {
      if (depot) {
        const n = name === '西鉄福岡(天神)' ? '福岡(天神)' : name;
        const dn = DEPOT_STATION[n];
        if (dn && RIDX[dn] != null) return RIDX[dn];
      }
      return stationRow(name);
    };
    const lines = [];       // {no, cls, pts, li, ti, fallback}
    const bundles = [];     // まとめ区間（flag: 'bundle' の支線シャトル）
    const marks = [];       // {kind, r, t, r2, label}
    const skipped = [];
    const labelAt = [];     // ラベルを置く列車

    legs.forEach((lg, li) => {
      const cls = typeClass((trainRec(dt, lg.t[0]) || {}).type);
      /* まとめ区間（支線シャトル）は列車ごとのスジ・直結フォールバックを引かず、支線内の帯で表す */
      const isBundle = lg.flag === 'bundle';
      if (isBundle) bundles.push({ lg, li });
      let any = isBundle;
      (isBundle ? [] : lg.t).forEach((no, ti) => {
        const seq = stopsOf(dt, no);
        if (!seq || seq.length < 2) return;
        const pts = [];
        seq.forEach(([si, a, dp]) => {
          const r = stationRow(stopName(si));
          if (r == null) return;
          const t = a != null ? a : dp;
          if (t == null) return;
          const prev = pts[pts.length - 1];
          if (prev && prev.r === r && prev.t === t) return;
          pts.push({ r, t });
        });
        if (!pts.length) return;
        if (ti === 0 && lg.bt != null) {           // 乗り込み駅（公式に載らない始発など）を足す
          const br = rowFor(lg.bst, lg.btype === 'depot');
          if (br != null && br !== pts[0].r && lg.bt <= pts[0].t) pts.unshift({ r: br, t: lg.bt });
        }
        if (ti === lg.t.length - 1 && lg.at != null) {   // 降りる駅を足す
          const ar = rowFor(lg.ast, lg.atype === 'depot');
          const lastP = pts[pts.length - 1];
          if (ar != null && ar !== lastP.r && lg.at >= lastP.t) pts.push({ r: ar, t: lg.at });
        }
        if (pts.length > 1) { lines.push({ no, cls, pts, li, ti }); any = true; }
      });
      if (!any) {   // 停車データがない列車（回送など）は乗務区間を直線で
        const br = lg.bt != null ? rowFor(lg.bst, lg.btype === 'depot') : null;
        const ar = lg.at != null ? rowFor(lg.ast, lg.atype === 'depot') : null;
        if (br != null && ar != null && lg.bt != null && lg.at != null) {
          lines.push({ no: lg.t[0], cls, pts: [{ r: br, t: lg.bt }, { r: ar, t: lg.at }], li, ti: 0, fallback: true });
        } else skipped.push(lg.t.join('/'));
      }
      /* 入換・出入庫・留置のしるし */
      const pre = lg.pre || [], post = lg.post || [];
      if (lg.btype === 'depot' && lg.bt != null) {
        const dr = rowFor(lg.bst, true), sr = stationRow(lg.bst);
        if (dr != null) marks.push({ kind: 'depot', r: dr, r2: sr, t: lg.bt, label: '出' });
      }
      if (lg.atype === 'depot' && lg.at != null) {
        const dr = rowFor(lg.ast, true), sr = stationRow(lg.ast);
        if (dr != null) marks.push({ kind: 'depot', r: dr, r2: sr, t: lg.at, label: '入' });
      }
      if (post.includes('H入') && lg.at != null) {
        const r = stationRow(lg.ast);
        if (r != null) marks.push({ kind: 'h', r, t: lg.at, label: '留置' });
      }
      if (pre.includes('H出') && lg.bt != null) {
        const r = stationRow(lg.bst);
        if (r != null) marks.push({ kind: 'h', r, t: lg.bt, label: '出換' });
      }
      if (post.includes('×') && lg.at != null) {
        const r = stationRow(lg.ast);
        if (r != null) marks.push({ kind: 'sw', r, t: lg.at, label: '入換' });
      }
      if (pre.includes('×') && lg.bt != null) {
        const r = stationRow(lg.bst);
        if (r != null) marks.push({ kind: 'sw', r, t: lg.bt, label: '入換' });
      }
      if (post.includes('換') && lg.at != null) {
        const r = stationRow(lg.ast);
        if (r != null) marks.push({ kind: 'ex', r, t: lg.at, label: '交換' });
      }
    });

    if (!lines.length && !bundles.length) return { svg: '<div class="empty">この行路の列車データがありません</div>', rail: '', note: '' };

    /* 範囲 */
    const allT = [];
    lines.forEach((L) => L.pts.forEach((p) => allT.push(p.t)));
    const dep = toMin(firstDep(d)), ret = toMin(lastRet(d));
    if (dep != null) allT.push(dep);
    if (ret != null) allT.push(ret);
    let t0 = Math.floor((Math.min(...allT) - 10) / 30) * 30;
    let t1 = Math.ceil((Math.max(...allT) + 8) / 30) * 30;
    let sMin = Math.min(...lines.map((L) => Math.min(...L.pts.map((p) => p.r))));
    let sMax = Math.max(...lines.map((L) => Math.max(...L.pts.map((p) => p.r))));
    bundles.forEach(({ lg }) => {
      const bi = bundleBranch(lg, dt, RIDX);
      if (bi) { sMin = Math.min(sMin, bi.jRow); sMax = Math.max(sMax, bi.tRow); }
      if (lg.bt != null) allT.push(lg.bt);
      if (lg.at != null) allT.push(lg.at);
    });
    sMin = Math.max(0, sMin - 1); sMax = Math.min(AX.rows.length - 1, sMax + 1);
    const span = Math.max(60, t1 - t0);
    const availW = Math.max(220, (window.innerWidth || 390) - 100);
    const perMin = state.dgFit ? Math.max(0.55, availW / span) : state.dgPerMin;
    const rowH = 17, leftW = 4, topH = 28, botH = 30;
    const W = leftW + span * perMin + 14;
    const H = topH + (sMax - sMin) * rowH + botH;
    const X = (m) => leftW + (m - t0) * perMin;
    const Y = (i) => topH + (i - sMin) * rowH;

    let svg = `<svg width="${W.toFixed(0)}" height="${H.toFixed(0)}" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" role="img" aria-label="ダイヤグラム" data-xdep="${X(dep != null ? dep : t0).toFixed(0)}">`;
    let rail = `<div style="height:${topH}px" class="rail-head"></div>`;

    /* 行（駅・基地・支線） */
    for (let i = sMin; i <= sMax; i++) {
      const ax = AX.rows[i];
      const major = !ax.depot && MAJOR.indexOf(ax.name) >= 0;
      if (ax.depot) svg += `<rect class="dg-band depot" x="0" y="${Y(i) - rowH / 2}" width="${W.toFixed(0)}" height="${rowH}"/>`;
      if (ax.branch) svg += `<rect class="dg-band branch" x="0" y="${Y(i) - rowH / 2}" width="${W.toFixed(0)}" height="${rowH}"/>`;
      svg += `<line class="dg-grid${major ? ' mj' : ''}${ax.depot ? ' depot' : ''}" x1="0" y1="${Y(i)}" x2="${(W - 2).toFixed(0)}" y2="${Y(i)}"/>`;
      rail += `<div class="rail-row${major ? ' major' : ''}${ax.depot ? ' depot' : ''}${ax.branch ? ' branch' : ''}">${esc(DG_RAIL[ax.name] || SHORT[ax.name] || ax.name)}</div>`;
    }
    rail += `<div style="height:${botH}px"></div>`;

    /* 時目盛り */
    const hourStep = perMin * 60 < 22 ? 3 : perMin * 60 < 40 ? 2 : 1;
    for (let m = Math.ceil(t0 / 60) * 60; m <= t1; m += 60) {
      const hh = (m / 60) % 24;
      const big = hh % hourStep === 0;
      svg += `<line class="dg-grid hour${big ? ' big' : ''}" x1="${X(m).toFixed(1)}" y1="${topH - 14}" x2="${X(m).toFixed(1)}" y2="${H - botH + 6}"/>`;
      if (big) svg += `<text class="dg-hour" x="${X(m).toFixed(1)}" y="${topH - 17}" text-anchor="middle">${Math.floor(hh)}</text>`;
    }
    /* 出勤・退勤 */
    if (dep != null) {
      svg += `<line class="dg-mark" x1="${X(dep).toFixed(1)}" y1="${topH - 10}" x2="${X(dep).toFixed(1)}" y2="${H - botH + 6}"/>`;
      svg += `<text class="dg-hinttxt" x="${(X(dep) + 3).toFixed(1)}" y="${topH - 4}" fill="#d8a72f">出勤 ${esc(firstDep(d))}</text>`;
    }
    if (ret != null) {
      svg += `<line class="dg-mark" x1="${X(ret).toFixed(1)}" y1="${topH - 10}" x2="${X(ret).toFixed(1)}" y2="${H - botH + 6}"/>`;
      svg += `<text class="dg-hinttxt" x="${(X(ret) - 3).toFixed(1)}" y="${topH - 4}" text-anchor="end" fill="#d8a72f">退勤 ${esc(lastRet(d))}</text>`;
    }

    /* 予備入出庫の休憩（筑紫の行） */
    const tsuRow = RIDX['筑紫'];
    let prevAt = dep;
    legs.forEach((lg) => {
      if (lg.byobi && lg.bt != null && prevAt != null && lg.bt - prevAt >= 2 && tsuRow != null) {
        const y = Y(tsuRow) - rowH / 2 + 2;
        svg += `<line class="dg-rest" x1="${X(prevAt).toFixed(1)}" y1="${y}" x2="${X(lg.bt).toFixed(1)}" y2="${y}"><title>休憩 ${fmtMin(prevAt)}〜${fmtMin(lg.bt)}（予備入出庫）</title></line>`;
        svg += `<text class="dg-resttx" x="${((X(prevAt) + X(lg.bt)) / 2).toFixed(1)}" y="${(y - 2).toFixed(1)}" text-anchor="middle">休憩</text>`;
      }
      if (lg.at != null) prevAt = lg.at;
    });

    /* まとめ区間：支線の行の内側だけに破線の帯＋往復ジグザグで表す（本線の駅の行は横切らない） */
    bundles.forEach(({ lg }) => {
      const bi = bundleBranch(lg, dt, RIDX);
      if (!bi || lg.bt == null || lg.at == null) return;
      const x0 = X(lg.bt), x1 = X(lg.at);
      const yJ = Y(bi.jRow), yT = Y(bi.tRow);
      const top = Math.min(yJ, yT) - rowH / 2, bot = Math.max(yJ, yT) + rowH / 2;
      const trips = Math.max(2, Math.min(24, Math.round((lg.at - lg.bt) / 10)));
      let zp = '';
      for (let k = 0; k <= trips; k++) { const xx = x0 + (x1 - x0) * k / trips; zp += `${k ? 'L' : 'M'}${xx.toFixed(1)},${(k % 2 ? yT : yJ).toFixed(1)} `; }
      const label = `${bi.name}シャトル ${lg.t.length}本（各列車の時刻は未取得）`;
      svg += `<g class="dg-bundle ${bi.id}"><title>${esc(label)}</title>`
        + `<rect x="${x0.toFixed(1)}" y="${top.toFixed(1)}" width="${(x1 - x0).toFixed(1)}" height="${(bot - top).toFixed(1)}"></rect>`
        + `<path class="dg-bundle-z" d="${zp}"></path>`
        + (x1 - x0 > 170 ? `<text x="${((x0 + x1) / 2).toFixed(1)}" y="${(((yJ + yT) / 2) + 3).toFixed(1)}" text-anchor="middle">${esc(label)}</text>` : '')
        + `</g>`;
    });

    /* スジ */
    const pathD = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.r).toFixed(1)}`).join(' ');
    lines.forEach((L) => {
      const dstr = pathD(L.pts);
      const first = L.pts[0], last = L.pts[L.pts.length - 1];
      const w = Math.abs(X(last.t) - X(first.t));
      const label = L.no.split('→')[0];
      const pi = posInfo(L.no.split('→')[0], dt);
      const pcls = pi && pi.state === 'delay' ? ' late' : pi && pi.state === 'missing' ? ' lost' : '';
      svg += `<g class="dg-tr ${L.cls}${L.fallback ? ' fb' : ''}${pcls}" data-tr="${esc(L.no)}" data-li="${L.li}">`;
      svg += `<path class="dg-hit" d="${dstr}"/>`;
      svg += `<path class="dg-line ${L.cls}" d="${dstr}"/>`;
      svg += `<title>${esc(L.no)} ${esc((trainRec(dt, L.no) || {}).type || '')}　${fmtMin(first.t)} ${esc(AX.rows[first.r].name)} → ${fmtMin(last.t)} ${esc(AX.rows[last.r].name)}</title>`;
      if (w >= 26 && perMin >= 1.4) {
        const mid = L.pts[Math.floor(L.pts.length / 2)];
        const my = Y(mid.r);
        svg += `<text class="dg-label" x="${X(mid.t).toFixed(1)}" y="${(my - 2).toFixed(1)}" text-anchor="middle">${esc(label)}${pi && pi.state === 'delay' ? `<tspan class="dg-dl" dx="1">+${pi.delay}</tspan>` : ''}${pi && pi.state === 'missing' ? '<tspan class="dg-dl lost" dx="1">⚠</tspan>' : ''}</text>`;
        if (esApplies(dt)) {
          const ci = esCarsOf(label);
          if (ci && !ci.none) {
            const full = ci.cars;
            const show = full.length * 3.5 <= w - 4 ? full : (w >= 34 ? full.split(/[+＋／]/)[0].trim() : '');
            if (show) svg += `<text class="dg-car" x="${X(mid.t).toFixed(1)}" y="${(my + 7).toFixed(1)}" text-anchor="middle">${esc(show)}</text>`;
          }
        }
      }
      svg += '</g>';
    });

    /* 入換・出入庫・留置のしるし */
    const seen = {};
    marks.forEach((m) => {
      const key = `${m.kind}:${m.r}:${Math.round(m.t)}`;
      if (seen[key]) return;
      seen[key] = 1;
      const x = X(m.t), y = Y(m.r);
      if (m.kind === 'depot' && m.r2 != null) {
        const sy = Y(m.r2);
        svg += `<line class="dg-depotlink" x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x.toFixed(1)}" y2="${sy.toFixed(1)}"/>`;
        svg += `<circle class="dg-depotdot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.4"><title>${m.label === '出' ? '出庫（車両基地発）' : '入庫（車両基地着）'}</title></circle>`;
        svg += `<text class="dg-mk-t depot" x="${(x + 4).toFixed(1)}" y="${(y + 3).toFixed(1)}">${m.label}</text>`;
      } else if (m.kind === 'h') {
        svg += `<rect class="dg-hsq" x="${(x - 2.6).toFixed(1)}" y="${(y - 2.6).toFixed(1)}" width="5.2" height="5.2"><title>${m.label === '留置' ? '駅構内留置線へ入換（H入）' : '駅構内留置線から出換（H出）'}</title></rect>`;
        svg += `<text class="dg-mk-t h" x="${(x + 5).toFixed(1)}" y="${(y + 3).toFixed(1)}">${m.label}</text>`;
      } else if (m.kind === 'sw') {
        svg += `<path class="dg-sw" d="M${(x - 3.4).toFixed(1)},${y.toFixed(1)} L${x.toFixed(1)},${(y - 3.4).toFixed(1)} L${(x + 3.4).toFixed(1)},${y.toFixed(1)} L${x.toFixed(1)},${(y + 3.4).toFixed(1)} Z"><title>入れ替え（×）をして同じ車両に再び乗務</title></path>`;
        svg += `<text class="dg-mk-t sw" x="${(x + 5).toFixed(1)}" y="${(y + 3).toFixed(1)}">入換</text>`;
      } else if (m.kind === 'ex') {
        svg += `<circle class="dg-exdot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6"><title>車両交換・乗り換え（換）</title></circle>`;
        svg += `<text class="dg-mk-t ex" x="${(x + 4).toFixed(1)}" y="${(y + 3).toFixed(1)}">換</text>`;
      }
    });

    /* 現在時刻と在線位置 */
    const nowT = nowMin();
    if (dt === todayType() && POS.status === 'ready' && nowT >= t0 && nowT <= t1) {
      svg += `<line class="dg-now" x1="${X(nowT).toFixed(1)}" y1="${topH - 12}" x2="${X(nowT).toFixed(1)}" y2="${H - botH + 6}"/>`;
      svg += `<text class="dg-hinttxt" x="${(X(nowT) + 3).toFixed(1)}" y="${(topH - 4).toFixed(1)}" fill="#58a6ff">今 ${fmtMin(nowT)}</text>`;
      lines.forEach((L) => {
        const no = L.no.split('→')[0];
        const p = POS.trains[no];
        if (!p || !p.st) return;
        const r = RIDX[p.st];
        if (r == null) return;
        const dly = Number(p.delay || 0);
        svg += `<g class="dg-pos${dly ? ' delay' : ''}"><circle cx="${X(nowT).toFixed(1)}" cy="${Y(r).toFixed(1)}" r="4.2"><title>${esc(no)} いま ${esc(p.st)}付近・${dly ? dly + '分遅れ' : '定時'}</title></circle>${dly ? `<text class="dg-posdl" x="${(X(nowT) + 5).toFixed(1)}" y="${(Y(r) + 3).toFixed(1)}">${dly}</text>` : ''}</g>`;
      });
    }

    /* 乗・降のしるし */
    legs.forEach((lg) => {
      const br = lg.bt != null ? rowFor(lg.bst, lg.btype === 'depot') : null;
      const ar = lg.at != null ? rowFor(lg.ast, lg.atype === 'depot') : null;
      if (br != null && lg.bt != null) {
        svg += `<circle class="dg-board" cx="${X(lg.bt).toFixed(1)}" cy="${Y(br).toFixed(1)}" r="3.4"><title>乗 ${fmtMin(lg.bt)} ${esc(lg.bn)}</title></circle>`;
      }
      if (ar != null && lg.at != null) {
        svg += `<circle class="dg-alight" cx="${X(lg.at).toFixed(1)}" cy="${Y(ar).toFixed(1)}" r="3.4"><title>降 ${fmtMin(lg.at)} ${esc(lg.an)}</title></circle>`;
      }
    });
    svg += '</svg>';

    /* 注記 */
    const firstRowName = AX.rows[sMin] ? AX.rows[sMin].name : '';
    const lastRowName = AX.rows[sMax] ? AX.rows[sMax].name : '';
    let note = `表示範囲：${esc(canon(firstRowName))} 〜 ${esc(canon(lastRowName))}`;
    if (skipped.length) note += `／時刻が取れなかった列車：${skipped.map(esc).join('、')}`;
    if (lines.some((L) => L.fallback)) note += '／破線＝各駅時刻が未取得のため乗務区間を直結';
    if (bundles.length) note += '／破線の帯＝支線シャトルのまとめ表示（各列車の時刻は未取得）';
    if (esApplies(dt)) note += '／列番の下の小さい数字＝車号（えれサイト4）';
    if (STOPS.status !== 'ready') note += '／各駅の着発時刻を読み込み中（読み込み後に全区間のスジになります）';
    return { svg, rail, note };
  }

  /* スジをタップしたときの列車シート */
  function openDiagramTrain(no, dt, li) {
    const p = getPattern(state.diagram);
    const d = p && p.days.find((x) => x.row === state.diagramRow);
    const lg = ((d && d.legs) || [])[li] || null;
    const seq = stopsOf(dt, no) || [];
    const rows = [];
    if (seq.length) {
      const ns = (si) => stopName(si);
      const a = seq[0], z = seq[seq.length - 1];
      rows.push(['全区間', `${fmtMin(a[2] != null ? a[2] : a[1])} ${esc(ns(a[0]))} → ${fmtMin(z[1] != null ? z[1] : z[2])} ${esc(ns(z[0]))}`]);
      rows.push(['停車駅', `${seq.length}駅`]);
    }
    if (lg) {
      rows.push(['この行路の乗務', `${fmtMin(lg.bt)} ${lg.bn} → ${fmtMin(lg.at)} ${lg.an}`]);
      const mk = (lg.marks || []).filter((m) => MARK_INFO[m]);
      if (mk.length) rows.push(['記号', mk.map((m) => `${m}${MARK_INFO[m]}`).join('　')]);
    }
    const uses = [];
    for (const pp of D.patterns) for (const dd of pp.days)
      if (dd.system && tokenize(dd.system).some((t) => t.kind === 'train' && t.v === no)) uses.push({ pp, dd });
    showSheet(`<div class="sheet-head"><h2>列車 ${esc(no)}</h2><button class="sheet-close" data-close>✕</button></div>
      <div class="res-card static">
        <div class="t"><span class="no">${esc(no)}</span><span class="type ${typeClass((trainRec(dt, no) || {}).type)}">${esc(typeShort((trainRec(dt, no) || {}).type))}</span>
        <span class="run">${dt === 'weekday' ? '平日' : '土日祝'}</span></div>
        ${rows.map(([k, v]) => `<div class="d"><b>${esc(k)}</b>　${v}</div>`).join('')}
        ${esCarLine(no, dt)}
      </div>
      ${seq.length ? `<h4 class="tl-title" style="margin-top:14px">各駅の着発</h4>
        <div class="stop-list">${seq.map(([si, a, dp]) => `<div><span>${esc(stopName(si))}</span><b>${a != null ? fmtMin(a) : '〃'}</b><i>${dp != null ? fmtMin(dp) : '〃'}</i></div>`).join('')}</div>` : ''}
      ${uses.length ? `<h4 class="tl-title" style="margin-top:14px">この列車を担当する行路（${uses.length}件）</h4>` +
        uses.map((u) => `<div class="res-card" data-goto="${u.pp.id}:${u.dd.row}">
          <div class="t"><span class="badge work">${u.pp.label}</span><span class="badge off">${CIRC[u.dd.dutyNo - 1]}</span>
          <span class="run">${u.dd.row}日目 ${esc(firstDep(u.dd))}→${esc(lastRet(u.dd))}</span></div></div>`).join('') : ''}
      <div class="btn-row tight"><button class="btn small" data-cmd="${esc(no)}">指令室で見る</button></div>`);
    $$('[data-goto]', $('#sheetBody')).forEach((el) => el.addEventListener('click', () => {
      const [pid, r] = el.dataset.goto.split(':');
      closeSheet(); setTimeout(() => openDuty(pid, +r), 80);
    }));
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
  const searchState = { mode: 'report', place: '', range: '', from: '', to: '', dt: 'all', exact: '' };

  function reportIndex() {
    const rows = [];
    for (const p of D.patterns) {
      if (!inSel(p)) continue;
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
            <i style="background:${placeColor(c)}"></i>${esc(placeLabel(c))}<b>${seen[c]}</b></button>`).join('')}
        </div>
      </div>
      <div class="filter-block">
        <div class="filter-label">② 出勤時刻</div>
        <div class="range-row">
          <input type="time" id="pinTime" step="60" value="${searchState.exact || ''}" aria-label="出勤時刻をピンポイント指定">
          <button class="btn primary small" id="pinGo">この時刻で探す</button>
          ${searchState.exact ? '<button class="btn small" id="pinClear">解除</button>' : ''}
        </div>
        <details class="fold tight"${(searchState.range || searchState.from || searchState.to) ? ' open' : ''}>
          <summary>時間帯・範囲で絞る</summary>
          <div class="fold-body">
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
        </details>
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
      const exact = searchState.exact ? toMin(searchState.exact) : null;
      if (searchState.range) {
        const [a, b] = searchState.range.split('-');
        from = +a; to = +b;
      } else if (!searchState.exact && (searchState.from || searchState.to)) {
        from = searchState.from ? toMin(searchState.from) : 0;
        to = searchState.to ? toMin(searchState.to) : 24 * 60 + 120;
      }
      const hits = rows.filter((r) => {
        if (searchState.place && r.place !== searchState.place) return false;
        if (searchState.dt !== 'all' && r.p.dayType !== searchState.dt) return false;
        if (exact != null) return r.dep === exact;
        if (from != null && (r.dep == null || r.dep < from)) return false;
        if (to != null && (r.dep == null || r.dep >= to)) return false;
        return true;
      }).sort((a, b) => a.dep - b.dep);
      const res = $('#reportRes');
      if (!hits.length) {
        res.innerHTML = exact != null
          ? `<div class="empty">${esc(searchState.exact)} 出勤の勤務はありません${searchState.place || searchState.dt !== 'all' ? '（出勤場所・ダイヤの条件を外して再検索）' : ''}</div>`
          : '<div class="empty">条件に合う勤務がありません</div>';
        return;
      }
      const head = exact != null
        ? `<div class="res-summary pin"><b>${esc(searchState.exact)} 出勤</b>の勤務 ${hits.length}件<span>${searchState.place ? '・' + esc(placeLabel(searchState.place)) + '発' : ''}${searchState.dt === 'all' ? '' : '・' + (searchState.dt === 'weekday' ? '平日' : '土日祝')}</span></div>`
        : `<div class="res-summary">${searchState.place ? esc(placeLabel(searchState.place)) + '発 ・ ' : ''}該当 ${hits.length}件<span>（出勤時刻順）</span></div>`;
      res.innerHTML = head + hits.map((r) => `<div class="res-card${hits.length === 1 ? ' single' : ''}" data-goto="${r.p.id}:${r.d.row}">
          <div class="t">
            <span class="pill stn" style="--pc:${placeColor(r.place)}"><b>${esc(PLACE_SYMBOL[r.place] || r.place)}</b><i>${esc(placeLabel(r.place))}</i></span>
            <span class="dep-big">${esc(firstDep(r.d))}</span>
            <span class="badge work">${r.p.label}</span>
            <span class="badge off">${CIRC[r.d.dutyNo - 1]}</span>
          </div>
          <div class="d">${r.d.row}日目　${esc(firstDep(r.d))}→${esc(lastRet(r.d))}　拘束 ${fmtDur(totalKousoku(r.d))}　${esc(routeText(r.d))}</div>
          ${hits.length === 1 ? '<div class="open-hint">タップでこの行路の詳細を開く ›</div>' : ''}
        </div>`).join('');
      $$('[data-goto]', res).forEach((el) => el.addEventListener('click', () => {
        const [pid, row] = el.dataset.goto.split(':');
        openDuty(pid, +row);
      }));
    };

    const pinGo = $('#pinGo');
    if (pinGo) pinGo.addEventListener('click', () => {
      const v = $('#pinTime').value;
      searchState.exact = v || '';
      if (v) { searchState.range = ''; searchState.from = ''; searchState.to = ''; }
      render();
    });
    const pinClr = $('#pinClear');
    if (pinClr) pinClr.addEventListener('click', () => { searchState.exact = ''; render(); });
    const pinT = $('#pinTime');
    if (pinT) pinT.addEventListener('change', () => { if (pinT.value) { searchState.exact = pinT.value; searchState.range = ''; searchState.from = ''; searchState.to = ''; render(); } });

    $('#placeChips').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-place]'); if (!b) return;
      searchState.place = b.dataset.place; searchState.exact = '';
      render();
    });
    $('#timeChips').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-r]'); if (!b) return;
      searchState.range = b.dataset.r; searchState.from = ''; searchState.to = ''; searchState.exact = '';
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
      searchState.range = ''; searchState.exact = '';
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
            ${dt === todayType() ? posBadge(r.no, dt) : ''}
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
    const yb = D.codes.filter((c) => isYobi(c.code));
    const mk = D.codes.filter((c) => !CODE_COLOR[c.code] && !isYobi(c.code));
    showSheet(`<div class="sheet-head"><h2>記号の見方</h2><button class="sheet-close" data-close>✕</button></div>
      <div class="sym-callout">
        <div class="sc-head">筑紫の扱い（車両基地か駅か）</div>
        <ul class="sc-list">
          <li><span class="pill stn" style="--pc:#12897c"><b>チ出</b><i>筑紫車両基地</i></span>本人が出庫して乗り込む → <b>筑紫車両基地</b>発</li>
          <li><span class="pill stn" style="--pc:#12897c"><b>チ入</b><i>筑紫車両基地</i></span>本人が入庫する → <b>筑紫車両基地</b>着</li>
          <li><span class="pill stn" style="--pc:#22b8a6"><b>チ</b><i>筑紫駅</i></span>ふつうに乗る → <b>筑紫駅ホームでの乗務交代</b></li>
          <li><span class="pill yobi"><b>チヨ・ヨ・ハヨ</b><i>予備</i></span><b>予備入出庫</b>するため、本人は駅で乗降してその分<b>休憩</b>できる</li>
        </ul>
        <p class="sc-note">出勤・退勤場所も同じ基準で表示しています（出庫なら筑紫車両基地発、予備なら筑紫駅発）。</p>
      </div>
      <h4 class="tl-title" style="margin-top:14px">駅・記号</h4>
      <div class="sym-grid">${st.map((c) => `<div class="sym"><span class="pill stn" style="--pc:${CODE_COLOR[c.code]}"><b>${esc(c.code)}</b><i>${esc(c.name)}</i></span></div>`).join('')}</div>
      <h4 class="tl-title" style="margin-top:14px">予備（ヨ）</h4>
      <div class="sym-grid">${yb.map((c) => `<div class="sym"><span class="pill yobi"><b>${esc(c.code)}</b><i>${esc(c.name)}</i></span>${c.note ? `<span class="md">${esc(c.note)}</span>` : ''}</div>`).join('')}</div>
      <div class="sym-list"><div><b>休憩</b>　ヨ（チヨ・ハヨ）は予備入出庫（予備車両の入出庫）なので、本人はその間休憩できます。</div></div>
      <h4 class="tl-title" style="margin-top:14px">動作・マーク</h4>
      <div class="sym-list">${mk.map((c) => `<div><b>${esc(c.code)}</b>　${esc(c.name)}${c.note ? ` <span class="md">（${esc(c.note)}）</span>` : ''}</div>`).join('')}</div>
      <h4 class="tl-title" style="margin-top:14px">乗務区間の表示について</h4>
      <div class="sym-list">
        <div><b>乗 / 降</b>　その列車に<b>乗り込む駅</b>と<b>降りる駅</b>。時刻は西鉄公式時刻表の実際の発着時刻です。</div>
        <div><b>基地</b>　車両基地発着（チ出・チ入）の区間。時刻は筑紫駅の発着で、基地内の乗降はその直前・直後です。</div>
        <div><b>予備入出庫</b>　ヨは予備車両の入出庫。本人は駅で乗降し、その分休憩できます。</div>
        <div><b>交代</b>　筑紫駅ホームでの乗務交代（車両基地ではない）。</div>
        <div><b>全区間</b>　その列車自身の始発〜終着（乗務する区間とは限りません）。</div>
        <div><b>⚠ 要確認</b>　原本（乗務系統表）の表記と公式時刻表の整合が取れていない区間。原本をご確認ください。</div>
      </div>
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
    // 詳細を開いたときに付けた深いハッシュ（#duty/K1/3 等）を画面のハッシュへ戻す
    if ((location.hash || '').indexOf('/') >= 0) history.replaceState(null, '', '#' + state.view);
  }
  $('#sheetBackdrop').addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

  let pendingDuty = null;
  function applyHash() {
    const h = (location.hash || '').replace(/^#\/?/, '');
    if (!h) return false;
    const [view, a, b] = h.split('/');
    if (!['roster', 'duty', 'diagram', 'search', 'cmd'].includes(view)) return false;
    state.view = view;
    if (view === 'cmd' && a) state.cmdHash = a;
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
    else if (state.view === 'cmd') renderCmd(main);
    else renderSearch(main);
    syncHash();
    window.scrollTo({ top: 0 });
    if (pendingDuty) { const pd = pendingDuty; pendingDuty = null; openDuty(pd.pid, pd.row); }
    if (state.cmdHash) { const no = state.cmdHash; state.cmdHash = null; setTimeout(() => goCmd(no), 60); }
  }

  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('.tab'); if (!b) return;
    closeSheet();
    state.view = b.dataset.view;
    if (state.view === 'diagram') {
      const p = getPattern(state.pattern);
      state.dayType = p.dayType; state.diagram = p.id; state.diagramRow = null;
    }
    render();
  });

  /* ---- 指令室・列車詳細への入口（行路・検索・ダイヤのどこからでも） ---- */
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-off-detail]')) { e.preventDefault(); openOffDetail(); return; }
    if (e.target.closest('[data-off-refresh]')) { e.preventDefault(); offFetchAll(true); return; }
    const b = e.target.closest('[data-cmd]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    goCmd(b.dataset.cmd);
  }, true);
  $('#main').addEventListener('click', (e) => {
    const tr = e.target.closest('[data-cmd-train]');
    if (tr) {
      e.preventDefault();
      CMD.sel = tr.dataset.cmdTrain;
      $$('.cchip.sel, .cmd-row.sel').forEach((x) => x.classList.remove('sel'));
      tr.classList.add('sel');
      openCmdTrain(tr.dataset.cmdTrain);
      return;
    }
    const f = e.target.closest('[data-cmd-filter]');
    if (f) { CMD.filter = f.dataset.cmdFilter; paintCmd(); return; }
    if (e.target.closest('[data-cmd-refresh]')) { posFetch(true); return; }
    const au = e.target.closest('[data-cmd-auto]');
    if (au) {
      CMD.auto = !CMD.auto;
      localStorage.setItem('cmd:auto', CMD.auto ? '1' : '0');
      au.classList.toggle('on', CMD.auto);
      updateCmdClock();
      if (CMD.auto) posFetch(true);
      return;
    }
    const z = e.target.closest('[data-cmd-zoom]');
    if (z) {
      const i = CMD_ZOOM_STEPS.indexOf(CMD.zoom);
      CMD.zoom = CMD_ZOOM_STEPS[Math.max(0, Math.min(CMD_ZOOM_STEPS.length - 1, i + (z.dataset.cmdZoom === '+' ? 1 : -1)))];
      paintCmd(); return;
    }
    const j = e.target.closest('[data-cmd-jump]');
    if (j) { cmdJumpTo(+j.dataset.cmdJump); return; }
    if (e.target.closest('[data-cmd-more]')) { CMD.more = !CMD.more; paintCmd(); return; }
  });

  const savedTheme = localStorage.getItem('theme');
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;
  $('#themeBtn').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = cur;
    localStorage.setItem('theme', cur);
  });

  /* ---------- 乗務所・職種の選択（初期画面） ---------- */
  const DEPOTS = { chikushi: '筑紫', yanagawa: '柳川' };
  const ROLES = { driver: '運転士', conductor: '車掌' };
  let hasSel = !!savedSel;
  let pendingSel = { depot: state.depot, role: state.role };
  function ensureSelectionPatterns() {
    if (!inSel(getPattern(state.pattern) || {})) {
      const p0 = patternsOf(state.dayType)[0] || D.patterns.find((p) => inSel(p));
      if (p0) { state.pattern = p0.id; state.dayType = p0.dayType; }
    }
    if (!inSel(getPattern(state.diagram) || {})) state.diagram = state.pattern;
  }
  function updateBrand() {
    const bt = $('#brandSubText');
    if (bt) bt.textContent = `${DEPOTS[state.depot]} ${ROLES[state.role]} 輪番・乗務系統`;
    const sb = $('#selBtn');
    if (sb) sb.textContent = `${DEPOTS[state.depot]}・${ROLES[state.role]}`;
  }
  function paintStartScreen() {
    $$('#startScreen [data-sel-depot]').forEach((b) => b.classList.toggle('on', pendingSel.depot === b.dataset.selDepot));
    $$('#startScreen [data-sel-role]').forEach((b) => b.classList.toggle('on', pendingSel.role === b.dataset.selRole));
    const cl = $('#startClose');
    if (cl) cl.style.display = hasSel ? '' : 'none';
  }
  function openStartScreen() {
    const sc = $('#startScreen');
    if (!sc) return;
    pendingSel = { depot: state.depot, role: state.role };
    paintStartScreen();
    sc.hidden = false;
  }
  function closeStartScreen() { const sc = $('#startScreen'); if (sc) sc.hidden = true; }
  function applySelection() {
    state.depot = pendingSel.depot; state.role = pendingSel.role;
    hasSel = true;
    try { localStorage.setItem(SEL_KEY, JSON.stringify({ depot: state.depot, role: state.role })); } catch (e) {}
    ensureSelectionPatterns();
    updateBrand();
    closeStartScreen();
    state.view = 'roster';
    render();
  }
  ensureSelectionPatterns();
  updateBrand();
  const startEl = $('#startScreen');
  if (startEl) {
    startEl.addEventListener('click', (e) => {
      const d = e.target.closest('[data-sel-depot]');
      if (d) { pendingSel.depot = d.dataset.selDepot; paintStartScreen(); return; }
      const r = e.target.closest('[data-sel-role]');
      if (r) { pendingSel.role = r.dataset.selRole; paintStartScreen(); return; }
      if (e.target.closest('#startGo')) applySelection();
      else if (e.target.closest('#startClose')) closeStartScreen();
    });
    if (!hasSel) openStartScreen();
  }
  const selBtnEl = $('#selBtn');
  if (selBtnEl) selBtnEl.addEventListener('click', openStartScreen);

  if (D && D.version) $('#verBadge').textContent = D.version;
  applyHash();
  render();

  /* えれサイト4（車号） */
  esLoad();
  renderEsBar();
  esFetch(false);
  loadStops();

  /* 公式運行情報（公式X・遅延証明書・運行状況） */
  offLoad();
  offRepaint();
  offFetchAll(false);

  /* 在線位置（西鉄 列車走行位置） */
  posLoad();
  renderPosBar();
  posFetch(false);
  if ($('#posPill')) $('#posPill').addEventListener('click', () => {
    if (POS.status === 'ready' || POS.status === 'loading') { state.view = 'cmd'; render(); }
    else openPosAlert();
  });
  if ($('#allRefresh')) $('#allRefresh').addEventListener('click', () => { posFetch(true); offFetchAll(true); if (ES.status !== 'loading') esFetch(true); });
  setInterval(() => {
    if (document.visibilityState === 'visible' && CMD.auto) { posFetch(false); renderPosBar(); }
  }, 60 * 1000);
  setInterval(() => { if (state.view === 'cmd') updateCmdClock(); }, 1000);
  /* 公式運行情報は指令タブ以外（行路・ダイヤ）でも更新しておく */
  setInterval(() => {
    if (document.visibilityState === 'visible') offFetchAll(false);
  }, 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { posFetch(true); offFetchAll(false); }
  });
  if ($('#esPill')) $('#esPill').addEventListener('click', () => {
    if (ES.status === 'idle') esFetch(true); else openEsDetail();
  });
  window.addEventListener('resize', () => renderEsBar());

  window.addEventListener('hashchange', () => { if (applyHash()) render(); });
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
})();
