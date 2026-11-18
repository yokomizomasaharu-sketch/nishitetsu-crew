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

  const state = { view: 'roster', dayType: 'weekday', pattern: 'H1', diagram: 'H1', diagramRow: null, dgPerMin: 2.4, dgFit: false };

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
  const CODES = [...Object.keys(CODE_COLOR), ...YOBI, '入出', '解放', 'H入', 'H出', '出', '入', '換', '便', '×', '~', '/', '(', ')', '普', 'H']
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
     出庫（チ出）なら筑紫車両基地、ふつうのチは筑紫駅（交代）、ヨは予備代行で駅 */
  const PLACE_RE = /^(チヨ|ハヨ|フ|チ|ハ|二|小|善|大|太|津|聖|久|甘|柳)/;
  const PLACE_LABEL = { 'チヨ': '筑紫車両基地', 'チ': '筑紫駅', 'ハヨ': '花畑車両基地', 'ハ': '花畑駅' };
  const PLACE_COLOR = { 'チヨ': '#12897c', 'チ': '#22b8a6', 'ハヨ': '#7bc043', 'ハ': '#5ec14f' };
  const PLACE_SYMBOL = { 'チヨ': 'チ', 'チ': 'チ', 'ハヨ': 'ハ', 'ハ': 'ハ' };
  const STN_KEY = { '筑紫': 'チ', '花畑': 'ハ' };
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
  const patternsOf = (dt) => D.patterns.filter((p) => p.dayType === dt);
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
      ES.map = c.map; ES.status = 'ready';
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
      const counts = { unyou: 0, unyouCar: 0, retsuban: 0, retsubanCar: 0 };
      for (const t of tables) {
        for (const g of (t && t.unyou_table) || []) {
          for (const u of (g.unyou_group || [])) {
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
        return `今日は${ES.diaType === 'holiday' ? '土日祝' : '平日'}ダイヤ（${esc(ES.diaName)}）のため、${dt === 'holiday' ? '土日祝' : '平日'}の車号は表示していません。`;
      }
      return `車号＝えれサイト4の運用情報（${esc(esClock(ES.fetchedAt))}取得・利用者の投稿）。「—」は未投稿または回送です。${ES.staleFailed ? '現在再取得できていないため前回の情報です。' : ''}`;
    }
    if (ES.status === 'loading') return '車号を取得しています…（えれサイト4）';
    if (ES.status === 'error') return '車号を取得できませんでした（えれサイト4）。上の車号バーの「↻」で再取得できます。';
    return '';
  }

  function esBarText() {
    if (ES.status === 'loading') return ['load', '車号を取得中…（えれサイト4）'];
    if (ES.status === 'error') return ['err', '車号を取得できません · タップで詳細'];
    if (ES.status === 'ready') {
      const c = ES.counts;
      const stale = ES.staleFailed || Date.now() - ES.fetchedAt > ES.STALE;
      const txt = ES.staleFailed
        ? `車号 ${c.retsubanCar}/${c.retsuban}列車 · ${esClock(ES.fetchedAt)}取得（更新できません）`
        : `車号 ${c.retsubanCar}/${c.retsuban}列車 · ${esClock(ES.fetchedAt)}取得`;
      return [stale ? 'stale' : 'ok', txt];
    }
    return ['idle', '車号：えれサイト4から取得（タップ）'];
  }
  function renderEsBar() {
    const bar = $('#esBar');
    if (!bar) return;
    const [cls, txt] = esBarText();
    bar.dataset.state = cls;
    bar.hidden = false;
    const main = $('#esBarMain');
    if (main) main.innerHTML = `<span class="es-dot"></span><span class="es-txt">${esc(txt)}</span>`;
    const rf = $('#esRefresh');
    if (rf) { rf.disabled = ES.status === 'loading'; rf.classList.toggle('spin', ES.status === 'loading'); }
    const tb = $('.tabs');
    if (tb) bar.style.top = (tb.offsetTop + tb.offsetHeight) + 'px';
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
        <div class="btn-row"><button class="btn primary" id="esReload"${ES.status === 'loading' ? ' disabled' : ''}>再取得</button>
          <a class="btn" href="${ES.SITE}" target="_blank" rel="noopener noreferrer">運用表を開く</a></div>
        ${pending.length ? `<h4 class="tl-title" style="margin-top:14px">車号が未投稿の列番（${pending.length}件）</h4>
          <p class="es-pending">${pending.slice(0, 80).map(esc).join('　')}${pending.length > 80 ? `　ほか${pending.length - 80}件` : ''}</p>` : ''}
        <p class="es-caution">えれサイト4の運用情報は利用者の投稿です。未投稿・誤り・あとからの変更があります。乗務前に運用表（原本）でもご確認ください。今日のダイヤ（${esc(ES.diaName || '—')}）の内容で、ほかのダイヤの日には表示しません。回送列車は列番での掲載がないため車号は出ません。</p>
      </div>`, () => {
      const r = $('#esReload');
      if (r) r.addEventListener('click', () => esFetch(true));
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
        if (state.view === 'diagram' || !$('#sheet').hidden) renderKeep();
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
      if (state.view === 'diagram') renderKeep();
      else if (! $('#sheet').hidden && $('.pos-detail')) openPosDetail();
      else {
        const ae = document.activeElement;
        if (!ae || (ae.tagName !== 'INPUT' && ae.tagName !== 'TEXTAREA')) renderKeep();
      }
    } catch (err) {
      POS.status = 'error';
      POS.error = '在線情報を読めませんでした';
      renderPosBar();
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
    if (p.state === 'on') return `<span class="pos-b on" title="西鉄 列車走行位置（${esc(posClock())}）"><i>在線</i>${esc(p.where)}付近・定時</span>`;
    if (p.state === 'delay') return `<span class="pos-b delay" title="西鉄 列車走行位置（${esc(posClock())}）"><i>遅延</i>${esc(p.where)}付近・${p.delay}分遅れ</span>`;
    if (p.state === 'missing') return `<span class="pos-b warn" title="在線情報にこの列番がありません（回送・基地内・運休など）"><i>⚠</i>在線なし</span>`;
    if (p.state === 'before') return `<span class="pos-b idle"><i>−</i>運行前</span>`;
    if (p.state === 'done') return `<span class="pos-b idle"><i>−</i>運行終了</span>`;
    return '';
  }
  function posLine(no, dt) {
    const p = posInfo(no, dt);
    if (!p) return '';
    const when = `${posClock()} 取得・西鉄 列車走行位置`;
    if (p.state === 'on') return `<div class="pos-line on"><b>在線</b>${esc(p.where)}付近・定時<span>${esc(when)}</span></div>`;
    if (p.state === 'delay') return `<div class="pos-line delay"><b>遅延</b>${esc(p.where)}付近・${p.delay}分遅れ<span>${esc(when)}</span></div>`;
    if (p.state === 'missing') return `<div class="pos-line warn"><b>⚠</b>在線情報にこの列番がありません<span>回送・基地内・運休のいずれか（${esc(when)}）</span></div>`;
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
      if (p.dayType !== dt) continue;
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
    const bar = $('#posBar');
    if (!bar) return;
    bar.hidden = false;
    let cls = 'idle', txt = '在線位置：タップで取得';
    if (POS.status === 'loading') { cls = 'load'; txt = '在線位置を取得中…'; }
    else if (POS.status === 'error') { cls = 'err'; txt = '在線位置を取得できません · タップで詳細'; }
    else if (POS.status === 'ready') {
      const dg = posDigest();
      const parts = [`在線 ${dg.running}本`, `${posClock()}更新`];
      if (dg.delayed) parts.push(`遅延 ${dg.delayed}本（最大${dg.maxDelay}分）`);
      if (dg.missing) parts.push(`在線なし ${dg.missing}本`);
      cls = (dg.maxDelay >= 5) || dg.missing >= 3 || dg.stale ? 'warn' : 'ok';
      txt = parts.join(' · ');
      if (POS.source === 'relay') txt += '・中継';
    }
    bar.dataset.state = cls;
    const m = $('#posBarMain');
    if (m) m.innerHTML = `<span class="pos-dot"></span><span class="pos-txt">${esc(txt)}</span>`;
    const rf = $('#posRefresh');
    if (rf) { rf.disabled = POS.status === 'loading'; rf.classList.toggle('spin', POS.status === 'loading'); }
    const tb = $('.tabs');
    if (tb) { const top = tb.offsetTop + tb.offsetHeight; bar.style.top = top + 'px'; const eb = $('#esBar'); if (eb && !eb.hidden) { bar.style.top = (eb.offsetTop + eb.offsetHeight) + 'px'; } }
    renderAlert();
  }
  function renderAlert() {
    const box = $('#alertBox');
    if (!box) return;
    const dg = posDigest();
    let html = '';
    if (POS.status === 'error') {
      html = `<div class="alert-line"><b>⚠ 在線情報を取得できません</b><span>${esc(POS.error || '')}。公式の列車走行位置で確認してください。</span>
        <a href="${POS.SITE}" target="_blank" rel="noopener noreferrer">公式の在線位置</a></div>`;
    } else if (dg) {
      const items = [];
      if (dg.stale) items.push(`在線情報が ${posClock()} のまま更新されていません`);
      if (dg.maxDelay >= 5) items.push(`遅延 ${dg.delayed}本（最大 ${dg.maxDelay}分）`);
      if (dg.missing >= 3) items.push(`在線情報にない列車 ${dg.missing}本（運休・運転見合わせの可能性）${dg.missingList.slice(0, 4).map((x) => x.no).join('・')}${dg.missing > 4 ? ' ほか' : ''}`);
      if (items.length) {
        html = `<div class="alert-line"><b>⚠ 運行異常の可能性</b><span>${items.map(esc).join('　/　')}</span>
          <a href="${POS.SITE}" target="_blank" rel="noopener noreferrer">公式の在線位置</a>
          <a href="${POS.X}" target="_blank" rel="noopener noreferrer">西鉄公式X</a></div>
          <p class="alert-note">在線情報（西鉄 列車走行位置）の位置・遅延と、在線していない列車から推定したものです。運休・運転見合わせの公式発表は公式サイト・Xでご確認ください。</p>`;
      }
    }
    box.innerHTML = html;
    box.hidden = !html;
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
        <div class="route">${reportPlace(d) ? `<span class="place" style="--pc:${placeColor(reportPlace(d))}">${esc(placeLabel(reportPlace(d)))}発</span>` : ''}${esc(routeText(d))}</div>
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
      system: x.system, legs: x.legs || [],
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
        ${reportPlace(d) ? `<span class="place" style="--pc:${placeColor(reportPlace(d))}">出勤 ${esc(placeLabel(reportPlace(d)))}</span>` : ''}
        ${endPlaceOf(d) ? `<span class="place ret" style="--pc:${(endPlaceOf(d).depot ? '#12897c' : '#8698a9')}">退勤 ${esc(endPlaceOf(d).name)}${endPlaceOf(d).yobi ? '（予備）' : ''}</span>` : ''}
      </div>
      <div class="times">${esc(firstDep(d))}<i>→</i>${esc(lastRet(d))}<span>拘束 ${fmtDur(totalKousoku(d))}</span></div>
      <div class="route">${d.duties.map((x) => `${esc(x.start)} → ${esc(x.end)}`).join('　／　')}</div>
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
          <div class="fi-sub">予備の運転士が入出庫代行</div></div>`);
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

  function dutyBody(p, d, dt) {
    if (!d.system) return `<div class="empty">この日の乗務系統は未読取です。</div>`;
    const toks = tokenize(d.system);
    return `<div class="system-block">
        <h4>乗務系統（原本の表記）</h4>
        ${d.systemRaw && d.systemRaw !== d.system ? '<p class="flow-note">※ 先頭・末尾の駅は輪番表の始・終に合わせています</p>' : ''}
        <div class="system-raw">${toks.map((t) => t.kind === 'train'
          ? `<span class="tok-train">${esc(t.v)}</span>`
          : t.kind === 'stn' || t.kind === 'yobi' ? stationPill(t.v, false)
            : t.kind === 'ws' ? ' '
            : `<span class="tok-mark">${esc(t.v)}</span>`).join('')}</div>
        <p class="sys-legend"><b>チ</b>筑紫駅（交代）　<b>チ出・チ入</b>筑紫車両基地　<b>チヨ・ヨ</b>予備（入出庫代行＝休憩）　<b>ハ</b>花畑駅</p>
      </div>
      <h4 class="tl-title">乗務タイムライン（乗り込み駅 → 降りる駅）</h4>
      ${esNoteText(dt) ? `<p class="es-note">${esNoteText(dt)}</p>` : ''}
      ${renderTimeline(d, dt)}
      <div class="btn-row">
        <button class="btn primary" data-diagram="${p.id}:${d.row}">ダイヤグラムで見る</button>
        <button class="btn" data-symbols>記号の見方</button>
      </div>`;
  }

  function placeSpan(name, depot, yobi, hand) {
    const tags = [];
    if (depot && !/基地/.test(name)) tags.push('<em class="ptag depot">基地</em>');
    if (yobi) tags.push('<em class="ptag yobi">予備代行</em>');
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
      return mk.map((m) => `<li class="mark"><div class="note"><b class="mkb ${mkCls(m)}">${esc(m)}</b>${yobi && (m === '出' || m === '入' || m === '入出') ? '<span class="md">（予備の運転士が入出庫代行・本人は休憩）</span>' : markDesc(m)}</div></li>`).join('');
    };
    legs.forEach((lg) => {
      const r = trainRec(dt, lg.t[0]);
      const cls = typeClass(r && r.type);
      const warn = lg.flag === 'conflict';
      if (lg.btype === 'depot' || lg.atype === 'depot') hasDepot = true;
      if (lg.byobi || lg.ayobi) hasYobi = true;
      if (lg.byobi) {
        const rest = (lg.bt != null && prevAt != null) ? lg.bt - prevAt : null;
        html += `<li class="rest"><div class="note"><b>休憩</b><span class="md">予備の運転士が入出庫を代行${rest != null ? `（${fmtT(prevAt)}〜${fmtT(lg.bt)} 約${rest}分）` : ''}。本人は${esc(lg.bn)}から乗り込み</span></div></li>`;
      }
      html += markLine(lg.pre, lg.byobi);
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
      </div></li>`;
      html += markLine(lg.post, lg.ayobi);
      if (lg.ayobi) {
        html += `<li class="rest"><div class="note"><b>予備</b><span class="md">入出庫は予備の運転士が代行。本人は${esc(lg.an)}で降車</span></div></li>`;
      }
      if (lg.at != null) prevAt = lg.at;
    });
    html += '</ul>';
    const notes = [];
    if (hasDepot) notes.push('※ 車両基地発着（チ出・チ入）の区間は、時刻は筑紫駅の発着です。基地内の乗降はその直前・直後になります。');
    if (hasYobi) notes.push('※ 「予備代行」の入出庫は予備の運転士が行うため、本人は駅で乗降し、その分休憩できます。');
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
          <span class="run">${u.lg ? `${fmtT(u.lg.bt)} ${esc(u.lg.bn)} → ${fmtT(u.lg.at)} ${esc(u.lg.an)}` : u.d.row + '日目'}</span></div></div>`).join('') : ''}`);
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
    s.src = 'stops.js?v25';
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
      <div class="chips" id="patChips">
        ${patternsOf(state.dayType).map((x) => `<button class="chip ${x.id === state.diagram ? 'on' : ''}" data-p="${x.id}">No.${x.no}</button>`).join('')}
      </div>
      <div class="chips" id="dayChips">${ws.map((x) => `<button class="chip ${x.row === state.diagramRow ? 'on' : ''}" data-r="${x.row}">${CIRC[x.dutyNo - 1]} ${x.row}日目</button>`).join('')}</div>
      <div class="dg-title"><b>${esc(firstDep(d))} → ${esc(lastRet(d))}</b>　${esc(p.label)}・${d.row}日目・行路${CIRC[d.dutyNo - 1]}<span>拘束 ${fmtDur(totalKousoku(d))}</span></div>
      <div class="dg-tools">
        <button class="tchip ${state.dgFit ? 'on' : ''}" data-zoom="fit">全体</button>
        <button class="tchip" data-zoom="in">拡大</button>
        <button class="tchip" data-zoom="out">縮小</button>
        <span class="dg-scale">${perMinTxt}</span>
      </div>
      <div class="legend">
        <span><i class="ltd"></i>特急</span><span><i class="exp"></i>急行</span><span><i class="loc"></i>普通</span><span><i class="dead"></i>回送</span>
        <span><i class="rest"></i>休憩（予備代行）</span>
        <span class="lg-sym">○乗／降　◇入換（×）　■留置（H入）　┄出入庫</span>
      </div>
      ${STOPS.status === 'loading' ? '<p class="dg-hint">各駅の着発時刻を読み込み中…</p>' : ''}
      ${(() => { const g = diagramSVG(d, p.dayType); return `<div class="dg-flex">
        <div class="dg-rail" id="dgRail">${g.rail}</div>
        <div class="diagram-wrap" id="dgWrap">${g.svg}</div>
      </div><p class="dg-hint">${g.note || ''}</p>`; })()}
      <p class="dg-hint">縦軸＝駅、横軸＝時刻（横にスクロール）。細い実線が各列車のスジ（全区間）、○はこの行路の乗・降、◇は入換（×）、■は留置（H入・H出）、┄は入出庫です。スジをタップすると列車の詳細（列番・時刻・車号・入換）が出ます。<br>支線は分岐駅のすぐ下の行に並べています（太宰府は二日市、甘木線は宮の陣）。</p>
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
    const marks = [];       // {kind, r, t, r2, label}
    const skipped = [];
    const labelAt = [];     // ラベルを置く列車

    legs.forEach((lg, li) => {
      const cls = typeClass((trainRec(dt, lg.t[0]) || {}).type);
      let any = false;
      lg.t.forEach((no, ti) => {
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

    if (!lines.length) return { svg: '<div class="empty">この行路の列車データがありません</div>', rail: '', note: '' };

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

    /* 予備代行の休憩（筑紫の行） */
    const tsuRow = RIDX['筑紫'];
    let prevAt = dep;
    legs.forEach((lg) => {
      if (lg.byobi && lg.bt != null && prevAt != null && lg.bt - prevAt >= 2 && tsuRow != null) {
        const y = Y(tsuRow) - rowH / 2 + 2;
        svg += `<line class="dg-rest" x1="${X(prevAt).toFixed(1)}" y1="${y}" x2="${X(lg.bt).toFixed(1)}" y2="${y}"><title>休憩 ${fmtMin(prevAt)}〜${fmtMin(lg.bt)}（予備の運転士が入出庫を代行）</title></line>`;
        svg += `<text class="dg-resttx" x="${((X(prevAt) + X(lg.bt)) / 2).toFixed(1)}" y="${(y - 2).toFixed(1)}" text-anchor="middle">休憩</text>`;
      }
      if (lg.at != null) prevAt = lg.at;
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
        svg += `<text class="dg-label" x="${X(mid.t).toFixed(1)}" y="${(my - 2).toFixed(1)}" text-anchor="middle">${esc(label)}</text>`;
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
          <span class="run">${u.dd.row}日目 ${esc(firstDep(u.dd))}→${esc(lastRet(u.dd))}</span></div></div>`).join('') : ''}`);
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
        <div class="pin-block">
          <div class="pin-label">ピンポイント時刻（正確な出勤時刻で1発特定）</div>
          <div class="range-row">
            <input type="time" id="pinTime" step="60" value="${searchState.exact || ''}" aria-label="出勤時刻をピンポイント指定">
            <button class="btn primary small" id="pinGo">この時刻で探す</button>
            ${searchState.exact ? '<button class="btn small" id="pinClear">解除</button>' : ''}
          </div>
          <p class="pin-hint">例：7:06 → 7:06出勤の勤務だけを表示（時刻は輪番表の出勤時刻）</p>
        </div>
        <div class="filter-label sub">時間帯・範囲から探す</div>
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
          <li><span class="pill yobi"><b>チヨ・ヨ・ハヨ</b><i>予備</i></span><b>予備の運転士が入出庫を代行</b>するため、本人は駅で乗降してその分<b>休憩</b>できる</li>
        </ul>
        <p class="sc-note">出勤・退勤場所も同じ基準で表示しています（出庫なら筑紫車両基地発、予備なら筑紫駅発）。</p>
      </div>
      <h4 class="tl-title" style="margin-top:14px">駅・記号</h4>
      <div class="sym-grid">${st.map((c) => `<div class="sym"><span class="pill stn" style="--pc:${CODE_COLOR[c.code]}"><b>${esc(c.code)}</b><i>${esc(c.name)}</i></span></div>`).join('')}</div>
      <h4 class="tl-title" style="margin-top:14px">予備（ヨ）</h4>
      <div class="sym-grid">${yb.map((c) => `<div class="sym"><span class="pill yobi"><b>${esc(c.code)}</b><i>${esc(c.name)}</i></span>${c.note ? `<span class="md">${esc(c.note)}</span>` : ''}</div>`).join('')}</div>
      <div class="sym-list"><div><b>休憩</b>　ヨ（チヨ・ハヨ）の入出庫は予備の運転士が代行するので、本人はその間休憩できます（本人確認済み）。</div></div>
      <h4 class="tl-title" style="margin-top:14px">動作・マーク</h4>
      <div class="sym-list">${mk.map((c) => `<div><b>${esc(c.code)}</b>　${esc(c.name)}${c.note ? ` <span class="md">（${esc(c.note)}）</span>` : ''}</div>`).join('')}</div>
      <h4 class="tl-title" style="margin-top:14px">乗務区間の表示について</h4>
      <div class="sym-list">
        <div><b>乗 / 降</b>　その列車に<b>乗り込む駅</b>と<b>降りる駅</b>。時刻は西鉄公式時刻表の実際の発着時刻です。</div>
        <div><b>基地</b>　車両基地発着（チ出・チ入）の区間。時刻は筑紫駅の発着で、基地内の乗降はその直前・直後です。</div>
        <div><b>予備代行</b>　ヨの入出庫を予備の運転士が代行。本人は駅で乗降し、その分休憩できます。</div>
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

  /* えれサイト4（車号） */
  esLoad();
  renderEsBar();
  esFetch(false);
  loadStops();

  /* 在線位置（西鉄 列車走行位置） */
  posLoad();
  renderPosBar();
  posFetch(false);
  if ($('#posBarMain')) $('#posBarMain').addEventListener('click', () => openPosAlert());
  if ($('#posRefresh')) $('#posRefresh').addEventListener('click', () => posFetch(true));
  if ($('#alertBox')) $('#alertBox').addEventListener('click', () => openPosAlert());
  setInterval(() => {
    if (document.visibilityState === 'visible') { posFetch(false); renderPosBar(); }
  }, 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') posFetch(true);
  });
  if ($('#esBarMain')) $('#esBarMain').addEventListener('click', () => {
    if (ES.status === 'idle') esFetch(true); else openEsDetail();
  });
  if ($('#esRefresh')) $('#esRefresh').addEventListener('click', () => esFetch(true));
  window.addEventListener('resize', () => renderEsBar());

  window.addEventListener('hashchange', () => { if (applyHash()) render(); });
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
})();
