// 속성 레이더 - 세일즈원 실시간 판매현황 > 주문수량관리 표를 감시해 잘 나가는 속성을 알려준다.
(() => {
  const VER = '4.5';
  const CHANGES = '품절임박 기준을 회사 매진 기준(소진율 70% 매진예상 · 80% 매진임박 · 95% 매진)으로 바꿨어요. 단계마다 파랑·노랑·빨강으로 보여주고 단계가 오를 때 알려요. 잔여·소진 예상 시간 기준은 ⚙에서 \'회사+예측\'을 고르면 함께 써요. 알림 기록에 속성·단계·소진율·예상 분을 따로 남겨요.';
  if (window.__attrRadar) {
    // 같은 버전이면 다시 보이기만, 다른 버전이면 이전 것을 끄고 새로 시작
    if (window.__attrRadar.ver === VER) { window.__attrRadar.show(); return; }
    if (window.__attrRadar.destroy) window.__attrRadar.destroy();
    else document.getElementById('attr-radar-host')?.remove();
  }

  // ---------- 설정 ----------
  const CFG_KEY = 'attrRadarCfg';
  // 탭 묶음: 지금 순위 | 챙길 것(배지) | 흐름·정리 | 설정
  const TAB_GROUPS = [[['prod', '상품'], ['color', '컬러'], ['top', '속성']], [['surge', '급상승'], ['sold', '품절임박']], [['graph', '그래프'], ['sum', '요약'], ['log', '알림']], [['set', '⚙']]];
  const DEF = { interval: 5, win: 3, soldPct: 70, soldQty: 10, soldEta: 15, soldMode: '회사', surge: 10, metric: '방송', refreshSel: '', autoRefresh: 0, brand: '', alias: {}, al: { prod: true, color: true, attr: true, surge: true, sold: true, end: true }, quietMode: false, ui: {}, sumOpen: false };
  let cfg = DEF;
  try { cfg = Object.assign({}, DEF, JSON.parse(localStorage.getItem(CFG_KEY) || '{}')); } catch (e) {}
  if (!cfg.v2) { if (cfg.soldQty === 50) cfg.soldQty = 10; cfg.v2 = true; } // 잔여 50개 기준은 재고 적은 속성이 너무 많이 걸려서 10개로
  if (!cfg.v3) { cfg.soldMode = '회사'; cfg.v3 = true; } // v4.5: 기본은 회사 매진 기준
  cfg.al = Object.assign({}, DEF.al, cfg.al); cfg.alias = cfg.alias || {}; cfg.ui = cfg.ui || {};
  const saveCfg = () => { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) {} };

  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  const isNum = s => /^-?[\d,]+(\.\d+)?$/.test(s);
  // 속성명: '컬러,사이즈' / 사이즈만('55','FREE') / 컬러만
  const parseAttr = name => {
    if (name.includes(',')) { const [c, z] = name.split(',').map(norm); return [c, z || '-']; }
    if (/^(\d{2,3}|XXS|XS|S|M|L|XL|XXL|XXXL|F|FREE|ONE ?SIZE)$/i.test(name)) return ['-', name];
    return [name, '-'];
  };
  const toN = s => (isNum(s) ? parseFloat(s.replace(/,/g, '')) : null);
  const fmt = n => Math.round(n).toLocaleString();
  const hhmmss = t => new Date(t).toTimeString().slice(0, 8);

  // 헤더 라벨 → 내부 키
  const LABELS = [['미리', 'pre'], ['방송', 'live'], ['가능', 'avail'], ['기본', 'base'], ['추가', 'add'], ['상품내', 'inProd'], ['PGM', 'inPgm']];
  const DEFAULT_COLS = ['pre', 'live', 'avail', 'base', 'add', 'inProd', 'inPgm'];

  const S = { rows: new Map(), hist: [], lastTop: null, alerted: new Map(), log: [], lastScan: 0, cols: null, tab: cfg.ui.tab || 'top', heatProd: null, prodJd: new Map(), prodSums: null, colJd: new Map(), colSums: null, lastTopCol: new Map(), lastTopProd: null, parked: new Map(), scopeSig: '', quiet: 2, detOpen: new Map() };

  // ---------- 기록 (브라우저 localStorage, 날짜별, 7일 보관) ----------
  // 값이 바뀐 속성만 [시각, 속성번호, 미리, 방송, 가능] 으로 쌓는다.
  const dayKey = (t = Date.now()) => 'attrRadarRec_' + new Date(t - new Date(t).getTimezoneOffset() * 60000).toISOString().slice(0, 10).replace(/-/g, '');
  const REC = { key: dayKey(), keys: [], idx: new Map(), ch: [], log: [], pg: {}, warned: false };
  // 방송(방송일시 시작 시각)별로 그 방송 표에서 본 상품 목록 → 화면·요약은 지금 고른 방송 상품만
  const PGSET = new Map();
  const pgSet = k => { if (!PGSET.has(k)) PGSET.set(k, new Set(REC.pg[k] || [])); return PGSET.get(k); };
  function recLoad() {
    try {
      Object.keys(localStorage).filter(k => k.startsWith('attrRadarRec_')).forEach(k => {
        const d = k.slice(13); if (Date.now() - new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`).getTime() > 7 * 864e5) localStorage.removeItem(k);
      });
      const o = JSON.parse(localStorage.getItem(REC.key) || 'null');
      if (!o) return;
      const recent = o.ch.length && Date.now() - o.ch[o.ch.length - 1][0] < 20 * 60000; // 20분 넘게 끊겼으면 화면 복원은 생략
      REC.keys = o.keys; REC.ch = o.ch; REC.log = o.log || []; REC.pg = o.pg || {};
      REC.keys.forEach((k, i) => REC.idx.set(k, i));
      // 마지막 값으로 표를 복원해 F5 후에도 직전 대비가 이어지게
      if (!recent) return;
      const last = new Map(); REC.ch.forEach(c => last.set(c[1], c));
      last.forEach((c, i) => {
        const k = REC.keys[i], [prod, name] = k.split('|'), [color, size] = parseAttr(name);
        S.rows.set(k, { key: k, prod, color, size: size || '-', pre: c[2], live: c[3], avail: c[4], jd: 0, jdAt: 0, seenAt: c[0] });
      });
      S.log = REC.log.slice(0, 100);
    } catch (e) {}
  }
  let recTimer;
  function recSave() {
    clearTimeout(recTimer);
    recTimer = setTimeout(() => {
      try { localStorage.setItem(REC.key, JSON.stringify({ keys: REC.keys, ch: REC.ch, log: REC.log, pg: REC.pg })); }
      catch (e) { if (!REC.warned) { REC.warned = true; toast('기록 저장 공간 부족', '⚙ 탭에서 기록 CSV를 내려받고 기록 초기화를 눌러주세요.'); } }
    }, 500);
  }
  function recRow(r) {
    if (dayKey() !== REC.key) { REC.key = dayKey(); REC.keys = []; REC.idx.clear(); REC.ch = []; REC.log = []; REC.pg = {}; PGSET.clear(); }
    let i = REC.idx.get(r.key);
    if (i === undefined) { i = REC.keys.push(r.key) - 1; REC.idx.set(r.key, i); }
    REC.ch.push([Date.now(), i, r.pre || 0, r.live || 0, r.avail || 0]);
  }

  // ---------- 표 읽기 ----------
  function cellsOf(el) {
    let cells = el.tagName === 'TR' ? [...el.cells] : [...el.querySelectorAll(':scope > [role=gridcell], :scope > [role=cell], :scope > [role=columnheader]')];
    if (!cells.length) cells = [...el.children];
    return cells.map(c => norm(c.innerText));
  }

  function detectHeader(rowsEls) {
    for (const [i, el] of rowsEls.entries()) {
      const cs = cellsOf(el).map(c => c.replace(/\s/g, ''));
      if (cs.some(c => c.includes('미리')) && cs.some(c => c.includes('방송') && c.includes('주문'))) {
        const nameIdx = cs.findIndex(c => c.includes('속성') || c.includes('상품명'));
        const cols = [];
        cs.slice(nameIdx + 1).forEach(c => {
          if (c.includes('주문') && c.includes('가능')) return cols.push('avail');
          const hit = LABELS.find(([lab]) => c.includes(lab));
          cols.push(hit ? hit[1] : null);
        });
        if (cols.includes('live')) return { cols, idx: i };
      }
    }
    return null;
  }

  // ---------- 브랜드 (패션사업부문 브랜드 목록) ----------
  // 상품명 맨 앞을 브랜드명과 맞춤: 띄어쓰기·대소문자 무시, 앞의 남)/여) 같은 표시와 'L시슬리'의 L 같은 한 글자 영문은 떼고 봄, 긴 이름부터
  const BRANDS = '세라|스튜디오디페|SJ와니|지프|조아하다|쏘내추럴|스케쳐스|코어 어센틱|펠틱스|라삐아프|모르간|제이슨우|브리엘|울시|샤론느|정말편한속옷|클로리에|유아굿|분트로이|브루마스|쏘울|사토리산|엔니튜드|르네크루|노스페이스|FILA|비버리힐스 폴로클럽|UBGS|게스|폴햄|아뜰리에마졸리|바스키아|아보크|베네통 언더웨어|시슬리|조이너스|Vera Wang|헉슬리|스테파넬|아쿠아리모네|라페어|맥케이슨|아디다스|코데즈컴바인이너웨어|슈디|베네통|플레이텍스|막스스튜디오|로우앤|American Tourister|DOTTI|아쿠아스큐텀|김서룡|르까프|원더브라|보디가드|LACOSTE|RCBPC|라플리|앤앤에프|원더레그|에이씨피|텐업|로보|컬럼비아|피플오브더월드|레드캠프|스튜디오제타|GODBODY|캘빈클라인스포츠|TBJ|밀레골프|제메이스|슈올즈|프리모션 by 비비안|코몽트|트래커|아크메|내셔널지오그래픽|TATE|피트인|서포트라이트|비오비|에스까다스포츠|트라이|까스텔바작|프로젝트엠|프렌치쿼터|데일리블루|메트로시티|keds|푸마골프|슬림라이너|가이거|푸마|크로커다일|오모떼|에이에스98|바로인|PANAM|질커티스|잭니클라우스|루시헨느|포머티브|셈플리체|비버리힐즈 폴로클럽 키즈|스누즈버튼|진짜편한속옷|루이까또즈|빌트모아|버버리|키플링|올리|한국금거래소|코튼클럽|엘르|빈트릴|험머|세르즈블랑코|슈리오|인코드|헬시온|마리본|애시워스|비비안|샤빌|월드컵|린|트라이엄프|보테가베네타|BBC by 비비안|쿠모프리24|헌터|드루|마나슬루|에스컨트롤|캘빈클라인퍼포먼스|오렐리안|슈에프엠|노이즈|쥬시꾸뛰르|벤시몽|언비튼|라스튜디오|스마트하다'.split('|');
  // 상품명에 다르게 쓰는 이름 → 목록 브랜드
  const ALIAS = { 'SJ WANI': 'SJ와니', 'SJWANI': 'SJ와니', '손정완': 'SJ와니', '디페': '스튜디오디페', 'MORGAN': '모르간', '에스카다': '에스까다스포츠', 'ESCADA': '에스까다스포츠', '코어': '코어 어센틱', '코데즈컴바인': '코데즈컴바인이너웨어', 'JEEP': '지프', 'SKECHERS': '스케쳐스', 'JASON WU': '제이슨우', 'THE NORTH FACE': '노스페이스', 'NORTH FACE': '노스페이스', 'GUESS': '게스', 'BENETTON': '베네통', 'SISLEY': '시슬리', 'STEFANEL': '스테파넬', 'AQUASCUTUM': '아쿠아스큐텀', 'CASTELBAJAC': '까스텔바작', 'METROCITY': '메트로시티', 'LOUIS QUATORZE': '루이까또즈', 'ELLE': '엘르', '캘빈클라인': '캘빈클라인스포츠', 'CALVIN KLEIN': '캘빈클라인스포츠' };
  const bkey = t => String(t).replace(/\s+/g, '').toUpperCase();
  let BTAB = null;
  const brandTable = () => {
    if (BTAB) return BTAB;
    const m = BRANDS.map(b => [bkey(b), b]).concat(Object.entries(ALIAS).map(([a, b]) => [bkey(a), b])).concat(Object.entries(cfg.alias).map(([a, b]) => [bkey(a), b]));
    return (BTAB = m.filter(x => x[0]).sort((a, b) => b[0].length - a[0].length));
  };
  const bStrip = p => String(p).replace(/\s*\(\d+\)$/, '').trim().replace(/^(남|여|공용|남녀|아동|키즈|유아)\)\s*/, '').replace(/^[A-Z](?=[가-힣])/, '');
  const BCACHE = new Map();
  function brandOf(p) {
    if (BCACHE.has(p)) return BCACHE.get(p);
    const q = bStrip(p), k = bkey(q), hit = brandTable().find(([n]) => k.startsWith(n));
    // 목록에 없으면 첫 단어로 따로 묶음 (✱ 표시)
    const b = hit ? hit[1] : '✱' + (q.split(/\s+/)[0] || q);
    BCACHE.set(p, b); return b;
  }
  const inBrand = p => !cfg.brand || brandOf(p) === cfg.brand;
  const inPgm = p => !S.pgmCur || pgSet(S.pgmCur).has(p);
  const inScope = p => inPgm(p) && inBrand(p);
  const bName = b => (b[0] === '✱' ? b.slice(1) + ' (목록에 없음)' : b);

  // 상품을 접으면 속성 줄이 숨겨지거나 화면에서 빠짐 → 숨겨진 줄도 같은 표 안이면 읽고, 빠졌으면 상품 합계로 추적
  // 글꼴: Pretendard (PC에 없으면 CDN에서, 막혀 있으면 맑은 고딕)
  if (!document.getElementById('attr-radar-font')) { const l = document.createElement('link'); l.id = 'attr-radar-font'; l.rel = 'stylesheet'; l.href = 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css'; document.head.appendChild(l); }
  const AGG = '(접힘)';
  const isAgg = r => r.color === AGG;
  const live = r => !isAgg(r) && !r.stale; // 속성 단위 화면(TOP·급상승·품절임박·히트맵)에 쓰는 줄
  const outerTable = el => { let t = el.closest('table'), o = t; while (t) { o = t; t = t.parentElement && t.parentElement.closest('table'); } return o; };
  // ---------- 예상전환율 (방송실적관리 표: 예상취급액 / 총주문액) ----------
  // 총주문 중 취소·반품을 빼고 남을 비율. 상품명으로 저장해 두고 요약에서 예상취급수량 계산에 씀
  const CONV_KEY = 'attrRadarConv';
  let CONV = {};
  try { CONV = JSON.parse(localStorage.getItem(CONV_KEY) || '{}'); } catch (e) {}
  function readConv() {
    const els = [...document.querySelectorAll('tr, [role=row]')].filter(el => !el.closest('#attr-radar-host') && el.getClientRects().length > 0);
    const hi = els.findIndex(el => { const t = cellsOf(el); return t.includes('총주문액') && t.includes('예상취급액'); });
    if (hi < 0) return;
    // 머리줄에서 두 칸 뒤에 몇 칸이 더 있는지 → 상품 줄 끝에서부터 같은 위치 (앞쪽 칸은 묶음 머리라 개수가 다름)
    const ht = cellsOf(els[hi]), aT = ht.length - 1 - ht.indexOf('총주문액'), aE = ht.length - 1 - ht.indexOf('예상취급액'), aX = ht.indexOf('노출분') >= 0 ? ht.length - 1 - ht.indexOf('노출분') : -1;
    let dirty = false;
    // 노출분이 같은 상품끼리 = 같은 주방송 묶음(구간). 순서대로, 노출분 0:00(시너지·미리주문 코드)은 건너뜀
    const groups = [];
    const tail = els.slice(hi + 1, hi + 400), endI = tail.findIndex(el => /^합계/.test(cellsOf(el).find(v => v) || ''));
    (endI < 0 ? tail : tail.slice(0, endI)).forEach(el => {
      const c = cellsOf(el), ci = c.findIndex(v => /^\d{10}$/.test(v));
      if (ci < 0) return;
      const name = c.slice(ci + 1).find(v => v && !isNum(v)), tot = toN(c[c.length - 1 - aT] || ''), exp = toN(c[c.length - 1 - aE] || '');
      const xm = aX >= 0 && /^(\d+):(\d{2})$/.exec(c[c.length - 1 - aX] || '');
      if (name && xm && (+xm[1] || +xm[2])) { const g = groups[groups.length - 1], key = xm[0]; if (g && g.key === key) g.names.push(norm(name)); else groups.push({ key, dur: +xm[1] + xm[2] / 60, names: [norm(name)] }); }
      if (!name || !tot || exp === null) return;
      const r = exp / tot;
      if (r < 0.05 || r > 1.2) return;
      if (!CONV[name] || Math.abs(CONV[name].r - r) > 0.0005) { CONV[name] = { r, code: c[ci], t: Date.now() }; dirty = true; }
    });
    if (dirty) { const old = Date.now() - 30 * 86400000; Object.keys(CONV).forEach(k => { if (CONV[k].t < old) delete CONV[k]; }); try { localStorage.setItem(CONV_KEY, JSON.stringify(CONV)); } catch (e) {} }
    const bw = broadcastWindow();
    if (bw && groups.length) {
      const sum = groups.reduce((a, g) => a + g.dur, 0), len = (bw.en - bw.st) / 60000;
      if (sum <= len + 5) { // 노출분 합이 방송 길이보다 길면 다른 방송 표 → 안 씀
        const v = JSON.stringify(groups.map(g => ({ dur: g.dur, names: g.names })));
        // 프로그램순(전체)으로 읽은 게 있으면 주방송상품별(일부)로 덮어쓰지 않음
        const old = tableSegs(bw), isFull = gs => gs.reduce((a, g) => a + g.dur, 0) >= len * 0.85;
        if (old && isFull(old) && !isFull(groups)) return;
        if (TSEG[bw.st] !== v) { TSEG[bw.st] = v; const old = Date.now() - 8 * 864e5; Object.keys(TSEG).forEach(k => { if (+k < old) delete TSEG[k]; }); try { localStorage.setItem('attrRadarSegs', JSON.stringify(TSEG)); } catch (e) {} }
      }
    }
  }
  let TSEG = {};
  try { TSEG = JSON.parse(localStorage.getItem('attrRadarSegs') || '{}'); } catch (e) {}
  const tableSegs = bw => { try { return bw && TSEG[bw.st] ? JSON.parse(TSEG[bw.st]) : null; } catch (e) { return null; } };
  function resetLive() { S.quiet = 2; S.lastTop = null; S.lastTopProd = null; S.prodSums = null; S.colSums = null; S.lastTopCol = new Map(); S.hist = []; S.jump = null; }
  function scan() {
    try { readConv(); } catch (e) {}
    const bwNow = broadcastWindow();
    S.pgmCur = bwNow ? String(bwNow.st) : '';
    const allEls = [...document.querySelectorAll('tr, [role=row]')].filter(el => !el.closest('#attr-radar-host'));
    const isVis = el => el.getClientRects().length > 0;
    // 세일즈원 다른 탭을 열면 이전 탭 화면이 숨겨진 채 남아 있음 → 머리줄은 보이는 것 기준
    const visEls = allEls.filter(isVis);
    let hd = detectHeader(visEls), els = allEls, visMode = !!hd;
    if (hd) hd = { cols: hd.cols, idx: allEls.indexOf(visEls[hd.idx]) }; else hd = detectHeader(allEls);
    S.cols = (hd && hd.cols) || S.cols || DEFAULT_COLS;
    // 주문수량관리 헤더 아래 줄만 읽고, 다음 표 머리줄(숫자 없는 글자 칸 3개 이상)이 나오면 멈춤
    if (hd) {
      const after = allEls.slice(hd.idx + 1), end = after.findIndex(el => {
        if (visMode && !isVis(el)) return false;
        const cs = cellsOf(el).filter(c => c);
        return cs.length >= 3 && !cs.some(c => isNum(c) || c === '-');
      });
      els = end < 0 ? after : after.slice(0, end);
    }
    const ipIdx = S.cols.indexOf('inProd');
    let cur = null, found = 0, lastProdTbl = null, curInfo = null;
    const seen = new Set(), changed = [], prodSeen = new Map(), prodInfo = [];
    let recDirty = false;
    const addRow = (prod, name, v) => {
      const [color, size] = parseAttr(name);
      const key = prod + '|' + name;
      seen.add(key); found++;
      const parked = !S.rows.has(key) && S.parked.get(key);
      const prev = S.rows.get(key), row = { key, prod, color, size: size || '-', ...v, seenAt: Date.now() };
      // 직전 대비: 값이 바뀐 순간의 증가분을 다음 변경 때까지 유지
      row.jd = prev ? prev.jd : 0; row.jdAt = prev ? prev.jdAt : 0;
      if (prev && !prev.stale && metric(row) !== metric(prev)) { row.jd = metric(row) - metric(prev); row.jdAt = Date.now(); changed.push(row); }
      if (prev && prev.stale) row.jd = 0;
      if ((!prev && !parked) || (prev && (row.pre !== prev.pre || row.live !== prev.live || row.avail !== prev.avail))) { recRow(row); recDirty = true; }
      if (parked) { row.jd = 0; }
      if (!prev && parked && (row.pre !== parked.pre || row.live !== parked.live || row.avail !== parked.avail)) recRow(row);
      if (!prev && parked) S.parked.delete(key);
      S.rows.set(key, row);
    };
    for (const el of els) {
      const vis = !visMode || isVis(el);
      // 숨겨진 줄은 바로 앞 상품과 같은 표 안에 있을 때만(=접힌 속성) 읽음
      if (!vis && !(lastProdTbl && lastProdTbl.contains(el))) continue;
      const cs = cellsOf(el);
      // 이름 칸 = 첫 번째로 비어 있지 않은 칸 (사이즈만 있는 속성 '55' 같은 숫자 이름 허용)
      const ni = cs.findIndex(c => c && c !== '-');
      if (ni < 0) continue;
      const name = cs[ni].replace(/^[\^∧︿⌃▲▼v>]\s*/, '');
      const rest = cs.slice(ni + 1);
      const numeric = rest.filter(c => isNum(c) || c === '-').length;
      if (rest.length < 4 || numeric < 4 || toN(rest[S.cols.indexOf('live')]) === null) continue;
      if (/^합계/.test(name)) continue;
      // 상품코드(숫자 9자리 이상)가 이름 칸에 온 줄은 다른 표 → 건너뜀
      if (/^\d{9,}/.test(name)) continue;
      const v = {};
      S.cols.forEach((k, i) => { if (k) v[k] = toN(rest[i]) ?? 0; });
      if (Object.values(v).some(x => Math.abs(x) > 5e7)) continue;
      // 상품 행 판정: 상품내비중이 '-' (속성 행은 숫자). 비중 칸을 못 찾으면 쉼표 없는 이름
      const isProd = ipIdx >= 0 && rest[ipIdx] !== undefined ? rest[ipIdx] === '-' : !name.includes(',');
      if (isProd) {
        // 같은 이름의 상품이 또 나오면 (2), (3)을 붙여 따로 집계
        const n = (prodSeen.get(name) || 0) + 1; prodSeen.set(name, n);
        cur = n > 1 ? `${name} (${n})` : name;
        curInfo = { prod: cur, v, n: 0 }; prodInfo.push(curInfo);
        if (vis) lastProdTbl = outerTable(el);
        continue;
      }
      let prod = cur || '(상품 미확인)';
      if (seen.has(prod + '|' + name)) {
        // 같은 상품에 같은 속성이 또 나오면 상품 행을 놓친 것 → 다음 상품으로 분리
        const n = (prodSeen.get(prod) || 1) + 1; prodSeen.set(prod, n);
        cur = prod = `${prod.replace(/ \(\d+\)$/, '')} (${n})`;
        if (seen.has(prod + '|' + name)) continue;
      }
      if (curInfo) curInfo.n++;
      addRow(prod, name, v);
    }
    // 속성 줄이 하나도 없는 상품(접혀서 화면에서 빠짐): 마지막으로 본 속성 값은 고정해 두고, 그 뒤 늘어난 만큼을 '(접힘)' 줄로 추적
    prodInfo.forEach(pi => {
      const aggKey = pi.prod + '|' + AGG;
      if (pi.n > 0) {
        const a = S.rows.get(aggKey) || S.parked.get(aggKey);
        if (a && (a.pre || a.live || a.avail)) { recRow({ key: aggKey, pre: 0, live: 0, avail: 0 }); recDirty = true; }
        S.rows.delete(aggKey); S.parked.delete(aggKey);
        return;
      }
      const olds = [...S.rows.values(), ...S.parked.values()].filter(r => r.prod === pi.prod && !isAgg(r));
      olds.forEach(r => { S.parked.delete(r.key); S.rows.set(r.key, { ...r, stale: true, jd: 0 }); seen.add(r.key); });
      const sub = k => olds.reduce((a, r) => a + (r[k] || 0), 0);
      addRow(pi.prod, AGG, { ...pi.v, pre: (pi.v.pre || 0) - sub('pre'), live: (pi.v.live || 0) - sub('live'), avail: (pi.v.avail || 0) - sub('avail') });
    });
    // 레이더 대상 = 지금 화면 표에 있는 속성만. 빠진 속성은 보관했다가 다시 나타나면 이어서 계산
    if (found) {
      [...S.rows.keys()].forEach(k => { if (!seen.has(k)) { S.parked.set(k, S.rows.get(k)); S.rows.delete(k); } });
      const sig = [...new Set([...S.rows.values()].map(r => r.prod))].sort().join('|');
      if (S.scopeSig && S.scopeSig !== sig) { resetLive(); changed.length = 0; }
      S.scopeSig = sig;
      // 방송 연결: 방송일시를 바꾼 직후 화면에 남아 있던 다른 방송 상품은 넣지 않음
      // (다른 방송에 이미 있는 상품은 방송일시를 바꾼 뒤 새로 나타났을 때만 이 방송에도 넣음)
      const k = S.pgmCur, now = [...new Set([...S.rows.values()].map(r => r.prod))];
      if (k !== S.pgmAt) { if (S.pgmAt !== undefined) { resetLive(); changed.length = 0; } S.pgmAt = k; S.pgmBase = new Set(now); }
      if (k) {
        let add = false;
        now.forEach(p => {
          if (pgSet(k).has(p)) return;
          const elsewhere = Object.keys(REC.pg).some(o => o !== k && REC.pg[o].includes(p));
          if (!elsewhere || !S.pgmBase.has(p)) { (REC.pg[k] = REC.pg[k] || []).push(p); pgSet(k).add(p); add = true; }
        });
        if (add) { recDirty = true; S.frt = null; }
      }
    }
    S.lastScan = Date.now();
    S.lastFound = found;
    if (recDirty) recSave();
    if (changed.length) {
      changed.sort((a, b) => b.jd - a.jd);
      S.jump = { t: Date.now(), total: changed.reduce((s, r) => s + r.jd, 0), list: changed };
    }
    if (found) { snapshot(); if (S.quiet > 0) S.quiet--; }
    checkEnd();
  }

  // ---------- 회사 매진 기준 (생판종 주문수량관리: 주문가능(기본+추가) 소진율) ----------
  // 소진율 = (미리+방송 주문) / (미리+방송 주문 + 주문가능)
  const LV = [null, { n: 1, min: 70, name: '매진예상', icon: '🔵', cls: 'lv1' }, { n: 2, min: 80, name: '매진임박', icon: '🟡', cls: 'lv2' }, { n: 3, min: 95, name: '매진', icon: '🔴', cls: 'lv3' }];
  const lvOf = pct => (pct >= 95 ? 3 : pct >= 80 ? 2 : pct >= 70 ? 1 : 0);
  const usePred = () => cfg.soldMode === '회사+예측';
  const metric = r => (cfg.metric === '총' ? (r.pre || 0) + (r.live || 0) : (r.live || 0));

  function snapshot() {
    const now = Date.now();
    const vals = {};
    S.rows.forEach((r, k) => { vals[k] = { m: metric(r), avail: r.avail }; });
    S.hist.push({ t: now, vals });
    while (S.hist.length && now - S.hist[0].t > 65 * 60000) S.hist.shift();
    analyze();
  }

  // ---------- 분석 ----------
  function deltas() {
    const now = Date.now(), from = now - cfg.win * 60000;
    if (S.hist.length < 2) return { list: [], mins: 0 };
    let base = S.hist[0];
    for (const h of S.hist) { if (h.t <= from) base = h; else break; }
    const mins = Math.max((now - base.t) / 60000, 0.1);
    const list = [];
    S.rows.forEach((r, k) => {
      const old = base.vals[k];
      if (!old) return;
      const d = metric(r) - old.m;
      if (d > 0) list.push({ r, d, rate: d / mins });
    });
    list.sort((a, b) => b.d - a.d);
    return { list, mins };
  }

  function products() {
    const m = new Map();
    S.rows.forEach(r => { if (!inScope(r.prod)) return; if (!m.has(r.prod)) m.set(r.prod, []); m.get(r.prod).push(r); });
    return [...m.entries()].map(([p, rs]) => ({ p, rs, sum: rs.reduce((s, r) => s + metric(r), 0) })).sort((a, b) => b.sum - a.sum);
  }

  function soldOut(rateMap, mins) {
    const out = [];
    S.rows.forEach(r => {
      if (!live(r) || !inScope(r.prod)) return;
      const tot = (r.pre || 0) + (r.live || 0), avail = r.avail || 0;
      const pct = tot + avail > 0 ? tot / (tot + avail) * 100 : 0;
      const rate = rateMap.get(r.key) || 0;
      const eta = rate > 0 && mins >= 1 ? avail / rate : null; // 1분 이상 쌓인 뒤에만 소진 예상
      if (tot <= 0) return;
      const lv = avail > 0 ? lvOf(pct) : 3;
      const why = usePred() ? [avail <= cfg.soldQty && 'qty', eta !== null && eta <= cfg.soldEta && 'eta'].filter(Boolean) : [];
      if (lv || why.length) out.push({ r, pct, avail, eta, lv, why });
    });
    return out.sort((a, b) => b.lv - a.lv || (a.eta ?? 1e9) - (b.eta ?? 1e9) || a.avail - b.avail);
  }

  function analyze() {
    const D0 = deltas(), D = { ...D0, list: D0.list.filter(x => inScope(x.r.prod)) };
    const rateMap = new Map(D.list.map(x => [x.r.key, x.rate]));
    const P = products();
    const all = [...S.rows.values()].filter(r => live(r) && inScope(r.prod)).sort((a, b) => metric(b) - metric(a));
    const top = all[0];
    const SO = soldOut(rateMap, D.mins);
    // 상품 단위: 직전 대비(합계가 바뀐 순간의 증가분), 최근 구간 증가, 잔여
    const dByKey = new Map(D.list.map(x => [x.r.key, x.d]));
    P.forEach(x => {
      x.win = x.rs.reduce((a, r) => a + (dByKey.get(r.key) || 0), 0);
      x.rate = x.rs.reduce((a, r) => a + (rateMap.get(r.key) || 0), 0);
      x.avail = x.rs.reduce((a, r) => a + (r.avail || 0), 0);
      const tot = x.rs.reduce((a, r) => a + (r.pre || 0) + (r.live || 0), 0);
      x.pct = tot + x.avail > 0 ? tot / (tot + x.avail) * 100 : 0;
      const o = S.prodSums && S.prodSums.get(x.p);
      if (o !== undefined && o !== null && o !== x.sum) S.prodJd.set(x.p, x.sum - o);
      x.jd = S.prodJd.get(x.p) || 0;
    });
    S.prodSums = new Map(P.map(x => [x.p, x.sum]));
    // 컬러 단위: 상품 안에서 컬러별 합계 (컬러 속성이 없는 상품은 제외)
    const cs = new Map();
    P.forEach(x => {
      const m = new Map();
      x.rs.filter(r => live(r) && r.color && r.color !== '-').forEach(r => {
        if (!m.has(r.color)) m.set(r.color, { c: r.color, sum: 0, win: 0, rate: 0, avail: 0, tot: 0 });
        const o = m.get(r.color); o.sum += metric(r); o.win += dByKey.get(r.key) || 0; o.rate += rateMap.get(r.key) || 0; o.avail += r.avail || 0; o.tot += (r.pre || 0) + (r.live || 0);
      });
      x.colors = [...m.values()].sort((a, b) => b.sum - a.sum);
      x.colors.forEach(o => {
        const k = x.p + '|' + o.c, old = S.colSums && S.colSums.get(k);
        if (old !== undefined && old !== null && old !== o.sum) S.colJd.set(k, o.sum - old);
        o.jd = S.colJd.get(k) || 0; o.pct = o.tot + o.avail > 0 ? o.tot / (o.tot + o.avail) * 100 : 0;
        cs.set(k, o.sum);
      });
      // 상품 안 컬러 1위가 바뀌면 알림
      const c0 = x.colors[0];
      if (x.colors.length > 1 && c0.sum > 0) {
        const prev = S.lastTopCol.get(x.p);
        if (prev && prev !== c0.c) alert('🎨 컬러 1위 교체', `${shortP(x.p)} ${c0.c} (${fmt(c0.sum)})`, 'color', x.p);
        S.lastTopCol.set(x.p, c0.c);
      }
    });
    S.colSums = cs;
    S.view = { D, P, top, SO, rateMap };
    if (P.length > 1 && P[0].sum > 0) {
      if (S.lastTopProd && S.lastTopProd !== P[0].p) alert('🏆 상품 1위 교체', `${shortP(P[0].p)} (${fmt(P[0].sum)})`, 'prod', P[0].p);
      S.lastTopProd = P[0].p;
    }

    // 알림
    if (top && metric(top) > 0) {
      if (S.lastTop && S.lastTop !== top.key) alert('🥇 1위 교체', `${short(top)} (${fmt(metric(top))})`, 'attr', top.prod);
      S.lastTop = top.key;
    }
    // 단계가 오를 때마다 한 번씩 (같은 단계는 다시 안 울림). 예측 기준은 회사 단계가 없을 때만 30분에 한 번
    SO.forEach(x => {
      const info = { k: x.r.key, pct: Math.round(x.pct), eta: x.eta !== null ? Math.ceil(x.eta) : null, avail: x.avail };
      const msg = `${short(x.r)} 소진율 ${Math.round(x.pct)}% · 잔여 ${fmt(x.avail)}${x.eta !== null ? ` · 약 ${Math.ceil(x.eta)}분` : ''}`;
      if (x.lv) once('so:' + x.r.key + ':' + x.lv, 24 * 60, `${LV[x.lv].icon} ${LV[x.lv].name}`, msg, 'sold', x.r.prod, { ...info, lv: x.lv, why: 'pct' });
      else once('so:' + x.r.key + ':p', 30, '⏱ 소진 예측', msg, 'sold', x.r.prod, { ...info, lv: 0, why: x.why.join('+') });
    });
    const s = D.list.find(x => live(x.r));
    if (s && s.d >= cfg.surge) once('su:' + s.r.key, cfg.win, '🔥 급상승', `${short(s.r)} +${fmt(s.d)} / ${Math.max(1, Math.round(D.mins))}분`, 'surge', s.r.prod);
    render();
  }

  const shortP = p => p.replace(/^SJ\s*WANI\s*/i, '');
  const attrL = r => [r.color, r.size].filter(x => x && x !== '-').join(' ');
  const short = r => `${shortP(r.prod)} ${attrL(r)}`;

  function once(id, mins, title, msg, type, p, x) {
    const last = S.alerted.get(id);
    if (last && Date.now() - last < mins * 60000) return;
    S.alerted.set(id, Date.now());
    alert(title, msg, type, p, x);
  }

  function alert(title, msg, type, p, x) {
    const e = { t: Date.now(), title, msg, p, ...(x || {}), q: S.quiet > 0 ? 1 : 0 }; // q=1: 켠 직후(이미 그런 상태)
    S.log.unshift(e);
    REC.log.unshift(e); recSave();
    S.log.length = Math.min(S.log.length, 100);
    // 켠 직후·상품이 바뀐 직후 2번의 확인은 '이미 그런 상태'라 알림 탭에만 남기고 팝업은 생략
    if (S.quiet > 0) return;
    popup(title, msg, type);
  }
  // 팝업: 조용히 모드이거나 그 종류를 꺼 두면 알림 탭에만 남김
  const popup = (title, msg, type) => { if (!cfg.quietMode && (!type || cfg.al[type] !== false)) toast(title, msg); };

  function cssPath(el) {
    const parts = [];
    while (el && el.nodeType === 1 && el !== document.body) {
      let p = el.tagName.toLowerCase();
      if (el.id) { parts.unshift(p + '#' + CSS.escape(el.id)); break; }
      const sib = [...el.parentNode.children].filter(c => c.tagName === el.tagName);
      if (sib.length > 1) p += `:nth-of-type(${sib.indexOf(el) + 1})`;
      parts.unshift(p); el = el.parentElement;
    }
    return parts.join(' > ');
  }
  const DANGER = /저장|등록|삭제|수정|적용|확인|전송|승인|결재|반영|변경|취소|save|submit|delete/i;
  const btnText = el => norm((el.closest('button,a,[role=button]') || el).innerText || el.getAttribute('title') || el.getAttribute('aria-label') || '');
  function pickRefresh() {
    toast('새로고침 버튼 지정', '세일즈원 화면의 새로고침(⟳) 버튼을 한 번 클릭하세요.');
    const h = e => {
      if (e.target.closest('#attr-radar-host')) return;
      document.removeEventListener('click', h, true);
      const t = e.target.closest('button,a,[role=button],i,svg,span') || e.target;
      if (DANGER.test(btnText(t))) { toast('지정 안 함', '저장·등록 같은 버튼은 새로고침 버튼으로 지정할 수 없어요.'); return; }
      cfg.refreshSel = cssPath(t); cfg.refreshHash = location.hash.split('?')[0]; cfg.refreshText = btnText(t);
      saveCfg(); toast('지정 완료', '자동 새로고침 간격을 설정에서 켜세요.'); render();
    };
    document.addEventListener('click', h, true);
  }
  let refreshTimer;
  function setupRefresh() {
    clearInterval(refreshTimer);
    if (cfg.autoRefresh > 0 && cfg.refreshSel) refreshTimer = setInterval(() => {
      // 안전장치: 지정했던 화면(주소)에서만, 지정 때와 같은 글자의 버튼만, 저장·등록류 버튼은 절대 클릭 안 함
      if (!cfg.refreshHash || location.hash.split('?')[0] !== cfg.refreshHash) return;
      const b = document.querySelector(cfg.refreshSel);
      if (!b || b.getClientRects().length === 0) return;
      const tx = btnText(b);
      if (DANGER.test(tx) || tx !== (cfg.refreshText || '')) return;
      b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }, cfg.autoRefresh * 1000);
  }

  // ---------- 진단 / 내보내기 ----------
  function diag() {
    const box = [...document.querySelectorAll('*')].find(e => e.children.length < 50 && /주문수량관리/.test(e.textContent || '') && (e.textContent || '').includes('방송'));
    let panel = box; while (panel && panel.parentElement && !/(미리|속성)/.test(panel.innerText || '')) panel = panel.parentElement;
    const info = {
      url: location.href, tr: document.querySelectorAll('tr').length, roleRow: document.querySelectorAll('[role=row]').length,
      canvas: document.querySelectorAll('canvas').length, cols: S.cols, found: S.lastFound,
      prods: [...new Set([...S.rows.values()].map(r => r.prod))],
      rows: [...document.querySelectorAll('tr, [role=row]')].filter(el => !el.closest('#attr-radar-host')).slice(0, 150).map(el => cellsOf(el).join(' | ')),
      html: (panel ? panel.outerHTML : document.body.outerHTML).replace(/\s+/g, ' ').slice(0, 8000),
    };
    const txt = JSON.stringify(info);
    navigator.clipboard?.writeText(txt).then(() => toast('진단 정보 복사됨', 'Claude 대화창에 붙여넣어 주세요.'), () => prompt('아래 내용을 복사해 Claude에게 보내주세요', txt));
  }
  function download(name, lines) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv' }));
    a.download = name; a.style.display = 'none'; document.body.appendChild(a); a.click(); setTimeout(() => { a.remove(); URL.revokeObjectURL(a.href); }, 1000);
  }
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const stamp = () => new Date().toTimeString().slice(0, 5).replace(':', '');
  // ---------- 여러 날짜 기록 합치기 ----------
  const ymd = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  function allRecords(fromT = 0, toT = Infinity) {
    const days = [];
    try { Object.keys(localStorage).filter(k => k.startsWith('attrRadarRec_') && k !== REC.key).forEach(k => { const o = JSON.parse(localStorage.getItem(k) || 'null'); if (o) days.push(o); }); } catch (e) {}
    days.push({ keys: REC.keys, ch: REC.ch, log: REC.log });
    const rows = [], logs = [];
    days.forEach(o => {
      o.ch.forEach(([t, i, pre, live, avail]) => { if (t >= fromT && t <= toT) rows.push({ t, key: o.keys[i], pre, live, avail }); });
      (o.log || []).forEach(l => { if (l.t >= fromT && l.t <= toT) logs.push(l); });
    });
    rows.sort((a, b) => a.t - b.t); logs.sort((a, b) => a.t - b.t);
    return { rows, logs };
  }
  // 이번 방송 범위: 방송일시 시작 30분 전 ~ 종료 60분 후 (늦은 주문 포함). 못 읽으면 오늘 전체
  function broadcastRange() {
    const bw = broadcastWindow();
    if (bw) return { from: bw.st - 30 * 60000, to: bw.en + 60 * 60000, bw, tag: `${ymd(bw.st).replace(/-/g, '')}_${bw.label.slice(0, 5).replace(':', '')}` };
    const d = new Date(); d.setHours(0, 0, 0, 0);
    return { from: d.getTime(), to: Infinity, bw: null, tag: ymd(Date.now()).replace(/-/g, '') };
  }
  function historyLines(rows) {
    const prevLive = new Map();
    const lines = [['날짜', '시각', '상품', '컬러', '사이즈', '미리주문', '방송주문', '주문가능', '직전대비 방송주문 증가'].join(',')];
    rows.forEach(r => {
      const [prod, name] = r.key.split('|'), [color, size] = parseAttr(name);
      const d = prevLive.has(r.key) ? r.live - prevLive.get(r.key) : ''; prevLive.set(r.key, r.live);
      lines.push([ymd(r.t), hhmmss(r.t), prod, color, size, r.pre, r.live, r.avail, d].map(q).join(','));
    });
    return lines;
  }
  const logLines = logs => [['날짜', '시각', '알림', '내용', '속성키', '단계', '소진율', '잔여', '예상분', '발동', '켠직후'].join(',')].concat(logs.map(l => [ymd(l.t), hhmmss(l.t), l.title, l.msg, l.k, l.lv, l.pct, l.avail, l.eta, l.why, l.q].map(q).join(',')));
  function exportHistory(all) {
    const R = broadcastRange(), { rows } = all ? allRecords() : allRecords(R.from, R.to);
    if (!rows.length) return toast('기록 없음', all ? '저장된 기록이 없어요.' : '이번 방송 시간대 기록이 없어요.');
    download(`속성레이더_기록_${all ? '최근7일' : R.tag}.csv`, historyLines(rows));
  }
  function exportLog(all) {
    const R = broadcastRange(), { logs } = all ? allRecords() : allRecords(R.from, R.to);
    if (!logs.length) return toast('알림 기록 없음', '해당 기간 알림이 없어요.');
    download(`속성레이더_알림_${all ? '최근7일' : R.tag}.csv`, logLines(logs));
  }

  // ---------- 방송 요약 (팀 리뷰용) ----------
  // 준비수량 = 처음 본 시점의 미리+방송+주문가능 (방송 중 수량이 늘면 그만큼 더함)
  // 소진률 = (준비수량 - 마지막 주문가능) / 준비수량, 공급비중 = 준비수량 비중, 판매비중 = 판매 비중
  const hm = t => hhmmss(t).slice(0, 5);
  const p1 = x => (Math.round(x * 10) / 10).toFixed(1);
  // 컬러 × 사이즈 판매비중 표 (상품 안 비중, 행·열 합 포함)
  function matrix(la) {
    const val = r => (cfg.metric === '총' ? r.pre + r.live : r.live);
    const rows = [...new Set(la.map(a => a.color))], cols = [...new Set(la.map(a => a.size))];
    cols.sort((a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0) || String(a).localeCompare(b));
    const tot = la.reduce((s, a) => s + val(a.last), 0);
    if (!tot || (rows.length < 2 && cols.length < 2)) return null;
    const cell = {}; la.forEach(a => { const k = a.color + '|' + a.size; cell[k] = (cell[k] || 0) + val(a.last); });
    const pc = v => v / tot * 100;
    rows.sort((a, b) => cols.reduce((s, z) => s + (cell[b + '|' + z] || 0), 0) - cols.reduce((s, z) => s + (cell[a + '|' + z] || 0), 0));
    return { rows, cols, tot, pc: (r, z) => (cell[r + '|' + z] === undefined ? null : pc(cell[r + '|' + z])), rs: r => pc(cols.reduce((s, z) => s + (cell[r + '|' + z] || 0), 0)), cs: z => pc(rows.reduce((s, r) => s + (cell[r + '|' + z] || 0), 0)) };
  }
  const mxHtml = (m, cls) => {
    const L = v => (v === '-' ? '전체' : esc(v)), mx = Math.max(...m.rows.flatMap(r => m.cols.map(z => m.pc(r, z) || 0)));
    const td = v => (v === null ? '<td class="muted">-</td>' : `<td style="background:rgba(0,136,255,${(0.08 + 0.42 * v / (mx || 1)).toFixed(2)})">${Math.round(v)}%</td>`);
    return `<table class="${cls}"><tr><th></th>${m.cols.map(z => `<th>${L(z)}</th>`).join('')}${m.cols.length > 1 ? '<th>합</th>' : ''}</tr>${m.rows.map(r => `<tr><td>${L(r)}</td>${m.cols.map(z => td(m.pc(r, z))).join('')}${m.cols.length > 1 ? `<td><b>${Math.round(m.rs(r))}%</b></td>` : ''}</tr>`).join('')}${m.rows.length > 1 ? `<tr><td><b>합</b></td>${m.cols.map(z => `<td><b>${Math.round(m.cs(z))}%</b></td>`).join('')}${m.cols.length > 1 ? '<td><b>100%</b></td>' : ''}</tr>` : ''}</table>`;
  };
  function summary() {
    const R = broadcastRange();
    let { rows, logs } = allRecords(R.from, R.to), fromTable = false;
    // 구간은 이 방송 전체 상품으로 나누고(브랜드를 골라도 다른 브랜드가 팔린 시간은 내 구간이 아님), 표시는 고른 브랜드만
    const rowsP = rows.filter(r => inPgm(r.key.split('|')[0]));
    rows = rowsP.filter(r => inBrand(r.key.split('|')[0]));
    // 레이더를 안 켜고 끝난 방송: 지금 표의 최종 수량으로 요약 (시간대 정보 없음)
    if (!rows.length) { fromTable = true; rows = [...S.rows.values()].filter(r => !r.stale && inScope(r.prod)).map(r => ({ t: Date.now(), key: r.key, pre: r.pre || 0, live: r.live || 0, avail: r.avail || 0 })); }
    if (!rows.length) return null;
    const val = r => (cfg.metric === '총' ? r.pre + r.live : r.live);
    const A = new Map();
    rows.forEach(r => {
      const tot = r.pre + r.live + r.avail;
      let a = A.get(r.key);
      if (!a) {
        const [p, name] = r.key.split('|'), [color, size] = parseAttr(name);
        a = { key: r.key, p, color, size, agg: name === AGG, supply: tot, lastTot: tot, firstT: r.t, last: r, soldAt: null, restock: false };
        A.set(r.key, a);
      } else {
        if (tot > a.lastTot && !a.agg) { a.supply += tot - a.lastTot; if (a.soldAt) a.restock = true; }
        a.lastTot = tot;
        if (a.last.avail > 0 && r.avail <= 0 && !a.soldAt) a.soldAt = r.t;
      }
      a.last = r;
    });
    A.forEach(a => { if (a.agg) a.supply = 0; a.v = val(a.last); a.avail = a.agg ? -Math.max(0, a.last.live) : a.last.avail; a.st = a.supply > 0 ? (a.supply - a.avail) / a.supply * 100 : 0; if (fromTable && a.avail <= 0 && a.supply > 0) a.soldAt = -1; });
    // 상품 단위
    const byP = new Map();
    A.forEach(a => { if (!byP.has(a.p)) byP.set(a.p, []); byP.get(a.p).push(a); });
    const total = [...A.values()].reduce((s, a) => s + a.v, 0) || 1;
    const share = (as, f) => {
      const m = new Map(), sup = as.reduce((s, a) => s + a.supply, 0) || 1, sal = as.reduce((s, a) => s + a.v, 0) || 1;
      as.forEach(a => { const k = a[f]; if (!m.has(k)) m.set(k, { n: k, supply: 0, v: 0, avail: 0 }); const o = m.get(k); o.supply += a.supply; o.v += a.v; o.avail += a.avail; });
      return [...m.values()].map(o => ({ ...o, sup: o.supply / sup * 100, sal: o.v / sal * 100, gap: o.v / sal * 100 - o.supply / sup * 100, st: o.supply > 0 ? (o.supply - o.avail) / o.supply * 100 : 0 })).sort((a, b) => b.supply - a.supply);
    };
    const prods = [...byP.entries()].map(([p, as]) => {
      const la = as.filter(a => !a.agg);
      const supply = as.reduce((s, a) => s + a.supply, 0), avail = as.reduce((s, a) => s + a.avail, 0), sum = as.reduce((s, a) => s + a.v, 0);
      const ord = supply - avail, cv = CONV[norm(p)] ? CONV[norm(p)].r : null, exq = cv !== null ? ord * cv : null;
      return { p, sum, pct: sum / total * 100, supply, avail, st: supply > 0 ? ord / supply * 100 : 0, ord, conv: cv, exq, est: exq !== null && supply > 0 ? exq / supply * 100 : null,
        colors: la.some(a => a.color !== '-') ? share(la.filter(a => a.color !== '-'), 'color') : [],
        sizes: la.some(a => a.size !== '-') ? share(la.filter(a => a.size !== '-'), 'size').sort((a, b) => (parseFloat(a.n) || 0) - (parseFloat(b.n) || 0) || String(a.n).localeCompare(b.n)) : [],
        attrs: la, folded: as.some(a => a.agg), mx: matrix(la) };
    }).filter(x => x.sum > 0 || x.supply > 0).sort((a, b) => b.sum - a.sum);
    const pIdx = new Map(prods.map((x, i) => [x.p, i]));
    // 분 단위 판매 흐름 (상품별)
    let segs = [], flow = null;
    if (!fromTable) {
      const t0 = Math.floor((R.bw ? Math.max(R.bw.st, rowsP[0].t) : rowsP[0].t) / 60000) * 60000;
      const t1 = Math.min(R.bw ? R.bw.en : Infinity, rowsP[rowsP.length - 1].t);
      const n = Math.max(1, Math.ceil((t1 - t0) / 60000) + 1);
      const SP = [...new Set(rowsP.map(r => r.key.split('|')[0]))], sIdx = new Map(SP.map((p, i) => [p, i]));
      const incA = SP.map(() => new Array(n).fill(0)), prev = new Map();
      rowsP.forEach(r => {
        const pv = prev.get(r.key); prev.set(r.key, val(r));
        if (pv === undefined || r.t < t0) return;
        const b = Math.floor((r.t - t0) / 60000); if (b >= n) return;
        const pi = sIdx.get(r.key.split('|')[0]);
        const d = val(r) - pv; incA[pi][b] += r.key.endsWith('|' + AGG) ? d : Math.max(0, d);
      });
      incA.forEach(a => a.forEach((x, i) => { if (x < 0) a[i] = 0; }));
      const inc = prods.map(x => incA[sIdx.get(x.p)] || new Array(n).fill(0));
      const tot = i => incA.reduce((s, a) => s + a[i], 0);
      // 구간: 앞뒤 3분을 합쳐 가장 많이 팔린 상품이 바뀌는 지점으로 나눔 (5분 미만 조각은 앞 구간에 붙임)
      const dom = [];
      for (let i = 0; i < n; i++) {
        let best = -1, bv = 0;
        SP.forEach((_, pi) => { let s = 0; for (let j = Math.max(0, i - 3); j <= Math.min(n - 1, i + 3); j++) s += incA[pi][j]; if (s > bv) { bv = s; best = pi; } });
        dom.push(best);
      }
      let runs = [];
      const TS = tableSegs(R.bw), baseN = p => norm(p.replace(/\s*\(\d+\)$/, ''));
      const tsFull = TS && TS.reduce((a, g) => a + g.dur, 0) >= (R.bw.en - R.bw.st) / 60000 * 0.85;
      if (TS && tsFull) {
        // 방송실적관리 노출분(프로그램순): 방송 시작부터 묶음 순서대로 노출분만큼 이어 붙임
        let c = R.bw.st;
        TS.forEach((g, k) => {
          const st = c, en = c + g.dur * 60000; c = en;
          const s = Math.max(0, Math.floor((st - t0) / 60000)), e = Math.min(n - 1, Math.ceil((en - t0) / 60000) - 1);
          if (e < s) return;
          runs.push({ s, e, no: k + 1, st, en, names: new Set(g.names) });
        });
      } else if (TS) {
        // 주방송상품별로만 본 경우: 묶음 길이(노출분)는 맞고 시작 시각을 모름 → 그 묶음 상품이 가장 많이 팔린 같은 길이 구간을 찾음
        TS.forEach((g, k) => {
          const names = new Set(g.names), idx = SP.map((p, i) => (names.has(baseN(p)) ? i : -1)).filter(i => i >= 0), L = Math.max(1, Math.round(g.dur));
          if (!idx.length) return;
          const per = i => idx.reduce((a, pi) => a + incA[pi][i], 0);
          let best = -1, bs = 0;
          for (let s0 = Math.floor((R.bw.st - t0) / 60000); s0 + L <= Math.ceil((R.bw.en - t0) / 60000); s0++) { let v = 0; for (let i = Math.max(0, s0); i < Math.min(n, s0 + L); i++) v += per(i); if (v > best) { best = v; bs = s0; } }
          if (best <= 0) return;
          const st = t0 + bs * 60000, en = st + g.dur * 60000, s = Math.max(0, bs), e = Math.min(n - 1, bs + L - 1);
          if (e >= s) runs.push({ s, e, no: k + 1, st, en, names, guess: true });
        });
      } else {
      dom.forEach((d, i) => { if (d < 0) return; const r = runs[runs.length - 1]; if (r && r.d === d && i - r.e <= 4) r.e = i; else runs.push({ d, s: i, e: i }); });
      runs = runs.reduce((out, r) => { const l = out[out.length - 1]; if (l && (r.e - r.s + 1 < 5 || l.d === r.d)) { l.e = r.e; } else out.push(r); return out; }, []);
      if (runs.length > 1 && runs[0].e - runs[0].s + 1 < 5) { runs[1].s = runs[0].s; runs.shift(); }
      }
      segs = runs.map((r, k) => {
        const s = r.s, e = r.e, len = e - s + 1, ps = SP.map((p, pi) => ({ p, v: incA[pi].slice(s, e + 1).reduce((a, b) => a + b, 0) })).filter(o => o.v > 0 && (!r.names || r.names.has(baseN(o.p)))).sort((a, b) => b.v - a.v);
        const sum = ps.reduce((a, o) => a + o.v, 0), per = []; for (let i = s; i <= e; i++) per.push(tot(i));
        let pk = { v: -1, i: s }; for (let i = s; i <= e; i++) { let v = 0; for (let j = i; j < Math.min(e + 1, i + 5); j++) v += tot(j); if (v > pk.v) pk = { v, i }; }
        const th = Math.max(1, Math.floor(len / 3)), r1 = per.slice(0, th).reduce((a, b) => a + b, 0) / th, r3 = per.slice(-th).reduce((a, b) => a + b, 0) / th;
        const type = len < 6 ? '' : r1 > r3 * 1.4 ? '초반 집중형' : r3 > r1 * 1.4 ? '후반 상승형' : '고르게 쌓임';
        // 1등 상품의 꺾인 시점: 피크 3분 평균의 절반 아래로 3분 연속 떨어진 첫 시각
        const mi = sIdx.get(ps[0] ? ps[0].p : ''), m3 = i => (incA[mi][i] + (incA[mi][i - 1] || 0) + (incA[mi][i - 2] || 0)) / 3;
        let top = -1, ti = s; if (mi !== undefined) for (let i = s; i <= e; i++) if (m3(i) > top) { top = m3(i); ti = i; }
        let drop = null; if (mi !== undefined && top > 0) for (let i = ti + 1; i <= e - 2; i++) if (m3(i) < top / 2 && m3(i + 1) < top / 2 && m3(i + 2) < top / 2) { drop = t0 + i * 60000; break; }
        if (r.names) return { tab: true, guess: !!r.guess, no: r.no, st: r.st, en: r.en, len: Math.round((r.en - r.st) / 60000), part: r.st < t0, sum, rate: sum / len, ps, main: SP.filter(p => r.names.has(baseN(p))), peak: { st: t0 + pk.i * 60000, v: pk.v }, type, drop, top: Math.round(top), first10: per.slice(0, 10).reduce((a, b) => a + b, 0) };
        return { no: k + 1, st: t0 + s * 60000, en: t0 + (e + 1) * 60000, len, sum, rate: sum / len, ps, main: ps.filter(o => o.v >= sum * 0.15).map(o => o.p), peak: { st: t0 + pk.i * 60000, v: pk.v }, type, drop, top: Math.round(top), first10: per.slice(0, 10).reduce((a, b) => a + b, 0) };
      }).filter(g => g.sum > 0 || g.tab);
      flow = { t0, n, inc };
      prods.forEach(x => { let best = null; segs.forEach(g => { const o = g.ps.find(q => q.p === x.p); if (g.tab ? g.main.includes(x.p) : o && (!best || o.v > best.v)) best = { g, v: o ? o.v : 0 }; }); x.seg = best ? best.g.no : null; x.segEn = best ? best.g.en : null; });
      // 상품이 실제로 팔린 끝: 3분 평균이 피크의 20% 아래로 내려가기 전 마지막 시각
      prods.forEach((x, pi) => { const a = inc[pi], m3 = i => (a[i] + (a[i - 1] || 0) + (a[i - 2] || 0)) / 3; let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, m3(i)); let last = -1; for (let i = 0; i < n; i++) if (pk > 0 && m3(i) >= pk * 0.2) last = i; x.actEn = last >= 0 ? t0 + (last + 1) * 60000 : null; });
      // 고른 브랜드 상품이 있는 구간만 보여줌
      segs = segs.filter(g => prods.some(x => x.seg === g.no));
    }
    // 품절: 시각, 직전 10분 속도로 추정한 놓친 수량, 품절 전후 상품 판매 속도
    const sold = [];
    A.forEach(a => {
      if (!a.soldAt || a.agg) return;
      const o = { a, t: a.soldAt > 0 ? a.soldAt : null, lost: null, before: null, after: null };
      if (flow && o.t) {
        const pi = pIdx.get(a.p), b = Math.floor((o.t - flow.t0) / 60000), x = prods[pi];
        let d10 = 0, pv = null;
        rows.forEach(r => { if (r.key !== a.key) return; if (r.t >= o.t - 600000 && r.t <= o.t && pv !== null) d10 += Math.max(0, val(r) - pv); pv = val(r); });
        // 놓친 판매 = 품절 직전 10분 속도 × 품절~그 상품 판매가 끝난 시각(구간 끝과 상품 판매가 잦아든 시각 중 빠른 쪽)
        const endT = Math.min(x.segEn || Infinity, x.actEn || Infinity);
        const rest = endT < Infinity ? Math.max(0, (endT - o.t) / 60000) : 0;
        o.until = endT < Infinity ? endT : null;
        o.lost = Math.round(d10 / 10 * rest);
        const sum = (i, j) => { let s = 0; for (let k = Math.max(0, i); k < Math.min(flow.n, j); k++) s += flow.inc[pi][k]; return s; };
        if (b - 5 >= 0 && b + 5 <= flow.n) { o.before = sum(b - 5, b) / 5; o.after = sum(b + 1, b + 6) / 5; }
      }
      sold.push(o);
    });
    sold.sort((x, y) => (x.t || 0) - (y.t || 0));
    // 다음 액션 후보 (규칙 기반)
    const acts = { reorder: [], clear: [], alloc: [] };
    prods.forEach(x => {
      x.colors.forEach(c => { if (c.gap >= 10 && c.st >= 50) acts.reorder.push({ p: x.p, n: c.n, why: `판매비중 ${Math.round(c.sal)}% vs 공급 ${Math.round(c.sup)}% (${Math.round(c.gap) > 0 ? '+' : ''}${Math.round(c.gap)}%p) · 총주문 기준 소진 ${Math.round(c.st)}%` }); if (c.gap <= -10 && c.st < 40) acts.clear.push({ p: x.p, n: c.n, why: `판매비중 ${Math.round(c.sal)}% vs 공급 ${Math.round(c.sup)}% (${Math.round(c.gap)}%p) · 잔여 ${fmt(c.avail)}` }); });
      x.attrs.filter(a => a.soldAt).forEach(a => { if (!acts.reorder.find(o => o.p === x.p && o.n === a.color)) acts.reorder.push({ p: x.p, n: [a.color, a.size].filter(v => v !== '-').join(' '), why: '방송 중 품절' }); });
      if (x.colors.length > 1 || x.sizes.length > 1) acts.alloc.push({ p: x.p, colors: x.colors.filter(c => c.v > 0).sort((a, b) => b.sal - a.sal), sizes: x.sizes });
    });
    const late = !fromTable && R.bw && rows[0].t > R.bw.st + 5 * 60000;
    const ended = R.bw ? Date.now() > R.bw.en : false;
    return { R, prods, segs, flow, sold, acts, total, ended, fromTable, late, firstT: rows[0].t, logs };
  }
  const nm = p => shortP(p);
  const gapTag = g => (g >= 10 ? '▲' : g <= -10 ? '▼' : '');
  const title = m => `${m.R.bw ? `${ymd(m.R.bw.st).slice(5).replace('-', '/')} ${m.R.bw.label}` : ymd(Date.now())}${m.R.bw && !m.ended ? ' (진행 중)' : ''}`;
  const notes = m => [m.prods.some(x => x.conv === null) && `예상전환율을 못 읽은 상품(${m.prods.filter(x => x.conv === null).map(x => nm(x.p)).join(', ')})은 총주문 기준 소진만 보여요. 화면 위 방송실적관리 표가 보이게 두면 읽어요.`, m.fromTable && '레이더를 켜지 않은 방송이라 화면 표의 최종 수량 기준이에요 (구간·흐름·품절 시각 없음).', m.late && `레이더를 ${hm(m.firstT)}에 켜서 그 전 시간대 흐름(구간·피크·품절 시각)은 없어요. 판매·준비수량·잔여는 정상이에요.`].filter(Boolean);

  // 팀 Teams 리뷰 형식 텍스트
  function summaryText(m) {
    const L = [], shr = (as, f) => as.map(o => `${o.n}(${p1(o[f])}%)`).join(', ');
    L.push(`[${cfg.brand ? bName(cfg.brand) : pgmName() || '전체'}] ${title(m)} 방송 리뷰 (속성 레이더 · ${cfg.metric}주문 기준)`);
    notes(m).forEach(t => L.push(`※ ${t}`));
    const block = (x) => {
      if (x.conv !== null) L.push(`   -${x.p} / ${fmt(x.supply)} / ${fmt(x.supply - x.exq)} / (${p1(x.est)}%)  ※예상취급 ${fmt(x.exq)}개 = 총주문 ${fmt(x.ord)} × 예상전환율 ${Math.round(x.conv * 100)}% · 총주문 기준 소진 ${p1(x.st)}%`);
      else L.push(`   -${x.p} / ${fmt(x.supply)} / ${fmt(x.avail)} / (${p1(x.st)}%)  ※총주문 기준(전환율 미확인)`);
    };
    const share = x => {
      if (!x.colors.length && !x.sizes.length) return;
      L.push(`   -${x.p}`);
      if (x.colors.length) { L.push(`    공급비중 : ${shr(x.colors, 'sup')}`); L.push(`    판매비중 : ${shr(x.colors, 'sal')}`); }
      if (x.sizes.length) { L.push(`    사이즈 공급비중 : ${shr(x.sizes, 'sup')}`); L.push(`    사이즈 판매비중 : ${shr(x.sizes, 'sal')}`); }
    };
    const groups = m.segs.length ? m.segs.map(g => ({ g, ps: m.prods.filter(x => x.seg === g.no) })).filter(o => o.ps.length) : [{ g: null, ps: m.prods }];
    const rest = m.prods.filter(x => m.segs.length && !x.seg);
    if (rest.length) groups.push({ g: null, ps: rest, etc: true });
    groups.forEach(({ g, ps, etc }) => {
      L.push('');
      if (g) {
        L.push(`[방송순서 : ${g.guess ? '순서 미확인' : g.no + '번 구간'}, ${g.len}분] ${hm(g.st)}~${hm(g.en)}${g.tab && !g.guess ? '' : ' (추정)'}`);
        L.push(`   -흐름: ${[g.type, `분당 ${fmt(Math.round(g.rate))}개`, `피크 ${hm(g.peak.st)}~${hm(g.peak.st + 5 * 60000)} +${fmt(g.peak.v)}`, g.drop && `${hm(g.drop)} 이후 ${nm(g.ps[0].p)} 판매 속도 절반 이하`].filter(Boolean).join(' · ')}`);
      } else L.push(etc ? '[구간 밖 판매]' : '[방송 전체]');
      L.push('* 분취/분공 : ');
      L.push('* 기획물량/예상잔여/예상소진률'); ps.forEach(block);
      L.push('* 판매 비중'); ps.forEach(share);
    });
    if (m.sold.length) {
      L.push(''); L.push('* 품절');
      m.sold.forEach(o => L.push(`   -${nm(o.a.p)} ${[o.a.color, o.a.size].filter(v => v !== '-').join(' ')}${o.t ? ` ${hm(o.t)} 품절` : ' 품절'}${o.lost ? ` 놓친 판매 약 ${fmt(o.lost)}개(${o.until ? hm(o.until) + '까지 ' : ''}추정)` : ''}${o.before !== null && o.before > 0 ? ` · 품절 후 상품 분당 판매 ${o.after >= o.before ? '+' : ''}${Math.round((o.after - o.before) / o.before * 100)}%` : ''}${o.a.restock ? ' · 이후 수량 추가됨' : ''}`));
    }
    L.push(''); L.push('* 운영계획 (레이더 제안 후보)');
    m.acts.reorder.forEach(o => L.push(`   -리오더 후보: ${nm(o.p)} ${o.n} (${o.why})`));
    m.acts.clear.forEach(o => L.push(`   -소진 필요: ${nm(o.p)} ${o.n} (${o.why})`));
    m.acts.alloc.forEach(o => L.push(`   -다음 방송 배분안 ${nm(o.p)}: ${[o.colors.length > 1 && o.colors.map(c => `${c.n} ${Math.round(c.sal)}%`).join(' · '), o.sizes.length > 1 && o.sizes.map(c => `${c.n} ${Math.round(c.sal)}%`).join(' · ')].filter(Boolean).join(' / ')}`));
    if (!m.acts.reorder.length && !m.acts.clear.length) L.push('   -공급과 판매 비중 차이가 10%p 넘는 컬러 없음');
    return L.join('\n');
  }

  // 패널 요약 탭
  function summaryHtml() {
    const m = summary();
    if (!m) return '<p class="muted">이번 방송 시간대 기록이 아직 없어요.</p>';
    const bar = (v, c) => `<div class="bar"><i style="width:${Math.min(100, v)}%;${c ? `background:${c}` : ''}"></i></div>`;
    const h = [];
    h.push(`<div class="btns" style="margin:0 0 6px"><button data-a="sumcopy">리뷰 텍스트 복사</button><button data-a="report">리포트 저장</button>${DIR.ok ? '<button data-a="save">폴더에 저장</button>' : ''}</div>`);
    h.push(`<div class="muted">${esc(title(m))} · ${cfg.metric}주문 합계 ${fmt(m.total)}개</div>`);
    notes(m).forEach(t => h.push(`<div class="muted" style="color:#bc4c00">※ ${esc(t)}</div>`));
    h.push(`<div class="jmp">${[['A', '판매·소진'], ['B', '구간'], ['C', '비중'], ['D', '품절'], ['E', '액션']].filter(([k]) => k !== 'B' || m.segs.length).map(([k, l]) => `<button data-j="${k}">${k} ${l}</button>`).join('')}</div>`);
    h.push(`<h5 id="sA">A. 상품별 판매와 소진</h5>`);
    m.prods.forEach(x => h.push(`<div class="prod"><h4><span>${esc(nm(x.p))}</span><span>${fmt(x.sum)} <span class="muted">판매비중 ${Math.round(x.pct)}%</span></span></h4>${bar(x.est !== null ? x.est : x.st)}${x.conv !== null ? `<div class="muted">준비 ${fmt(x.supply)} · 총주문 ${fmt(x.ord)} × 전환 ${Math.round(x.conv * 100)}% = 예상취급 <b>${fmt(x.exq)}</b></div><div class="muted">예상소진 <b>${Math.round(x.est)}%</b> · 총주문 기준 소진 ${Math.round(x.st)}% · 잔여 ${fmt(x.avail)}${x.seg ? ` · ${x.seg}구간` : ''}</div>` : `<div class="muted">준비 ${fmt(x.supply)} · 잔여 ${fmt(x.avail)} · 총주문 기준 소진 ${Math.round(x.st)}% · 전환율 미확인${x.seg ? ` · ${x.seg}구간` : ''}</div>`}</div>`));
    if (m.segs.length) {
      h.push(`<h5 id="sB">B. 구간과 흐름 <span class="muted">(${m.segs[0].guess ? '노출분 길이 기준, 시작 시각은 판매로 추정 · 방송실적관리를 프로그램순으로 한 번 열면 정확해져요' : m.segs[0].tab ? '방송실적관리 노출분 기준' : '판매로 추정'})</span></h5>`);
      m.segs.forEach(g => h.push(`<div class="prod"><h4><span>${g.guess ? '주방송 묶음' : g.no + '구간'} ${hm(g.st)}~${hm(g.en)} <span class="muted">${g.len}분</span></span><span>${fmt(g.sum)}</span></h4><div class="muted">${esc(g.main.map(nm).join(' · '))} 중심</div><div class="muted">${[g.type, `분당 ${fmt(Math.round(g.rate))}`, `피크 ${hm(g.peak.st)}~ +${fmt(g.peak.v)}`].filter(Boolean).join(' · ')}${g.drop ? ` · <b>${hm(g.drop)}</b> 이후 ${esc(nm(g.ps[0].p))} 속도 절반 이하` : ''}</div></div>`));
    }
    h.push(`<h5 id="sC">C. 공급비중 vs 판매비중 <span class="muted">▲▼ = 10%p 이상 차이</span></h5><div class="muted" style="margin-bottom:4px">주문소진 = 준비수량 중 주문이 들어온 비율(취소·반품 전). 품절 위험을 볼 때 써요.</div>`);
    const tbl = (rows, lab) => `<table class="sh"><tr><th>${lab}</th><th>공급</th><th>판매</th><th>차이(%p)</th><th>주문소진</th></tr>${rows.map(o => `<tr><td>${esc(o.n)}</td><td>${Math.round(o.sup)}%</td><td><b>${Math.round(o.sal)}%</b></td><td class="${o.gap >= 10 ? 'up' : o.gap <= -10 ? 'dn' : 'muted'}">${gapTag(o.gap)}${Math.round(o.gap) > 0 ? '+' : ''}${Math.round(o.gap)}</td><td>${Math.round(o.st)}%</td></tr>`).join('')}</table>`;
    m.prods.filter(x => x.colors.length || x.sizes.length).forEach((x, i) => h.push(`<details data-dp="${esc(x.p)}" ${(S.detOpen.has(x.p) ? S.detOpen.get(x.p) : i === 0) ? 'open' : ''}><summary>${esc(nm(x.p))}</summary>${x.colors.length ? tbl(x.colors, '컬러') : ''}${x.sizes.length ? tbl(x.sizes, '사이즈') : ''}</details>`));
    h.push(`<h5 id="sD">D. 품절과 놓친 판매</h5>`);
    h.push(m.sold.length ? m.sold.map(o => `<div class="row"><span>${esc(nm(o.a.p))} ${esc([o.a.color, o.a.size].filter(v => v !== '-').join(' '))}${o.before !== null && o.before > 0 ? `<div class="muted">품절 후 상품 분당 판매 ${o.after >= o.before ? '+' : ''}${Math.round((o.after - o.before) / o.before * 100)}%</div>` : ''}</span><b class="warn">${o.t ? hm(o.t) : '품절'}</b><span class="muted">${o.lost ? `놓친 약 ${fmt(o.lost)}${o.until ? ` (${hm(o.until)}까지)` : ''}` : ''}</span></div>`).join('') : '<p class="muted">방송 중 품절된 속성이 없어요.</p>');
    h.push(`<h5 id="sE">E. 다음 액션 후보 <span class="muted">(판단은 담당자)</span></h5>`);
    const li = (t, arr) => arr.length ? `<div class="muted" style="margin-top:4px"><b>${t}</b></div>` + arr.map(o => `<div>· ${esc(nm(o.p))} <b>${esc(o.n)}</b> <span class="muted">${esc(o.why)}</span></div>`).join('') : '';
    h.push(li('리오더 후보', m.acts.reorder) + li('소진 필요', m.acts.clear) + (m.prods.some(x => x.mx) ? `<div class="muted" style="margin-top:4px"><b>다음 방송 배분안</b> (이번 판매비중, 상품 안 %)</div>` + m.prods.filter(x => x.mx).map(x => `<div style="margin-top:4px;font-weight:600;font-size:12px">${esc(nm(x.p))}</div>${mxHtml(x.mx, 'sh mx')}`).join('') : '') || '<p class="muted">눈에 띄는 후보가 없어요.</p>');
    return h.join('');
  }

  // 그래프 리포트 (HTML 한 장)
  function reportHtml(m) {
    const C = ['#0088ff', '#e8336d', '#1a9e6e', '#e8890c', '#8250df', '#0b9bb5', '#b35900', '#6e7781'];
    const e = esc, P = m.prods;
    let flowSvg = '';
    if (m.flow && m.flow.n > 1) {
      const { t0, n, inc } = m.flow, W = 900, H = 260, L = 44, B = 28, T = 26, sm = a => a.map((_, i) => (a[i] + (a[i - 1] || 0) + (a[i + 1] || 0)) / 3);
      const S2 = inc.map(sm), mx = Math.max(1, ...S2.flat()), x = i => L + i / (n - 1) * (W - L - 10), y = v => T + (1 - v / mx) * (H - T - B);
      const bands = m.segs.map((g, k) => { const a = x(Math.max(0, (g.st - t0) / 60000)), b = x(Math.min(n - 1, (g.en - t0) / 60000)); return `<rect x="${a}" y="${T}" width="${Math.max(0, b - a)}" height="${H - T - B}" fill="${k % 2 ? '#f3f6fa' : '#e9f4ff'}"/><text x="${a + 4}" y="${T + 14}" font-size="12" fill="#57606a">${g.guess ? '주방송' : g.no + '구간'}</text>`; }).join('');
      const ticks = []; for (let i = 0; i < n; i += Math.max(1, Math.round(n / 8))) ticks.push(`<text x="${x(i)}" y="${H - 8}" font-size="11" text-anchor="middle" fill="#6e7781">${hm(t0 + i * 60000)}</text>`);
      const yt = [0, .5, 1].map(f => `<text x="${L - 6}" y="${y(mx * f) + 4}" font-size="11" text-anchor="end" fill="#6e7781">${Math.round(mx * f)}</text><line x1="${L}" x2="${W - 10}" y1="${y(mx * f)}" y2="${y(mx * f)}" stroke="#eaeef2"/>`).join('');
      const lines = S2.map((a, pi) => `<polyline fill="none" stroke="${C[pi % C.length]}" stroke-width="2" points="${a.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"/>`).join('');
      flowSvg = `<svg viewBox="0 0 ${W} ${H}" width="100%">${bands}${yt}${lines}${ticks}</svg><div class="lg">${P.map((x, i) => `<span><i style="background:${C[i % C.length]}"></i>${e(nm(x.p))}</span>`).join('')}</div><p class="note">분당 판매(앞뒤 1분 평균). 배경 띠는 ${m.segs.length && m.segs[0].tab ? '방송실적관리 노출분으로 나눈' : '판매로 추정한'} 구간.</p>`;
    }
    const pair = rows => { const W = 320, rh = 30, H = rows.length * rh + 24, mx = Math.max(1, ...rows.flatMap(o => [o.sup, o.sal])), sx = v => v / mx * (W - 174);
      return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W * 1.4}px">${rows.map((o, i) => `<text x="0" y="${i * rh + 19}" font-size="13" fill="#1f2328">${e(o.n)}</text><rect x="78" y="${i * rh + 5}" width="${sx(o.sup)}" height="9" fill="#cce7ff"/><rect x="78" y="${i * rh + 15}" width="${sx(o.sal)}" height="9" fill="#0088ff"/><text x="${84 + sx(Math.max(o.sup, o.sal))}" y="${i * rh + 20}" font-size="12" fill="${o.gap >= 10 ? '#d1242f' : o.gap <= -10 ? '#2f6fde' : '#57606a'}">${Math.round(o.sup)}→${Math.round(o.sal)}% ${gapTag(o.gap)}</text>`).join('')}<rect x="0" y="${H - 12}" width="10" height="9" fill="#cce7ff"/><text x="14" y="${H - 4}" font-size="12" fill="#57606a">공급비중</text><rect x="80" y="${H - 12}" width="10" height="9" fill="#0088ff"/><text x="94" y="${H - 4}" font-size="12" fill="#57606a">판매비중</text></svg>`; };
    const txt = summaryText(m);
    return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"><title>방송 리뷰 ${e(title(m))}</title><style>
body{margin:0;background:#f6f8fa;color:#1f2328;font:14px/1.6 'Pretendard Variable',Pretendard,'Malgun Gothic','Apple SD Gothic Neo',sans-serif}.w{max-width:960px;margin:0 auto;padding:28px 16px 60px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 10px;color:#0088ff}.sub{color:#57606a}.c{background:#fff;border:1px solid #d0d7de;border-radius:12px;padding:16px 18px;margin:10px 0}
table{border-collapse:collapse;width:100%;font-size:13px}table.mx td,table.mx th{text-align:center!important;border:1px solid #eaeef2}th,td{padding:6px 8px;border-bottom:1px solid #eaeef2;text-align:right}th:first-child,td:first-child{text-align:left}th{color:#57606a;font-weight:600}
.g{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}.lg span{display:inline-flex;align-items:center;gap:5px;margin-right:14px;font-size:13px}.lg i{width:10px;height:10px;border-radius:2px;display:inline-block}
.note{color:#6e7781;font-size:12px}.warn{color:#bc4c00}.up{color:#d1242f;font-weight:700}.dn{color:#2f6fde;font-weight:700}pre{white-space:pre-wrap;font:13px/1.6 inherit;background:#fff;border:1px solid #d0d7de;border-radius:12px;padding:16px}
</style></head><body><div class="w">
<h1>방송 리뷰 · ${e(title(m))}</h1><div class="sub">속성 레이더 자동 정리 · ${cfg.metric}주문 기준 · 합계 ${fmt(m.total)}개 · 만든 시각 ${ymd(Date.now())} ${hm(Date.now())}</div>
${notes(m).map(t => `<p class="warn">※ ${e(t)}</p>`).join('')}
<h2>A. 상품별 판매와 소진</h2><div class="c"><table><tr><th>상품</th><th>판매</th><th>비중</th><th>준비수량</th><th>총주문</th><th>예상전환율</th><th>예상취급</th><th>예상소진</th><th>총주문 기준 소진</th><th>잔여</th><th>구간</th></tr>${P.map(x => `<tr><td>${e(x.p)}</td><td><b>${fmt(x.sum)}</b></td><td>${p1(x.pct)}%</td><td>${fmt(x.supply)}</td><td>${fmt(x.ord)}</td><td>${x.conv !== null ? Math.round(x.conv * 100) + '%' : '-'}</td><td>${x.exq !== null ? fmt(x.exq) : '-'}</td><td><b>${x.est !== null ? p1(x.est) + '%' : '-'}</b></td><td>${p1(x.st)}%</td><td>${fmt(x.avail)}</td><td>${x.seg || '-'}</td></tr>`).join('')}</table><p class="note">예상취급 = 총주문 × 예상전환율(방송실적관리 예상취급액 ÷ 총주문액). 예상소진 = 예상취급 ÷ 준비수량.</p></div>
${m.segs.length ? `<h2>B. 구간과 흐름 (${m.segs[0].guess ? '노출분 길이 기준, 시작 시각은 판매로 추정' : m.segs[0].tab ? '방송실적관리 노출분 기준' : '판매로 추정'})</h2><div class="c">${flowSvg}<table><tr><th>구간</th><th>시간</th><th>중심 상품</th><th>판매</th><th>분당</th><th>유형</th><th>피크 5분</th><th>꺾인 시점</th></tr>${m.segs.map(g => `<tr><td>${g.guess ? '주방송 묶음' : g.no + '구간'}</td><td>${hm(g.st)}~${hm(g.en)} (${g.len}분)</td><td style="text-align:left">${e(g.main.map(nm).join(', '))}</td><td>${fmt(g.sum)}</td><td>${fmt(Math.round(g.rate))}</td><td>${g.type || '-'}</td><td>${hm(g.peak.st)}~ +${fmt(g.peak.v)}</td><td>${g.drop ? hm(g.drop) : '-'}</td></tr>`).join('')}</table></div>` : ''}
<h2>C. 공급비중 vs 판매비중</h2><p class="note">연한 막대 = 공급비중(준비수량), 진한 막대 = 판매비중. ▲ 판매가 공급보다 10%p 이상 많음, ▼ 10%p 이상 적음.</p>
<div class="g">${P.filter(x => x.colors.length || x.sizes.length).map(x => `<div class="c"><b>${e(nm(x.p))}</b>${x.colors.length ? `<div class="note">컬러</div>${pair(x.colors)}` : ''}${x.sizes.length ? `<div class="note">사이즈</div>${pair(x.sizes)}` : ''}</div>`).join('')}</div>
<h2>D. 품절과 놓친 판매</h2><div class="c">${m.sold.length ? `<table><tr><th>속성</th><th>품절 시각</th><th>놓친 판매(추정, 상품 판매 끝까지)</th><th>품절 후 상품 분당 판매</th></tr>${m.sold.map(o => `<tr><td>${e(nm(o.a.p))} ${e([o.a.color, o.a.size].filter(v => v !== '-').join(' '))}</td><td>${o.t ? hm(o.t) : '-'}</td><td>${o.lost ? fmt(o.lost) + (o.until ? ` (${hm(o.until)}까지)` : '') : '-'}</td><td>${o.before !== null && o.before > 0 ? `${o.after >= o.before ? '+' : ''}${Math.round((o.after - o.before) / o.before * 100)}%` : '-'}</td></tr>`).join('')}</table><p class="note">놓친 판매 = 품절 직전 10분 속도 × 그 상품 구간의 남은 시간.</p>` : '<p>방송 중 품절된 속성이 없어요.</p>'}</div>
<h2>E. 다음 액션 후보 (판단은 담당자)</h2><div class="c">${[['리오더 후보', m.acts.reorder], ['소진 필요', m.acts.clear]].map(([t, a]) => a.length ? `<b>${t}</b><ul>${a.map(o => `<li>${e(nm(o.p))} <b>${e(o.n)}</b> · ${e(o.why)}</li>`).join('')}</ul>` : '').join('') || '<p>공급과 판매 비중 차이가 10%p 넘는 컬러가 없어요.</p>'}${P.some(x => x.mx) ? `<b>다음 방송 배분안 (이번 판매비중, 상품 안 %)</b><div class="g">${P.filter(x => x.mx).map(x => `<div><div class="note">${e(nm(x.p))}</div>${mxHtml(x.mx, 'mx')}</div>`).join('')}</div>` : ''}</div>
<h2>팀 리뷰 형식 텍스트</h2><pre>${e(txt)}</pre>
<p class="note">준비수량 = 처음 기록한 시점의 미리+방송+주문가능(방송 중 수량이 늘면 더함). 소진률 = (준비수량−잔여)/준비수량. 분취·분공·달성률은 실적 화면 기준으로 따로 채워 주세요.</p>
</div></body></html>`;
  }
  function saveReport() {
    const m = summary(); if (!m) return toast('기록 없음', '이번 방송 시간대 기록이 없어요.');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([reportHtml(m)], { type: 'text/html' }));
    a.download = `속성레이더_리뷰_${[m.R.tag, pgmName(), cfg.brand && bName(cfg.brand)].filter(Boolean).join('_').replace(/[\\/:*?"<>|\s]+/g, '')}.html`; a.style.display = 'none'; document.body.appendChild(a); a.click(); setTimeout(() => { a.remove(); URL.revokeObjectURL(a.href); }, 1000);
  }

  // ---------- 폴더 자동 저장 (쉐어포인트/원드라이브 동기화 폴더 지정) ----------
  const DIR = { h: null, ok: false, last: 0, err: '' };
  const idb = (mode, fn) => new Promise((res, rej) => {
    const o = indexedDB.open('attrRadar', 1);
    o.onupgradeneeded = () => o.result.createObjectStore('kv');
    o.onerror = () => rej(o.error);
    o.onsuccess = () => { const tx = o.result.transaction('kv', mode), st = tx.objectStore('kv'), r = fn(st); tx.oncomplete = () => res(r && r.result); tx.onerror = () => rej(tx.error); };
  });
  async function dirInit() {
    try { DIR.h = await idb('readonly', st => st.get('dir')); if (DIR.h) DIR.ok = (await DIR.h.queryPermission({ mode: 'readwrite' })) === 'granted'; } catch (e) {}
  }
  async function dirPick() {
    if (!window.showDirectoryPicker) return toast('폴더 저장 불가', '이 브라우저에서는 폴더 저장을 쓸 수 없어요. CSV 내려받기를 써주세요.');
    try {
      DIR.h = await window.showDirectoryPicker({ id: 'attrRadar', mode: 'readwrite' });
      await idb('readwrite', st => st.put(DIR.h, 'dir'));
      DIR.ok = true; await dirSave(true); render();
    } catch (e) { if (e.name !== 'AbortError') toast('폴더 지정 실패', e.message); }
  }
  async function dirReconnect() {
    try { if (DIR.h && (await DIR.h.requestPermission({ mode: 'readwrite' })) === 'granted') { DIR.ok = true; await dirSave(true); } } catch (e) {}
    render();
  }
  async function writeFile(name, lines) {
    const fh = await DIR.h.getFileHandle(name, { create: true }), w = await fh.createWritable();
    await w.write('﻿' + (Array.isArray(lines) ? lines.join('\r\n') : lines)); await w.close();
  }
  async function dirSave(manual) {
    if (!DIR.ok || !DIR.h) return;
    const R = broadcastRange(), { rows, logs } = allRecords(R.from, R.to);
    if (!rows.length) return;
    try {
      // 폴더 파일명은 영문(동기화 폴더에서 한글 파일명이 깨지거나 거부되는 경우 대비)
      await writeFile(`attr-radar_${R.tag}_records.csv`, historyLines(rows));
      if (logs.length) await writeFile(`attr-radar_${R.tag}_alerts.csv`, logLines(logs));
      const m = summary(); if (m) { await writeFile(`attr-radar_${R.tag}_summary.txt`, summaryText(m).replace(/\n/g, '\r\n')); await writeFile(`attr-radar_${R.tag}_report.html`, reportHtml(m)); }
      DIR.last = Date.now(); DIR.err = '';
      if (manual) toast('폴더에 저장했어요', `attr-radar_${R.tag}_records.csv 외 리뷰 파일`);
    } catch (e) { DIR.err = e.message; DIR.ok = false; }
  }
  const dirTimer = setInterval(() => dirSave(false), 60000);

  // 방송이 끝나면 한 번 요약 탭을 열고 폴더에 최종 저장
  function checkEnd() {
    const bw = broadcastWindow();
    if (!bw || Date.now() < bw.en || S.endShown === bw.st) return;
    if (Date.now() - bw.en > 3 * 3600000) return; // 오래전 방송 화면은 제외
    S.endShown = bw.st; S.tab = 'sum';
    if (!(S.quiet > 0)) popup('📋 방송 종료', '방송 요약을 정리했어요. 요약 탭에서 텍스트를 복사할 수 있어요.', 'end'); // 끝난 뒤에 켰으면 팝업 없이 요약 탭만
    dirSave(false);
  }

  function exportCsv() {
    const head = ['시각', '상품', '컬러', '사이즈', '미리주문', '방송주문', '주문가능', `최근${cfg.win}분증가`];
    const rm = S.view ? new Map(S.view.D.list.map(x => [x.r.key, x.d])) : new Map();
    const lines = [head.join(',')].concat([...S.rows.values()].map(r => [hhmmss(Date.now()), r.prod, r.color, r.size, r.pre, r.live, r.avail, rm.get(r.key) || 0].map(v => `"${v ?? ''}"`).join(',')));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' }));
    a.download = `속성레이더_${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}.csv`; a.click();
  }

  // ---------- UI ----------
  const host = document.createElement('div');
  host.id = 'attr-radar-host';
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    :host{all:initial}
    .p{width:360px;max-height:70vh;position:relative;display:flex;flex-direction:column;background:#fff;color:#1f2328;border:1px solid #d0d7de;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.18);font:13px/1.45 'Pretendard Variable',Pretendard,'Malgun Gothic','Apple SD Gothic Neo',sans-serif,'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji';overflow:hidden}
    .hd{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#0088ff;color:#fff;cursor:move;user-select:none}
    .hd b{font-size:14px}.hd .meta{font-size:11px;opacity:.9;flex:1}
    .hd button{background:rgba(255,255,255,.2);border:0;color:#fff;border-radius:6px;padding:2px 7px;cursor:pointer;font-size:12px}
    .sum{padding:7px 12px;background:#eef7ff;border-bottom:1px solid #cfe6ff;font-weight:600}.sum .ln{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.more{color:#0088ff;font-size:11px;font-weight:400;cursor:pointer;background:none;border:0;padding:0;font-family:inherit}
    .st{padding:4px 12px;font-size:11px;color:#424a53;background:#f6f8fa;border-bottom:1px solid #eaeef2}.st .dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#1a9e6e;margin-right:5px}
    .band{padding:7px 12px;font-size:12px;border-bottom:1px solid;position:relative}.band.warn2{background:#fff8e6;border-color:#f5d48a;color:#7a4d00}.band.ok{background:#ecfbf3;border-color:#a7e3c4;color:#11663f}.band .x{position:absolute;right:8px;top:5px;border:0;background:none;cursor:pointer;color:inherit;font-size:13px}
    .hd .bb{background:#fff;color:#0088ff;font-weight:700}
    .menu{position:absolute;top:40px;right:8px;width:250px;max-height:60%;overflow:auto;background:#fff;border:1px solid #d0d7de;border-radius:10px;box-shadow:0 10px 26px rgba(0,0,0,.2);padding:6px;z-index:5}
    .menu .h{color:#6e7781;font-size:11px;padding:2px 8px}.menu button{display:flex;justify-content:space-between;width:100%;border:0;background:none;padding:6px 8px;border-radius:6px;cursor:pointer;font:inherit;text-align:left}.menu button:hover{background:#f3f9ff}.menu button.on{background:#e6f2ff;font-weight:700}.menu .lk{color:#0088ff;font-size:11px}
    .grip{height:9px;cursor:ns-resize;background:#f6f8fa;border-top:1px solid #eaeef2;text-align:center;font-size:9px;line-height:7px;color:#adb5bd;flex:0 0 auto}
    .cv{font-size:10px;background:#e6f2ff;color:#0062b8;border-radius:4px;padding:0 4px;margin-left:4px;font-weight:400}.cv.no{background:#fff1d6;color:#9a5b00}
    .jmp{display:flex;gap:4px;flex-wrap:wrap;margin:0 0 6px}.jmp button{border:1px solid #cfe6ff;background:#f3f9ff;color:#0062b8;border-radius:12px;padding:1px 8px;font:inherit;font-size:11px;font-weight:600;cursor:pointer}
    .sw{display:flex;justify-content:space-between;align-items:center;margin:4px 0}
    .tabs{display:flex;border-bottom:1px solid #eee}.tabs button{flex:1 0 auto;white-space:nowrap;border:0;background:none;padding:7px 6px;cursor:pointer;font:inherit;font-size:12px;color:#57606a}
    .tabs .sep{flex:0 0 1px;background:#e4e4e4;margin:7px 2px}.bdg:not(:empty){display:inline-block;margin-left:3px;min-width:15px;padding:0 4px;border-radius:8px;background:#0088ff;color:#fff;font-size:10px;line-height:15px;font-weight:700}
    .tabs button.on{color:#0088ff;font-weight:700;box-shadow:inset 0 -2px #0088ff}
    .bd{overflow:auto;padding:8px 12px}
    .prod{margin:4px 0 10px}.prod h4{margin:0 0 4px;font-size:13px;display:flex;justify-content:space-between}
    .colhd{position:sticky;top:-8px;background:#fff;z-index:1;border-bottom:1px solid #eee;margin-bottom:4px}.colhd span{font-size:11px;color:#6e7781;font-weight:400!important}
    .crow{display:grid;grid-template-columns:1fr 46px 32px 36px 44px 66px;gap:4px;align-items:center;padding:2px 0}.crow>*:not(:first-child){text-align:right;white-space:nowrap}
    .row{display:grid;grid-template-columns:1fr 46px auto;gap:6px;align-items:center;padding:2px 0}.row>span:last-child{white-space:nowrap;min-width:52px}
    .bar{height:6px;background:#cce7ff;border-radius:3px}.bar i{display:block;height:100%;background:#0088ff;border-radius:3px}
    .muted{color:#6e7781;font-size:11px}.up{color:#d1242f;font-weight:700}.dn{color:#2f6fde;font-weight:700}
    .lvb{font-style:normal;font-size:10px;font-weight:700;padding:0 4px;border-radius:3px}.lv1{background:#cfe3ff;color:#0b4a9e}.lv2{background:#ffe680;color:#6b4e00}.lv3{background:#ff3b30;color:#fff}.lv0{background:#eaeef2;color:#57606a}
    h5{margin:12px 0 6px;font-size:12px;color:#0088ff;border-top:1px solid #eaeef2;padding-top:8px}details{margin:2px 0 6px}summary{cursor:pointer;font-weight:600;font-size:12px}
    table.sh{width:100%;border-collapse:collapse;font-size:11px;margin:3px 0 6px}table.sh th,table.sh td{padding:2px 4px;text-align:right;border-bottom:1px solid #f0f2f4;white-space:nowrap}table.sh th{color:#6e7781;font-weight:600}table.mx td,table.mx th{text-align:center!important;border:1px solid #eaeef2}table.sh td:first-child,table.sh th:first-child{text-align:left;white-space:normal}.warn{color:#bc4c00;font-weight:700}
    table{border-collapse:collapse;width:100%;font-size:12px}td,th{border:1px solid #eee;text-align:center;padding:4px 2px}th{background:#fafafa}
    td small{display:block;color:#d1242f;font-size:10px}
    select,input{font:inherit;padding:2px 4px;border:1px solid #ccc;border-radius:4px}
    .set label{display:flex;justify-content:space-between;align-items:center;margin:5px 0}.set input{width:60px}
    .btns{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.btns button{border:1px solid #d0d7de;background:#f6f8fa;border-radius:6px;padding:4px 8px;cursor:pointer;font:inherit}
    .toasts{position:fixed;right:16px;top:16px;display:flex;flex-direction:column;gap:6px}
    .t{background:#1f2328;color:#fff;border-radius:8px;padding:8px 12px;width:330px;box-shadow:0 4px 14px rgba(0,0,0,.25);animation:f .25s}
    @keyframes f{from{opacity:0;transform:translateY(6px)}}
    .min .tabs,.min .bd,.min .grip,.min .st,.min .band{display:none}
    .p.wide{width:540px}
    .seg{display:inline-flex;border:1px solid #d0d7de;border-radius:6px;overflow:hidden;margin:0 6px 6px 0}.seg button{border:0;background:#fff;padding:3px 8px;cursor:pointer;font:inherit;font-size:12px;color:#57606a}.seg button.on{background:#0088ff;color:#fff}
    .lg{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px;margin-top:4px}.lg i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px}
    svg text{font:11px 'Pretendard Variable',Pretendard,'Malgun Gothic','Apple SD Gothic Neo',sans-serif;fill:#6e7781}
  </style><div class="toasts"></div><div class="p"><div class="hd"><b>속성 레이더</b><span class="meta"></span><button data-a="brand" class="bb" title="브랜드 고르기"></button><button data-a="quiet" title="조용히 모드"></button><button data-a="min" title="줄이기">_</button><button data-a="close" title="종료">×</button></div>
  <div class="st"></div><div class="bands"></div><div class="sum"></div><div class="tabs">${TAB_GROUPS.map(g => g.map(([k, l]) => `<button data-t="${k}">${l}<span class="bdg" data-b="${k}"></span></button>`).join('')).join('<i class="sep"></i>')}</div><div class="bd"></div><div class="grip" title="끌어서 높이 조절">═══</div><div class="menu" hidden></div></div>`;
  const $ = s => root.querySelector(s);

  function toast(title, msg) {
    const t = document.createElement('div'); t.className = 't';
    t.innerHTML = `<b>${esc(title)}</b><br>${esc(msg)}`;
    $('.toasts').prepend(t); setTimeout(() => t.remove(), 8000);
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // 늦게 켰을 때·제때 켰을 때 띠
  function bandsHtml() {
    const bw = broadcastWindow(), now = Date.now();
    if (!bw || now > bw.en + 60 * 60000) return '';
    const ft = firstRecT(bw);
    if (now > bw.st + 2 * 60000 && (ft === null || ft > bw.st + 2 * 60000)) {
      if (S.lateHide === bw.st) return '';
      return `<div class="band warn2"><button class="x" data-a="latex" title="닫기">✕</button>⏱ 방송 시작(${hhmmss(bw.st).slice(0, 5)}) 뒤 <b>${hhmmss(ft || S.startT).slice(0, 5)}</b>에 켜졌어요.<br>✔ 누적 판매·준비수량·잔여는 정상이에요.<br>✖ 그 전 시간대 흐름(구간·피크·품절 시각)은 없어요.</div>`;
    }
    if (ft !== null && ft <= bw.st && now - S.startT < 8000 && now < bw.en) return `<div class="band ok">✔ 방송 시작 ${Math.max(0, Math.round((bw.st - ft) / 60000))}분 전부터 기록 중이에요. 준비수량과 흐름이 모두 남아요.</div>`;
    return '';
  }
  function verBand() {
    if (!S.verMsg) return '';
    return `<div class="band ok"><button class="x" data-a="verx" title="닫기">✕</button>✔ 새 버전 v${VER}으로 열렸어요. 바뀐 점: ${esc(CHANGES)}</div>`;
  }
  function statusHtml() {
    const bw = broadcastWindow(), ft = bw ? firstRecT(bw) : null;
    const prods = [...new Set([...S.rows.values()].map(r => r.prod))], inP = prods.filter(inPgm), mine = inP.filter(inBrand), other = prods.length - inP.length;
    const cv = mine.filter(p => CONV[norm(p)]).length;
    return `<span class="dot"></span>${ft ? `${hhmmss(ft).slice(0, 5)}부터 기록 중` : '기록 중'}${bw ? ` · 방송 ${bw.label}` : ''}${mine.length ? ` · 전환율 ${cv}/${mine.length}` : ''}${cfg.brand ? `<br>${esc(bName(cfg.brand))}만 보는 중 · 다른 상품 ${inP.length - mine.length}개 숨김` : ''}${other ? `<br>${inP.length ? `다른 방송 상품 ${other}개는 숨겼어요` : '이 방송일시의 표를 아직 못 읽었어요. 조회를 누르면 보여요'}` : ''}`;
  }
  function menuHtml() {
    const cnt = new Map();
    [...new Set([...S.rows.values(), ...S.parked.values()].map(r => r.prod))].filter(inPgm).forEach(p => { const b = brandOf(p); cnt.set(b, (cnt.get(b) || 0) + 1); });
    if (cfg.brand && !cnt.has(cfg.brand)) cnt.set(cfg.brand, 0);
    const L = [...cnt.entries()].sort((a, b) => (a[0][0] === '✱') - (b[0][0] === '✱') || b[1] - a[1]);
    return `<div class="h">이 화면의 브랜드 (상품명 앞부분)</div>` + L.map(([b, n]) => `<button data-br="${esc(b)}" class="${cfg.brand === b ? 'on' : ''}"><span>${cfg.brand === b ? '✓ ' : ''}${esc(bName(b))}</span><span class="muted">${n}개 상품</span></button>${b[0] === '✱' ? `<button data-link="${esc(b.slice(1))}"><span class="lk">↳ 목록의 브랜드로 연결하기</span></button>` : ''}`).join('') +
      `<button data-br="" class="${cfg.brand ? '' : 'on'}" style="border-top:1px solid #eaeef2;margin-top:4px"><span>${cfg.brand ? '' : '✓ '}전체 보기</span><span class="muted">${[...cnt.values()].reduce((a, b) => a + b, 0)}개</span></button>`;
  }
  const saveUi = () => { cfg.ui.tab = S.tab; saveCfg(); };

  function render() {
    const v = S.view;
    const nFold = [...S.rows.values()].filter(r => isAgg(r) && inScope(r.prod)).length;
    $('.meta').textContent = S.lastScan ? `${hhmmss(S.lastScan)}${nFold ? ` · 접힌 상품 ${nFold}` : ''}` : '대기 중';
    $('[data-a=brand]').textContent = (cfg.brand ? bName(cfg.brand).replace(' (목록에 없음)', '') : '전체') + ' ▾';
    $('[data-a=quiet]').textContent = cfg.quietMode ? '🔕 조용히' : '🔔';
    $('[data-a=quiet]').title = cfg.quietMode ? '조용히 모드 끄기 (팝업 다시 보기)' : '조용히 모드 (팝업 없이 배지·알림 탭에만)';
    if (!$('.menu').hidden) $('.menu').innerHTML = menuHtml();
    root.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === S.tab));
    $('.st').innerHTML = statusHtml();
    $('.bands').innerHTML = verBand() + bandsHtml();
    if (!S.rows.size || !v || !v.P.length) {
      $('.sum').textContent = S.rows.size ? `${bName(cfg.brand)} 상품이 지금 표에 없어요. 브랜드 버튼에서 바꿀 수 있어요.` : '주문수량관리 표를 화면에 띄워주세요';
      $('.bd').innerHTML = S.tab === 'set' ? settingsHtml() : S.rows.size ? '' : `<p class="muted">세일즈원 실시간 판매현황의 주문수량관리 패널에서 속성 행을 읽어옵니다. ${cfg.interval}초마다 확인 중이에요.<br><br>계속 0개면 ⚙ 탭의 <b>진단 정보 복사</b>를 눌러 Claude에게 보내주세요.</p>`;
      return;
    }
    const top = v.top, s = v.D.list.find(x => live(x.r));
    const tp = v.P[0];
    const setB = (k, n) => { const e = root.querySelector(`[data-b="${k}"]`); if (e) e.textContent = n ? n : ''; };
    setB('sold', v.SO.length); setB('surge', v.D.list.filter(x => live(x.r) && x.d >= cfg.surge).length);
    // 위 요약: 컬러 1위·급상승 2줄, 나머지는 더보기
    const cTop = v.P.flatMap(x => (x.colors || []).slice(0, 1).map(o => ({ x, o }))).sort((a, b) => b.o.sum - a.o.sum)[0];
    const l1 = cTop ? `🎨 컬러 1위 ${esc(shortP(cTop.x.p))} <b>${esc(cTop.o.c)}</b> <span class="muted">${fmt(cTop.o.sum)}개</span>${cTop.o.jd ? ` <span class="up">${sg(cTop.o.jd)}</span>` : ''}` : `🏆 상품 1위 ${esc(shortP(tp.p))} <span class="muted">${fmt(tp.sum)}개</span>${tp.jd ? ` <span class="up">${sg(tp.jd)}</span>` : ''}`;
    const l2 = s ? `🔥 급상승 ${esc(short(s.r))} <span class="up">+${fmt(s.d)}</span><span class="muted"> / ${v.D.mins < 1 ? '1분 미만' : Math.round(v.D.mins) + '분'}</span>` : `🔥 급상승 <span class="muted">기록이 ${cfg.win}분 쌓이면 보여요</span>`;
    const jl = S.jump ? S.jump.list.filter(r => r.jd > 0 && inScope(r.prod)) : [];
    const rest = [cTop && `🏆 상품 1위 ${esc(shortP(tp.p))} <span class="muted">${fmt(tp.sum)}개</span>${tp.jd ? ` <span class="up">${sg(tp.jd)}</span>` : ''}`,
      top ? `🥇 속성 1위 ${esc(short(top))} <span class="muted">${fmt(metric(top))}개</span>` : '🥇 속성 1위 <span class="muted">상품이 모두 접혀 있음</span>',
      jl.length && `⏱️ 직전 대비(${hhmmss(S.jump.t)}) <span class="up">${sg(jl.reduce((a, r) => a + r.jd, 0))}</span> <span class="muted">${jl.slice(0, 3).map(r => esc(`${attrL(r)} ${sg(r.jd)}`)).join(' · ')}</span>`,
      v.SO.length && `⚠️ 품절임박 ${v.SO.length}개 (${[3, 2, 1].map(n => [n, v.SO.filter(x => x.lv === n).length]).filter(a => a[1]).map(([n, c]) => LV[n].icon + c).join(' ') || '예측'})`].filter(Boolean);
    $('.sum').innerHTML = `<div class="ln">${l1}</div><div class="ln">${l2}</div>` + (cfg.sumOpen ? rest.map(x => `<div class="ln">${x}</div>`).join('') + '<button class="more" data-a="more">접기 ▴</button>' : `<button class="more" data-a="more">더보기 ▾ (상품 1위 · 속성 1위 · 직전 대비${v.SO.length ? ` · 품절임박 ${v.SO.length}` : ''})</button>`);
    $('.p').classList.toggle('wide', S.tab === 'graph');
    // 탭이 한 줄에 다 들어가도록 패널 너비 자동 조정
    const tabs = $('.tabs'); $('.p').style.minWidth = '';
    if (tabs.scrollWidth > tabs.clientWidth) $('.p').style.minWidth = (tabs.scrollWidth + 2) + 'px';
    const body = { sum: summaryHtml, graph: graphHtml, prod: prodHtml, color: colorHtml, top: topHtml, surge: surgeHtml, sold: soldHtml, heat: heatHtml, log: logHtml, set: settingsHtml }[S.tab]();
    const st = $('.bd').scrollTop; $('.bd').innerHTML = body; $('.bd').scrollTop = st;
  }

  function topHtml() {
    const { P } = S.view, total = P.reduce((s, x) => s + x.sum, 0) || 1;
    return `<p class="muted" style="margin:0 0 6px">빨간 +숫자 = 직전 갱신 대비 더 나간 수량</p>` + P.map(({ p, rs, sum }) => {
      const lr = rs.filter(live);
      if (!lr.length) return `<div class="prod"><h4><span>${esc(p)}</span><span>${fmt(sum)} <span class="muted">${Math.round(sum / total * 100)}%</span></span></h4><div class="muted">접혀 있어 상품 합계만 추적 중이에요. 펼치면 속성별로 보여요.</div></div>`;
      const sorted = [...lr].sort((a, b) => metric(b) - metric(a)), mx = metric(sorted[0]) || 1;
      const by = f => { const m = {}; lr.forEach(r => m[r[f]] = (m[r[f]] || 0) + metric(r)); return Object.entries(m).sort((a, b) => b[1] - a[1])[0]; };
      const bc = by('color'), bs = by('size');
      return `<div class="prod"><h4><span>${esc(p)}</span><span>${fmt(sum)} <span class="muted">${Math.round(sum / total * 100)}%</span></span></h4>
        <div class="muted">베스트 컬러 <b>${esc(bc[0])}</b> ${fmt(bc[1])} · 베스트 사이즈 <b>${esc(bs[0])}</b> ${fmt(bs[1])}</div>
        ${sorted.slice(0, 5).map(r => `<div class="row"><span>${esc(attrL(r))}<div class="bar"><i style="width:${metric(r) / mx * 100}%"></i></div></span><b>${fmt(metric(r))}</b><span class="muted">${v_d(r)}</span></div>`).join('')}</div>`;
    }).join('');
  }
  const sg = n => (n > 0 ? '+' : '') + fmt(n);
  const v_d = r => (r.jd ? `<span class="up" title="직전 갱신 대비">${sg(r.jd)}</span>` : '');

  function prodHtml() {
    const { P } = S.view, total = P.reduce((a, x) => a + x.sum, 0) || 1, mx = P[0].sum || 1;
    return `<p class="muted" style="margin:0 0 6px">${cfg.metric}주문 합계순 · 빨간 +숫자 = 직전 갱신 대비</p>` + P.map((x, i) => {
      const t = [...x.rs].filter(live).sort((a, b) => metric(b) - metric(a))[0];
      const cv = CONV[norm(x.p.replace(/ \(\d+\)$/, ''))];
      return `<div class="prod"><h4><span>${i + 1}. ${esc(shortP(x.p))}${cv ? `<span class="cv" title="예상전환율 (방송실적관리 예상취급액÷총주문액)">전환 ${Math.round(cv.r * 100)}%</span>` : '<span class="cv no" title="방송실적관리 표가 보이면 읽어요">전환율 미확인</span>'}</span><span>${fmt(x.sum)} ${x.jd ? `<span class="up">${sg(x.jd)}</span>` : ''}</span></h4>
        <div class="bar"><i style="width:${x.sum / mx * 100}%"></i></div>
        <div class="muted" style="margin-top:3px">비중 ${Math.round(x.sum / total * 100)}% · 최근 ${S.view.D.mins < 1 ? '1분 미만' : Math.round(S.view.D.mins) + '분'} <span class="${x.win ? 'up' : ''}">+${fmt(x.win)}</span>${x.rate && S.view.D.mins >= 1 ? ` (${x.rate.toFixed(1)}/분)` : ''} · 잔여 ${fmt(x.avail)} · 소진 ${Math.round(x.pct)}%</div>
        <div class="muted">${t ? `1위 속성 <b>${esc(attrL(t))}</b> ${fmt(metric(t))}` : '접혀 있음 · 상품 합계만 추적 중'}</div></div>`;
    }).join('');
  }

  function colorHtml() {
    const { P } = S.view, L = P.filter(x => x.colors && x.colors.length);
    if (!L.length) return `<p class="muted">컬러 속성이 있는 상품이 없어요. (사이즈만 있는 상품은 제외)</p>`;
    const mins = S.view.D.mins;
    const w = mins < 1 ? '1분' : Math.round(mins) + '분';
    return `<p class="muted" style="margin:0 0 4px">상품별 컬러 ${cfg.metric}주문 합계순 · 👑 = 상품 안 1위</p>
      <div class="crow colhd"><span>컬러</span><span>판매</span><span>비중</span><span>직전</span><span>${w}</span><span>잔여</span></div>` + L.map(x => {
      const mx = x.colors[0].sum || 1, tot = x.colors.reduce((a, o) => a + o.sum, 0) || 1;
      const hot = [...x.colors].sort((a, b) => b.win - a.win)[0];
      return `<div class="prod"><h4><span>${esc(shortP(x.p))}</span><span>${fmt(x.sum)}</span></h4>
        ${x.colors.map((o, i) => `<div class="crow"><span>${i === 0 ? '👑 ' : ''}<b>${esc(o.c)}</b><div class="bar"><i style="width:${o.sum / mx * 100}%"></i></div></span><b>${fmt(o.sum)}</b><span class="muted">${Math.round(o.sum / tot * 100)}%</span><span class="${o.jd ? 'up' : 'muted'}">${o.jd ? sg(o.jd) : ''}</span><span class="${o.win ? 'up' : 'muted'}">+${fmt(o.win)}</span><span class="muted">${fmt(o.avail)}</span></div>`).join('')}
        ${hot && hot.win > 0 && hot !== x.colors[0] ? `<div class="muted">🔥 지금 반응은 <b>${esc(hot.c)}</b>가 가장 빨라요 (+${fmt(hot.win)})</div>` : ''}</div>`;
    }).join('') + `<p class="muted">판매 = ${cfg.metric}주문 누적 · 비중 = 상품 안 비중 · 직전 = 마지막 갱신 때 늘어난 수 · ${w} = 최근 ${w} 동안 늘어난 수 · 잔여 = 주문가능</p>`;
  }

  // 급상승: 최근 N분 동안 늘어난 양 순위. 상품 / 컬러 / 속성 단위 선택
  function surgeHtml() {
    const { D, P } = S.view, lv = S.surgeLv || 'attr';
    const seg = `<span class="seg">${[['prod', '상품'], ['color', '컬러'], ['attr', '속성']].map(([v, l]) => `<button data-sv="${v}" class="${lv === v ? 'on' : ''}">${l}</button>`).join('')}</span>`;
    let L;
    if (lv === 'prod') L = P.filter(x => x.win > 0).map(x => ({ n: shortP(x.p), d: x.win, rate: x.rate }));
    else if (lv === 'color') L = P.flatMap(x => (x.colors || []).filter(o => o.win > 0).map(o => ({ n: `${shortP(x.p)} ${o.c}`, d: o.win, rate: o.rate })));
    else L = D.list.filter(x => live(x.r)).map(x => ({ n: short(x.r), d: x.d, rate: x.rate }));
    L.sort((a, b) => b.d - a.d);
    const head = `${seg}<p class="muted" style="margin:0 0 6px">최근 ${D.mins < 1 ? '1분 미만' : Math.round(D.mins) + '분'} 동안 늘어난 ${cfg.metric}주문 순 (누적 순위는 상품·컬러·속성 탭)</p>`;
    if (!L.length) return head + `<p class="muted">최근 ${cfg.win}분 사이 늘어난 ${lv === 'prod' ? '상품' : lv === 'color' ? '컬러' : '속성'}이 아직 없어요. (기록 ${S.hist.length}회)</p>`;
    return head + `<div class="row colhd"><span>${lv === 'prod' ? '상품' : lv === 'color' ? '상품 · 컬러' : '상품 · 속성'}</span><span style="text-align:right">${Math.max(1, Math.round(D.mins))}분 증가</span><span>분당</span></div>` + L.slice(0, 10).map((x, i) => `<div class="row"><span>${i + 1}. ${esc(x.n)}</span><b class="up">+${fmt(x.d)}</b><span class="muted">${D.mins >= 1 ? x.rate.toFixed(1) + '/분' : ''}</span></div>`).join('');
  }

  function soldHtml() {
    const { SO } = S.view;
    const rule = `회사 기준: 소진율 70% 매진예상 · 80% 매진임박 · 95% 매진${usePred() ? ` + 예측: 잔여 ${cfg.soldQty}개 이하 또는 ${cfg.soldEta}분 내 소진 예상` : ''}`;
    if (!SO.length) return `<p class="muted">품절임박 속성 없음 (${rule})</p>`;
    const tag = x => (x.lv ? `<i class="lvb ${LV[x.lv].cls}">${LV[x.lv].name}</i>` : '<i class="lvb lv0">예측</i>');
    return `<div class="row colhd"><span>상품 · 속성</span><span>잔여</span><span>단계 · 소진율 · 남은 시간</span></div>` + SO.map(x => `<div class="row"><span>${esc(short(x.r))}</span><b class="warn">${fmt(x.avail)}</b><span class="muted">${tag(x)} ${Math.round(x.pct)}%${x.eta !== null ? ` · ${Math.ceil(x.eta)}분` : ''}</span></div>`).join('') +
      `<p class="muted">${rule}<br>잔여 = 주문가능 · % = 소진율 = 주문(미리+방송) ÷ (주문 + 주문가능) · 분 = 현재 속도면 남은 시간</p>`;
  }

  // ---------- 그래프: 상품별 시간대 판매량 (기록 기반) ----------
  const PAL = ['#0088ff', '#e8336d', '#1a9e6e', '#e8890c', '#8250df', '#0b9bb5', '#b35900', '#6e7781'];
  // 세일즈원 상단 '방송일시' (예: 2026-10-16 07:15 ~ 09:25) 읽기
  function pgmName() {
    const m = /프로그램명\s*\n+\s*([^\n]{1,40})/.exec(document.body.innerText.slice(0, 4000));
    return m ? norm(m[1]) : '';
  }
  // 이번 방송에서 처음 기록한 시각 (30초마다 다시 계산)
  function firstRecT(bw) {
    if (S.frt && S.frt.st === bw.st && S.frt.b === cfg.brand && Date.now() - S.frt.at < 30000) return S.frt.t;
    const { rows } = allRecords(bw.st - 30 * 60000, bw.en + 60 * 60000), r = rows.find(x => inScope(x.key.split('|')[0]));
    S.frt = { st: bw.st, b: cfg.brand, at: Date.now(), t: r ? r.t : null };
    return S.frt.t;
  }
  function broadcastWindow() {
    const texts = [...document.querySelectorAll('input')].map(i => i.value).concat([document.body.innerText.slice(0, 5000)]);
    for (const t of texts) {
      const m = /(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})\s*~\s*(\d{1,2}):(\d{2})/.exec(t || '');
      if (!m) continue;
      const st = new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]).getTime();
      let en = new Date(+m[1], m[2] - 1, +m[3], +m[6], +m[7]).getTime();
      if (en <= st) en += 864e5; // 자정 넘는 방송
      return { st, en, label: `${m[4].padStart(2, '0')}:${m[5]}~${m[6].padStart(2, '0')}:${m[7]}` };
    }
    return null;
  }
  function graphSeries(bucketMin) {
    const prods = S.view.P.map(x => x.p), pset = new Set(prods);
    const B = bucketMin * 60000, now = Date.now();
    const ch = REC.ch.filter(c => pset.has(REC.keys[c[1]].split('|')[0]));
    if (!ch.length) return null;
    // 방송 시작~종료가 기준. 방송일시를 못 읽으면 첫 기록부터 지금까지
    const bw = broadcastWindow();
    const from = bw && bw.st < now ? bw.st : ch[0][0];
    const to = bw && bw.st < now ? bw.en : now;
    const startT = Math.floor(from / B) * B;
    const n = Math.max(1, Math.ceil((Math.min(now, to) - startT) / B));
    const nAxis = Math.max(n, Math.ceil((to - startT) / B));
    const inc = prods.map(() => new Array(n).fill(0)), cum = prods.map(() => new Array(n).fill(null));
    const last = new Map(), pIdx = new Map(prods.map((p, i) => [p, i]));
    const val = c => (cfg.metric === '총' ? c[2] + c[3] : c[3]);
    let ci = 0;
    const prodTotal = i => { let s = 0; last.forEach((v, k) => { if (REC.keys[k].split('|')[0] === prods[i]) s += v; }); return s; };
    for (let b = 0; b < n; b++) {
      const end = startT + (b + 1) * B;
      while (ci < ch.length && ch[ci][0] < end) {
        const c = ch[ci++], pi = pIdx.get(REC.keys[c[1]].split('|')[0]), v = val(c);
        // 구간 시작 전 기록은 기준값으로만 사용, 처음 보는 속성의 첫 값은 판매로 세지 않음
        // '(접힘)' 줄은 펼칠 때 0으로 돌아가며 속성 증가분과 상쇄되므로 음수도 반영
        if (c[0] >= startT && last.has(c[1])) inc[pi][b] += REC.keys[c[1]].endsWith('|' + AGG) ? v - last.get(c[1]) : Math.max(0, v - last.get(c[1]));
        last.set(c[1], v);
      }
      prods.forEach((_, i) => { cum[i][b] = prodTotal(i); });
    }
    inc.forEach(a => a.forEach((x, i) => { if (x < 0) a[i] = 0; }));
    // 방송 시간 안에서 지금 상품들이 실제로 팔린 구간만 보여줌 (주방송상품 구간에 맞춤)
    const any = b => inc.some(a => a[b] > 0);
    let s0 = 0; while (s0 < n - 1 && !any(s0)) s0++;
    let s1 = n - 1;
    if (!(bw && now <= bw.en)) while (s1 > s0 && !any(s1)) s1--; // 방송이 끝났으면 마지막 판매까지
    s0 = Math.max(0, s0 - 1);
    const cut = a => a.map(arr => arr.slice(s0, s1 + 1));
    const m = s1 - s0 + 1;
    const span = t => new Date(t).toTimeString().slice(0, 5);
    return { prods, startT: startT + s0 * B, B, n: m, nAxis: m, inc: cut(inc), cum: cut(cum),
      label: `${bw && bw.st < now ? `방송 ${bw.label} 중 ` : ''}판매 구간 ${span(startT + s0 * B)}~${span(startT + (s1 + 1) * B)}` };
  }
  function graphHtml() {
    const g = S.g || (S.g = { mode: 'rate', bucket: 1 });
    const seg = (k, opts) => `<span class="seg">${opts.map(([v, l]) => `<button data-g="${k}:${v}" class="${String(g[k]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</span>`;
    const ctl = seg('mode', [['rate', '구간별 판매'], ['cum', '누적']]) + seg('bucket', [[1, '1분'], [3, '3분'], [5, '5분']]);
    const d = graphSeries(g.bucket);
    if (!d || d.n < 2) return ctl + `<p class="muted">기록이 쌓이는 중이에요. ${g.bucket}분 이상 지나면 그래프가 그려져요.</p>`;
    const ys = g.mode === 'rate' ? d.inc : d.cum;
    const W = 510, H = 230, L = 44, R = 8, T = 10, Bm = 24, iw = W - L - R, ih = H - T - Bm;
    const vmax = Math.max(1, ...ys.flat().filter(v => v !== null));
    const step = Math.pow(10, Math.floor(Math.log10(vmax))) * ([1, 2, 5, 10].find(m => vmax / (Math.pow(10, Math.floor(Math.log10(vmax))) * m) <= 5) || 10);
    const ymax = Math.ceil(vmax / step) * step;
    const x = i => L + (d.nAxis <= 1 ? iw / 2 : i / (d.nAxis - 1) * iw), y = v => T + ih - v / ymax * ih;
    let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
    for (let v = 0; v <= ymax; v += step) svg += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#eee"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`;
    const every = Math.max(1, Math.ceil(d.nAxis / 6));
    for (let i = 0; i < d.nAxis; i += every) svg += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${new Date(d.startT + (i + 1) * d.B).toTimeString().slice(0, 5)}</text>`;
    d.prods.forEach((p, pi) => {
      const col = PAL[pi % PAL.length], pts = ys[pi].slice(0, d.n).map((v, i) => [x(i), y(v || 0), v || 0, i]);
      svg += `<polyline fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" points="${pts.map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' ')}"/>`;
      pts.forEach(q => { svg += `<circle cx="${q[0]}" cy="${q[1]}" r="${d.n > 40 ? 1.5 : 2.5}" fill="${col}"><title>${esc(shortP(p))} ${new Date(d.startT + (q[3] + 1) * d.B).toTimeString().slice(0, 5)}까지 ${g.mode === 'rate' ? '+' : ''}${fmt(q[2])}</title></circle>`; });
    });
    svg += '</svg>';
    const lg = `<div class="lg">${d.prods.map((p, pi) => {
      const lastV = ys[pi][d.n - 1] || 0;
      return `<span><i style="background:${PAL[pi % PAL.length]}"></i>${esc(shortP(p))} <b>${g.mode === 'rate' ? '+' : ''}${fmt(lastV)}</b></span>`;
    }).join('')}</div>`;
    return ctl + `<span class="muted">${esc(d.label)}</span>` + svg + lg + `<p class="muted">${g.mode === 'rate' ? `${g.bucket}분마다 팔린 ${cfg.metric}주문 수량` : `${cfg.metric}주문 누적`} · 점에 마우스를 올리면 수치 · 레이더가 꺼져 있던 시간은 다시 켠 구간에 몰려서 보여요</p>`;
  }

  function heatHtml() {
    const { P } = S.view;
    if (!S.heatProd || !P.find(x => x.p === S.heatProd)) S.heatProd = P[0].p;
    const rs = P.find(x => x.p === S.heatProd).rs.filter(live);
    if (!rs.length) return `<select data-heat>${P.map(x => `<option ${x.p === S.heatProd ? 'selected' : ''}>${esc(x.p)}</option>`).join('')}</select><p class="muted">이 상품은 접혀 있어 컬러·사이즈별 수치가 없어요. 펼치면 다시 보여요.</p>`;
    const colors = [...new Set(rs.map(r => r.color))].sort((a, b) => rs.filter(r => r.color === b).reduce((s, r) => s + metric(r), 0) - rs.filter(r => r.color === a).reduce((s, r) => s + metric(r), 0));
    const sizes = [...new Set(rs.map(r => r.size))].sort((a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0) || a.localeCompare(b));
    const mx = Math.max(...rs.map(metric), 1);
    return `<select data-heat>${P.map(x => `<option ${x.p === S.heatProd ? 'selected' : ''}>${esc(x.p)}</option>`).join('')}</select>
      <table style="margin-top:6px"><tr><th></th>${sizes.map(z => `<th>${esc(z)}</th>`).join('')}</tr>
      ${colors.map(c => `<tr><th>${c === '-' ? '전체' : esc(c)}</th>${sizes.map(z => {
        const r = rs.find(r => r.color === c && r.size === z);
        if (!r) return '<td class="muted">·</td>';
        const a = metric(r) / mx, d = r.jd;
        return `<td style="background:rgba(0,136,255,${(0.08 + a * 0.85).toFixed(2)});color:${a > 0.55 ? '#fff' : '#1f2328'}">${fmt(metric(r))}${d ? `<small style="color:${a > 0.55 ? '#fff' : ''}">${sg(d)}</small>` : ''}</td>`;
      }).join('')}</tr>`).join('')}</table><p class="muted">진할수록 많이 팔림 · 작은 숫자는 직전 갱신 대비 증가</p>`;
  }

  function logHtml() {
    // 브랜드를 고르면 그 브랜드 알림만 (상품을 안 적어 둔 옛 알림은 내용 앞 상품명으로 판단)
    const names = [...new Set([...S.rows.values(), ...S.parked.values()].map(r => r.prod))].sort((a, b) => shortP(b).length - shortP(a).length);
    const logP = l => l.p || names.find(p => l.msg.startsWith(shortP(p)));
    const LG = S.log.filter(l => { const p = logP(l); return !p || inScope(p); });
    return LG.length ? LG.map(l => `<div><span class="muted">${hhmmss(l.t)}</span> <b>${esc(l.title)}</b> ${esc(l.msg)}</div>`).join('') : '<p class="muted">아직 알림이 없어요.</p>';
  }

  function settingsHtml() {
    const f = (k, l, u) => `<label>${l}<span><input data-k="${k}" type="number" value="${cfg[k]}"> ${u}</span></label>`;
    return `<div class="set">
      <label>기준 지표<select data-k="metric"><option ${cfg.metric === '방송' ? 'selected' : ''}>방송</option><option ${cfg.metric === '총' ? 'selected' : ''}>총</option></select></label>
      ${f('interval', '표 확인 간격', '초')}${f('win', '급상승 비교 구간', '분')}${f('surge', '급상승 알림 기준', '개 이상')}
      <label>품절임박 기준<select data-k="soldMode"><option ${cfg.soldMode !== '회사+예측' ? 'selected' : ''}>회사</option><option ${cfg.soldMode === '회사+예측' ? 'selected' : ''}>회사+예측</option></select></label>
      <div class="muted">회사 = 생판종 매진 기준(소진율 70% 매진예상 · 80% 매진임박 · 95% 매진). 회사+예측 = 여기에 아래 두 기준을 더해 더 일찍 알려요(대신 알림이 늘어요).</div>
      ${f('soldQty', '예측: 잔여', '개 이하')}${f('soldEta', '예측: 소진 예상', '분 이내')}
      <h4 style="margin:12px 0 4px">🔔 팝업으로 받을 알림</h4>
      ${[['prod', '🏆 상품 1위 교체'], ['color', '🎨 컬러 1위 교체'], ['attr', '🥇 속성 1위 교체'], ['surge', '🔥 급상승'], ['sold', '⚠️ 품절임박'], ['end', '📋 방송 종료 요약']].map(([k, l]) => `<label>${l}<input data-al="${k}" type="checkbox" ${cfg.al[k] !== false ? 'checked' : ''} style="width:auto"></label>`).join('')}
      <div class="muted">끈 알림도 알림 탭에는 남아요. 제목줄 🔔를 누르면 모든 팝업을 잠시 멈춰요(조용히 모드).</div>
      <h4 style="margin:12px 0 4px">🏷 브랜드 이름 연결</h4>
      <div class="muted">${Object.keys(cfg.alias).length ? Object.entries(cfg.alias).map(([a, b]) => `${esc(a)} → ${esc(b)}`).join(' · ') : '직접 연결한 이름 없음'}</div>
      ${Object.keys(cfg.alias).length ? '<div class="btns"><button data-a="aliasreset">연결 지우기</button></div>' : ''}
      ${f('autoRefresh', '새로고침 자동 클릭 (0=끔)', '초')}
      <div class="muted">새로고침 버튼: ${cfg.refreshSel ? '지정됨' : '미지정'}</div>
      <div class="btns"><button data-a="pick">새로고침 버튼 지정</button></div>
      <h4 style="margin:12px 0 4px">📁 폴더 자동 저장</h4>
      <div class="muted">쉐어포인트·원드라이브와 동기화된 PC 폴더를 지정하면 1분마다 이번 방송 기록·알림·요약 파일을 덮어써서 저장해요.</div>
      <div class="muted">${DIR.ok ? `✅ 연결됨: ${esc(DIR.h.name)}${DIR.last ? ` · 마지막 저장 ${hhmmss(DIR.last)}` : ''}` : DIR.h ? `⏸ ${esc(DIR.h.name)} 다시 연결 필요 (브라우저를 새로 열면 한 번 눌러줘야 해요)` : '지정된 폴더 없음'}${DIR.err ? ` · 오류: ${esc(DIR.err)}` : ''}</div>
      <div class="btns">${DIR.h && !DIR.ok ? '<button data-a="reconnect">다시 연결</button>' : ''}<button data-a="folder">${DIR.h ? '폴더 바꾸기' : '저장 폴더 지정'}</button>${DIR.ok ? '<button data-a="save">지금 저장</button>' : ''}</div>
      <h4 style="margin:12px 0 4px">⬇️ CSV 내려받기</h4>
      <div class="btns"><button data-a="hist">이번 방송 기록</button><button data-a="histall">최근 7일 기록</button><button data-a="logcsv">이번 방송 알림</button><button data-a="logall">최근 7일 알림</button><button data-a="csv">현재 수량</button></div>
      <div class="muted" style="margin-top:6px">브라우저 보관: 오늘 ${fmt(REC.ch.length)}건 · 7일간 · 이번 방송 = 방송일시 30분 전~종료 1시간 후</div>
      <div class="btns" style="margin-top:4px"><button data-a="reset">오늘 기록 초기화</button><button data-a="diag">진단 정보 복사</button></div></div>`;
  }

  // 이벤트
  root.addEventListener('click', e => {
    const t = e.target.closest('[data-t]'); if (t) { S.tab = t.dataset.t; saveUi(); return render(); }
    const br = e.target.closest('[data-br]'); if (br) { cfg.brand = br.dataset.br; saveCfg(); $('.menu').hidden = true; resetView(); return; }
    const lk = e.target.closest('[data-link]'); if (lk) {
      const w = lk.dataset.link, b = prompt(`"${w}"는 목록의 어떤 브랜드인가요? (예: 모르간)`, '');
      if (b && b.trim()) { const hit = BRANDS.find(x => bkey(x) === bkey(b)) || b.trim(); cfg.alias[w] = hit; saveCfg(); BTAB = null; BCACHE.clear(); if (cfg.brand === '✱' + w) cfg.brand = hit; saveCfg(); resetView(); }
      return;
    }
    const j = e.target.closest('[data-j]'); if (j) { const el = root.getElementById('s' + j.dataset.j); if (el) $('.bd').scrollTop = el.offsetTop - $('.bd').offsetTop - 4; return; }
    const al = e.target.closest('[data-al]'); if (al) { cfg.al[al.dataset.al] = al.checked; saveCfg(); return; }
    const sv = e.target.closest('[data-sv]'); if (sv) { S.surgeLv = sv.dataset.sv; return render(); }
    const gb = e.target.closest('[data-g]'); if (gb) { const [k, v] = gb.dataset.g.split(':'); S.g[k] = k === 'mode' ? v : Number(v); return render(); }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'min') {
      // 제자리에서 접기/펴기: 제목줄 위치(위·오른쪽)를 그대로 두고, 화면 밖으로 나가면 안쪽으로 당김
      const before = host.getBoundingClientRect();
      const m = $('.p').classList.toggle('min');
      $('[data-a=min]').textContent = m ? '▲' : '_';
      $('[data-a=min]').title = m ? '펼치기' : '줄이기';
      const h = host.getBoundingClientRect().height;
      host.style.left = host.style.top = '';
      host.style.right = Math.max(0, innerWidth - before.right) + 'px';
      host.style.bottom = Math.max(0, innerHeight - (before.top + h)) + 'px';
    }
    if (a === 'close') api.destroy();
    if (a === 'brand') { const mn = $('.menu'); mn.hidden = !mn.hidden; if (!mn.hidden) mn.innerHTML = menuHtml(); }
    if (a === 'quiet') { cfg.quietMode = !cfg.quietMode; saveCfg(); if (cfg.quietMode) $('.toasts').innerHTML = ''; render(); }
    if (a === 'more') { cfg.sumOpen = !cfg.sumOpen; saveCfg(); render(); }
    if (a === 'verx') { S.verMsg = false; render(); }
    if (a === 'latex') { const bw = broadcastWindow(); S.lateHide = bw && bw.st; render(); }
    if (a === 'aliasreset' && confirm('직접 연결한 브랜드 이름을 모두 지울까요?')) { cfg.alias = {}; saveCfg(); BTAB = null; BCACHE.clear(); resetView(); }
    if (a === 'pick') pickRefresh();
    if (a === 'csv') exportCsv();
    if (a === 'hist') exportHistory(false);
    if (a === 'histall') exportHistory(true);
    if (a === 'logcsv') exportLog(false);
    if (a === 'logall') exportLog(true);
    if (a === 'folder') dirPick();
    if (a === 'reconnect') dirReconnect();
    if (a === 'save') dirSave(true);
    if (a === 'report') saveReport();
    if (a === 'sumcopy') { const m = summary(); if (m) navigator.clipboard?.writeText(summaryText(m)).then(() => toast('리뷰 텍스트 복사됨', 'Teams에 붙여넣고 분취·분공을 채우면 돼요.'), () => prompt('복사해 주세요', summaryText(m))); }
    if (a === 'diag') diag();
    if (a === 'reset' && confirm('오늘 쌓인 기록을 모두 지울까요? 필요하면 먼저 CSV로 내려받으세요.')) {
      S.rows.clear(); S.hist = []; S.log = []; S.lastTop = null; S.alerted.clear();
      REC.keys = []; REC.idx.clear(); REC.ch = []; REC.log = []; try { localStorage.removeItem(REC.key); } catch (e) {}
      render();
    }
  });
  // 요약 C의 상품 펼침 상태 기억 (화면을 다시 그려도 유지)
  root.addEventListener('toggle', e => { const d = e.target; if (d.dataset && d.dataset.dp !== undefined) S.detOpen.set(d.dataset.dp, d.open); }, true);
  root.addEventListener('change', e => {
    if (e.target.dataset.heat !== undefined) { S.heatProd = e.target.value; return render(); }
    if (e.target.dataset.al !== undefined) return;
    const k = e.target.dataset.k; if (!k) return;
    cfg[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'number' ? Number(e.target.value) : e.target.value;
    saveCfg(); setupRefresh(); startLoop();
    if (k === 'metric') { S.hist = []; }
  });
  // 드래그
  (() => {
    let sx, sy, ox, oy;
    $('.hd').addEventListener('mousedown', e => {
      if (e.target.tagName === 'BUTTON') return;
      const r = host.getBoundingClientRect(); sx = e.clientX; sy = e.clientY; ox = innerWidth - r.right; oy = innerHeight - r.bottom;
      // 우하단 기준으로 옮겨서 줄이거나 펼쳐도 아래·오른쪽 모서리가 고정되게
      const mv = ev => { host.style.right = Math.max(0, ox - (ev.clientX - sx)) + 'px'; host.style.bottom = Math.max(0, oy - (ev.clientY - sy)) + 'px'; };
      const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); cfg.ui.right = host.style.right; cfg.ui.bottom = host.style.bottom; saveCfg(); };
      document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    });
    // 아래 손잡이: 위쪽 모서리는 그대로 두고 높이 조절
    $('.grip').addEventListener('mousedown', e => {
      e.preventDefault();
      const p = $('.p'), y0 = e.clientY, h0 = p.getBoundingClientRect().height, b0 = parseFloat(host.style.bottom) || 16;
      const mv = ev => { const dy = ev.clientY - y0, h = Math.max(220, Math.min(innerHeight - 20, h0 + dy)); p.style.maxHeight = 'none'; p.style.height = h + 'px'; host.style.bottom = Math.max(0, b0 - (h - h0)) + 'px'; };
      const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); cfg.ui.h = parseFloat($('.p').style.height) || null; cfg.ui.bottom = host.style.bottom; saveCfg(); };
      document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    });
  })();
  // 마지막 위치·높이 (화면 밖이면 기본 위치)
  if (cfg.ui.right && parseFloat(cfg.ui.right) < innerWidth - 100) host.style.right = cfg.ui.right;
  if (cfg.ui.bottom && parseFloat(cfg.ui.bottom) < innerHeight - 100) host.style.bottom = cfg.ui.bottom;
  if (cfg.ui.h) { $('.p').style.maxHeight = 'none'; $('.p').style.height = Math.min(cfg.ui.h, innerHeight - 20) + 'px'; }

  function resetView() {
    S.lastTop = null; S.lastTopProd = null; S.prodSums = null; S.colSums = null; S.lastTopCol = new Map(); S.prodJd = new Map(); S.colJd = new Map(); S.quiet = Math.max(S.quiet, 1); S.frt = null;
    if (S.rows.size) analyze(); else render();
  }
  let loop;
  function startLoop() { clearInterval(loop); loop = setInterval(scan, Math.max(cfg.interval, 2) * 1000); }

  const api = {
    ver: VER,
    show() { host.style.display = ''; },
    toggle() { host.style.display = host.style.display === 'none' ? '' : 'none'; },
    // 닫기 = 완전 종료 (감시·자동 새로고침 중지). 기록은 브라우저에 남아 다음 실행 때 이어짐
    destroy() { clearInterval(dirTimer); clearInterval(loop); clearInterval(refreshTimer); recSave(); host.remove(); delete window.__attrRadar; },
    scan, state: S, _dir: DIR, _save: dirSave,
  };
  window.__attrRadar = api;
  S.startT = Date.now();
  if (cfg.lastVer && cfg.lastVer !== VER) S.verMsg = true;
  if (cfg.lastVer !== VER) { cfg.lastVer = VER; saveCfg(); }
  document.documentElement.appendChild(host);
  dirInit().then(render);
  recLoad(); if (S.rows.size) snapshot(); render(); scan(); startLoop(); setupRefresh();
})();
