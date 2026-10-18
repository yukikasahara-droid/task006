/**
 * OriHime 検査・修理管理（スプレッドシート用 Google Apps Script）
 *
 * できること
 *   1. 検査シート … OK / △ / NG に☑して「保存して判定する」に☑ → 合否を自動判定
 *   2. 修理シート … 要修理の機体を自動登録（修理内容・必要部品つき）、進捗を管理
 *   3. 履歴ガント … 機体ごとの「検査・修理待ち・修理中・完了」を日付で表示
 *
 * 動きのきっかけ
 *   ・セルを編集したとき onEdit(e) が自動で呼ばれる（シンプルトリガー）
 *   ・☑のセルを「ボタン」として使う（スマホ・iPad でも動くため）
 *   ・メニュー「OriHime管理」からも同じ操作ができる
 *
 * レイアウト（行・列の位置）は下の LAYOUT にまとめてある。
 * シートの見た目を変えて位置がずれたら、ここの数字を合わせればよい。
 */

// ============================================================
// 設定（シート名・セル位置・ステータス名）
// ============================================================

const SHEET = {
  INSPECT: '検査シート',
  REPAIR: '修理シート',
  GANTT: '履歴ガント',
  STOCK: '部品在庫',
  LOG: '検査記録',
  LOG_DETAIL: '検査明細',
  PARTS: '修理部品明細',
  MASTER: '検査項目マスタ',
  NG_MASTER: 'NG詳細マスタ',
};

// 修理のステータス（修理シートのプルダウンと同じ文字にすること）
const STATUS = {
  TODO: '未着手',
  WAIT_PARTS: '部品待ち',
  DOING: '修理中',
  DONE: '修理完了（再検査待ち）',
  CLOSED: 'クローズ',
};

// 判定結果
const JUDGE = {
  OK: '合格',
  OK_WATCH: '合格（△あり）',
  NG: '要修理',
};

const LAYOUT = {
  // --- 検査シート ---
  inspect: {
    date: 'C3',        // 検査日
    inspector: 'C4',   // 検査者
    reason: 'C5',      // 検査理由
    device: 'C6',      // 検査端末
    model: 'E3',       // 機種
    serial: 'E4',      // 機体番号（シリアル）
    mgmtNo: 'E5',      // 管理番号
    origin: 'E6',      // 返却元・症状
    previous: 'C7',    // 前回の記録（自動表示）
    judge: 'C8',       // 判定結果（自動表示）
    message: 'D8',     // メッセージ（自動表示）
    btnAllOk: 'I4',    // ☑ 未入力の項目をOKにする
    btnSave: 'I5',     // ☑ 保存して判定する
    btnClear: 'I6',    // ☑ 入力をクリアする
    firstRow: 12,      // 検査項目の1行目
    maxRows: 100,      // 検査項目の最大数
    // 検査項目の列番号（A=1）
    col: { no: 1, flow: 2, item: 3, criteria: 4, method: 5, ok: 6, watch: 7, ng: 8, detail: 9, memo: 10 },
  },
  // --- 修理シート ---
  repair: {
    firstRow: 7,
    col: {
      id: 1, date: 2, model: 3, serial: 4, mgmtNo: 5, inspectId: 6, origin: 7, ngItems: 8,
      work: 9, parts: 10, status: 11, staff: 12, start: 13, end: 14, reinspectId: 15, memo: 16,
    },
    numCols: 16,
  },
  // --- 履歴ガント ---
  gantt: {
    startDate: 'C2',   // 表示開始日（空欄なら30日前から）
    days: 'E2',        // 表示日数
    btnUpdate: 'G2',   // ☑ ガントを更新
    monthRow: 4,
    headerRow: 5,
    firstRow: 6,
    firstDateCol: 5,   // E列から日付
  },
};

// ガントの記号と色（強いものほど優先して表示）
const GANTT_MARK = {
  NG: { text: 'NG', bg: '#F4C7C3', rank: 5 },  // 検査（要修理）
  OK: { text: '検', bg: '#B7E1CD', rank: 4 },  // 検査（合格）
  DONE: { text: '完', bg: '#A4C2F4', rank: 3 }, // 修理完了日
  DOING: { text: '修', bg: '#F9CB9C', rank: 2 }, // 修理中
  WAIT: { text: '待', bg: '#FCE8B2', rank: 1 }, // 修理待ち（未着手・部品待ち）
};

const TZ = 'Asia/Tokyo';

// ============================================================
// メニューと自動実行（トリガー）
// ============================================================

/** スプレッドシートを開いたときにメニューを追加する */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('OriHime管理')
    .addItem('未入力の項目をOKにする', 'menuAllOk')
    .addItem('保存して判定する', 'menuSave')
    .addItem('入力をクリアする', 'menuClear')
    .addSeparator()
    .addItem('検査項目をマスタから読み込み直す', 'menuReloadChecklist')
    .addItem('履歴ガントを更新する', 'rebuildGantt')
    .addToUi();
  // 検査日を今日にしておく（前日の日付のまま保存しないように）
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET.INSPECT);
  if (sh) sh.getRange(LAYOUT.inspect.date).setValue(today());
}

function menuAllOk() { setAllOk(); }
function menuSave() { saveInspection(); }
function menuClear() { clearInspection(true); }
function menuReloadChecklist() {
  const sh = getSheet(SHEET.INSPECT);
  loadChecklist(String(sh.getRange(LAYOUT.inspect.model).getValue()));
}

/** セルを編集するたびに自動で呼ばれる */
function onEdit(e) {
  if (!e || !e.range) return;
  const range = e.range;
  const name = range.getSheet().getName();
  const single = range.getNumRows() === 1 && range.getNumColumns() === 1;
  const a1 = range.getA1Notation();
  const checked = e.value === 'TRUE';

  try {
    if (name === SHEET.INSPECT) {
      const L = LAYOUT.inspect;
      if (single && checked && a1 === L.btnAllOk) { uncheck(range); setAllOk(); return; }
      if (single && checked && a1 === L.btnSave) { uncheck(range); saveInspection(); return; }
      if (single && checked && a1 === L.btnClear) { uncheck(range); clearInspection(true); return; }
      if (single && a1 === L.model) { onModelChanged(e); return; }
      if (single && a1 === L.serial) { onSerialEntered(); return; }
      // OK / △ / NG はどれか1つだけ☑にする
      const c = range.getColumn();
      if (single && checked && range.getRow() >= L.firstRow && [L.col.ok, L.col.watch, L.col.ng].indexOf(c) >= 0) {
        [L.col.ok, L.col.watch, L.col.ng].forEach(function (other) {
          if (other !== c) range.getSheet().getRange(range.getRow(), other).setValue(false);
        });
      }
      return;
    }

    if (name === SHEET.REPAIR) {
      const R = LAYOUT.repair;
      if (range.getLastRow() < R.firstRow) return;
      const c1 = range.getColumn();
      const c2 = range.getLastColumn();
      const touches = function (col) { return c1 <= col && col <= c2; };
      if (touches(R.col.status)) autofillRepairDates(range);
      // ガントに関係する列（登録日・機体番号・ステータス・着手日・完了日）を変えたときだけ更新
      if ([R.col.date, R.col.serial, R.col.status, R.col.start, R.col.end].some(touches)) rebuildGantt();
      return;
    }

    if (name === SHEET.GANTT) {
      const G = LAYOUT.gantt;
      if (single && checked && a1 === G.btnUpdate) { uncheck(range); rebuildGantt(); return; }
      if (single && (a1 === G.startDate || a1 === G.days)) rebuildGantt();
    }
  } catch (err) {
    notify('エラー: ' + err.message, true);
    throw err;
  }
}

// ============================================================
// 検査シート
// ============================================================

/** 機種を変えたら検査項目を読み込み直す（入力途中なら元に戻す） */
function onModelChanged(e) {
  const sh = getSheet(SHEET.INSPECT);
  if (countEnteredResults() > 0) {
    sh.getRange(LAYOUT.inspect.model).setValue(e.oldValue || '');
    notify('結果を入力中のため機種を切り替えませんでした。「入力をクリアする」をしてから変えてください。', true);
    return;
  }
  loadChecklist(String(e.value || ''));
}

/** 検査項目マスタから、指定した機種の検査項目を検査シートに並べる */
function loadChecklist(model) {
  const sh = getSheet(SHEET.INSPECT);
  const L = LAYOUT.inspect;
  const area = sh.getRange(L.firstRow, 1, L.maxRows, 10);
  area.clearContent();
  area.clearDataValidations();
  if (!model) { notify('機種を選んでください。'); return; }

  const items = getMasterItems(model);
  if (items.length === 0) {
    notify('「' + model + '」の検査項目が検査項目マスタにありません。', true);
    return;
  }
  const rows = items.map(function (it) {
    return [it.no, it.flow, it.item, it.criteria, it.method, false, false, false, '', ''];
  });
  sh.getRange(L.firstRow, 1, rows.length, 10).setValues(rows);
  sh.getRange(L.firstRow, L.col.ok, rows.length, 3).insertCheckboxes();

  // NG詳細のプルダウン（一覧にない文字も入力できるようにしておく）
  items.forEach(function (it, i) {
    if (it.options.length === 0) return;
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(it.options, true)
      .setAllowInvalid(true)
      .build();
    sh.getRange(L.firstRow + i, L.col.detail).setDataValidation(rule);
  });
  notify('「' + model + '」の検査項目（' + items.length + '件）を読み込みました。');
}

/** まだ何も☑していない項目をすべて OK にする */
function setAllOk() {
  const sh = getSheet(SHEET.INSPECT);
  const L = LAYOUT.inspect;
  const n = countItemRows();
  if (n === 0) { notify('検査項目がありません。機種を選んでください。', true); return; }
  const range = sh.getRange(L.firstRow, L.col.ok, n, 3);
  const values = range.getValues().map(function (r) {
    return (r[0] === true || r[1] === true || r[2] === true) ? r : [true, false, false];
  });
  range.setValues(values);
  notify('未入力の項目をOKにしました。');
}

/** 機体番号を入れたら、前回の記録を表示し、機種・管理番号を自動で入れる */
function onSerialEntered() {
  const sh = getSheet(SHEET.INSPECT);
  const L = LAYOUT.inspect;
  const serial = normalizeSerial(sh.getRange(L.serial).getValue());
  if (!serial) { sh.getRange(L.previous).setValue(''); return; }

  const last = findLastInspection(serial);
  const repair = findOpenRepair(serial);
  const parts = [];

  if (last) {
    parts.push('前回検査 ' + fmtDate(last.date) + ' ' + last.judge);
    const modelCell = sh.getRange(L.model);
    if (last.model && modelCell.getValue() !== last.model && countEnteredResults() === 0) {
      modelCell.setValue(last.model);
      loadChecklist(last.model);
    }
    if (last.mgmtNo && !sh.getRange(L.mgmtNo).getValue()) sh.getRange(L.mgmtNo).setValue(last.mgmtNo);
  } else {
    parts.push('検査記録なし（初回）');
  }
  if (repair) {
    parts.push('修理 ' + repair.id + '：' + repair.status);
    if (repair.status === STATUS.DONE && !sh.getRange(L.reason).getValue()) {
      sh.getRange(L.reason).setValue('修理後検査');
    }
  }
  sh.getRange(L.previous).setValue(parts.join(' ／ '));
}

/** 「保存して判定する」の本体 */
function saveInspection() {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)) { notify('ほかの保存処理が動いています。少し待ってからもう一度☑してください。', true); return; }
  try {
    const sh = getSheet(SHEET.INSPECT);
    const L = LAYOUT.inspect;
    const head = {
      date: sh.getRange(L.date).getValue(),
      inspector: String(sh.getRange(L.inspector).getValue()).trim(),
      reason: String(sh.getRange(L.reason).getValue()).trim(),
      device: String(sh.getRange(L.device).getValue()).trim(),
      model: String(sh.getRange(L.model).getValue()).trim(),
      serial: normalizeSerial(sh.getRange(L.serial).getValue()),
      mgmtNo: String(sh.getRange(L.mgmtNo).getValue()).trim(),
      origin: String(sh.getRange(L.origin).getValue()).trim(),
    };

    // --- 入力チェック ---
    const missing = [];
    if (!(head.date instanceof Date)) missing.push('検査日');
    if (!head.inspector) missing.push('検査者');
    if (!head.model) missing.push('機種');
    if (!head.serial) missing.push('機体番号');
    if (missing.length) { notify('未入力があります：' + missing.join('、'), true); return; }

    const n = countItemRows();
    if (n === 0) { notify('検査項目がありません。機種を選んでください。', true); return; }
    const rows = sh.getRange(L.firstRow, 1, n, 10).getValues();
    const C = L.col;
    const results = [];
    const unchecked = [];
    rows.forEach(function (r) {
      const marks = [r[C.ok - 1], r[C.watch - 1], r[C.ng - 1]].filter(function (v) { return v === true; }).length;
      if (marks !== 1) { unchecked.push('No.' + r[C.no - 1]); return; }
      results.push({
        no: r[C.no - 1],
        flow: r[C.flow - 1],
        item: String(r[C.item - 1]),
        result: r[C.ng - 1] === true ? 'NG' : (r[C.watch - 1] === true ? '△' : 'OK'),
        detail: String(r[C.detail - 1]).trim(),
        memo: String(r[C.memo - 1]).trim(),
      });
    });
    if (unchecked.length) {
      notify('OK / △ / NG が未入力（または2つ以上☑）の項目：' + unchecked.join(', '), true);
      return;
    }

    // --- 判定 ---
    const ngs = results.filter(function (r) { return r.result === 'NG'; });
    const watches = results.filter(function (r) { return r.result === '△'; });
    const judge = ngs.length ? JUDGE.NG : (watches.length ? JUDGE.OK_WATCH : JUDGE.OK);
    const inspectId = nextInspectionId();
    const now = new Date();

    // --- 修理シートへの反映 ---
    let repairNote = '';
    let repairId = '';
    const open = findOpenRepair(head.serial);
    if (ngs.length) {
      const plan = buildRepairPlan(head.model, ngs);
      repairId = upsertRepair(open, head, inspectId, plan);
      appendPartsRows(repairId, head.serial, plan);
      repairNote = open ? ('修理 ' + repairId + ' に追記しました') : ('修理 ' + repairId + ' を登録しました');
    } else if (open && open.status === STATUS.DONE) {
      closeRepair(open, inspectId);
      repairId = open.id;
      repairNote = '修理 ' + open.id + ' をクローズしました';
    } else if (open) {
      repairNote = '注意：修理 ' + open.id + ' は「' + open.status + '」のままです';
    }

    // --- 検査記録・検査明細へ保存 ---
    const label = function (r) { return 'No.' + r.no + ' ' + r.item + (r.detail ? '（' + r.detail + '）' : ''); };
    const memoAll = results.filter(function (r) { return r.memo; })
      .map(function (r) { return 'No.' + r.no + ' ' + r.item + '：' + r.memo; }).join('\n');
    appendRows(getSheet(SHEET.LOG), [[
      inspectId, head.date, head.inspector, head.model, head.serial, head.mgmtNo, head.reason,
      head.origin, head.device, judge, ngs.map(label).join('\n'), watches.map(label).join('\n'),
      memoAll, repairId, now,
    ]], [5, 6]);
    appendRows(getSheet(SHEET.LOG_DETAIL), results.map(function (r) {
      return [inspectId, head.date, head.serial, r.no, r.item, r.result, r.detail, r.memo];
    }), [3]);

    rebuildGantt();

    // --- 次の機体のために入力をクリア（検査日・検査者・機種・検査端末・検査理由は残す） ---
    clearInspection(false);
    sh.getRange(L.judge).setValue(judge);
    notify(head.serial + ' を保存しました（' + inspectId + '）判定：' + judge + (repairNote ? '。' + repairNote : ''));
  } finally {
    lock.releaseLock();
  }
}

/** 入力をクリアする。all=true なら検査日以外のヘッダーも消す */
function clearInspection(all) {
  const sh = getSheet(SHEET.INSPECT);
  const L = LAYOUT.inspect;
  const n = countItemRows();
  if (n > 0) {
    sh.getRange(L.firstRow, L.col.ok, n, 3).setValue(false);
    sh.getRange(L.firstRow, L.col.detail, n, 2).clearContent();
  }
  [L.serial, L.mgmtNo, L.origin, L.previous, L.judge].forEach(function (a1) { sh.getRange(a1).clearContent(); });
  if (all) [L.reason].forEach(function (a1) { sh.getRange(a1).clearContent(); });
  if (!(sh.getRange(L.date).getValue() instanceof Date)) sh.getRange(L.date).setValue(today());
  if (all) notify('入力をクリアしました。');
}

/** NG項目から「修理内容」と「必要部品」を組み立てる */
function buildRepairPlan(model, ngs) {
  const master = {};
  getMasterItems(model).forEach(function (it) { master[it.item] = it; });
  const ngMap = getNgDetailMap(model);

  const works = [];
  const parts = {};   // 部品名 → 数量
  const reasons = {}; // 部品名 → NG項目
  ngs.forEach(function (ng) {
    const details = ng.detail ? ng.detail.split(/[、,，]/).map(function (s) { return s.trim(); }).filter(String) : [];
    // NG詳細マスタに載っている詳細はその内容、載っていなければ検査項目マスタの既定の内容を使う
    const plans = [];
    let useDefault = details.length === 0;
    details.forEach(function (d) {
      const hit = ngMap[ng.item + '|' + d] || ngMap['*|' + d];
      if (hit) plans.push(hit); else useDefault = true;
    });
    if (useDefault && master[ng.item]) plans.push({ work: master[ng.item].work, parts: master[ng.item].parts });
    if (plans.length === 0) plans.push({ work: '要確認', parts: '' });

    plans.forEach(function (p) {
      works.push('No.' + ng.no + ' ' + ng.item + '：' + (p.work || '要確認'));
      parseParts(p.parts).forEach(function (pt) {
        parts[pt.name] = (parts[pt.name] || 0) + pt.qty;
        reasons[pt.name] = (reasons[pt.name] ? reasons[pt.name] + '、' : '') + 'No.' + ng.no + ' ' + ng.item;
      });
    });
  });

  const label = function (r) { return 'No.' + r.no + ' ' + r.item + (r.detail ? '（' + r.detail + '）' : ''); };
  return {
    ngText: ngs.map(label).join('\n'),
    workText: works.join('\n'),
    parts: Object.keys(parts).map(function (name) { return { name: name, qty: parts[name], reason: reasons[name] }; }),
  };
}

/** 修理シートに新しく登録する。対応中の修理があればそこに追記する */
function upsertRepair(open, head, inspectId, plan) {
  const sh = getSheet(SHEET.REPAIR);
  const C = LAYOUT.repair.col;
  const partsText = plan.parts.map(function (p) { return p.name + ' x' + p.qty; }).join('、');

  if (open) {
    const row = open.row;
    const join = function (col, text) {
      const cell = sh.getRange(row, col);
      const old = String(cell.getValue());
      if (text) cell.setValue(old ? old + '\n' + text : text);
    };
    join(C.inspectId, inspectId);
    join(C.ngItems, plan.ngText);
    join(C.work, plan.workText);
    join(C.parts, partsText);
    if (open.status === STATUS.DONE) {
      // 修理後の再検査でまたNGになった → もう一度修理へ
      sh.getRange(row, C.status).setValue(STATUS.TODO);
      sh.getRange(row, C.end).clearContent();
    }
    return open.id;
  }

  const id = nextRepairId();
  const row = new Array(LAYOUT.repair.numCols).fill('');
  row[C.id - 1] = id;
  row[C.date - 1] = head.date;
  row[C.model - 1] = head.model;
  row[C.serial - 1] = head.serial;
  row[C.mgmtNo - 1] = head.mgmtNo;
  row[C.inspectId - 1] = inspectId;
  row[C.origin - 1] = [head.reason, head.origin].filter(String).join('：');
  row[C.ngItems - 1] = plan.ngText;
  row[C.work - 1] = plan.workText;
  row[C.parts - 1] = partsText;
  row[C.status - 1] = STATUS.TODO;
  appendRows(sh, [row], [C.serial, C.mgmtNo], LAYOUT.repair.firstRow);
  return id;
}

/** 再検査で合格したので修理をクローズする */
function closeRepair(open, inspectId) {
  const sh = getSheet(SHEET.REPAIR);
  const C = LAYOUT.repair.col;
  sh.getRange(open.row, C.status).setValue(STATUS.CLOSED);
  sh.getRange(open.row, C.reinspectId).setValue(inspectId);
  if (!sh.getRange(open.row, C.end).getValue()) sh.getRange(open.row, C.end).setValue(today());
}

/** 修理部品明細に部品を1行ずつ追加する（部品在庫にない部品は在庫表にも追加） */
function appendPartsRows(repairId, serial, plan) {
  if (plan.parts.length === 0) return;
  appendRows(getSheet(SHEET.PARTS), plan.parts.map(function (p) {
    return [repairId, serial, p.name, p.qty, p.reason];
  }), [2]);

  const stock = getSheet(SHEET.STOCK);
  const names = stock.getRange(2, 2, Math.max(stock.getLastRow() - 1, 1), 1).getValues()
    .map(function (r) { return String(r[0]); });
  plan.parts.forEach(function (p) {
    if (names.indexOf(p.name) >= 0) return;
    const empty = names.indexOf('');
    const row = empty >= 0 ? empty + 2 : names.length + 2;
    stock.getRange(row, 1, 1, 2).setValues([['自動追加', p.name]]);
    if (empty >= 0) names[empty] = p.name; else names.push(p.name);
  });
}

// ============================================================
// 修理シート
// ============================================================

/** ステータスを変えたら着手日・完了日を自動で入れる */
function autofillRepairDates(range) {
  const sh = range.getSheet();
  const C = LAYOUT.repair.col;
  for (let r = Math.max(range.getRow(), LAYOUT.repair.firstRow); r <= range.getLastRow(); r++) {
    const status = sh.getRange(r, C.status).getValue();
    const start = sh.getRange(r, C.start);
    const end = sh.getRange(r, C.end);
    if ([STATUS.DOING, STATUS.WAIT_PARTS, STATUS.DONE, STATUS.CLOSED].indexOf(status) >= 0 && !start.getValue()) {
      start.setValue(today());
    }
    if ([STATUS.DONE, STATUS.CLOSED].indexOf(status) >= 0 && !end.getValue()) end.setValue(today());
  }
}

// ============================================================
// 履歴ガント
// ============================================================

/** 検査記録と修理シートから、機体ごとのガントを作り直す */
function rebuildGantt() {
  const sh = getSheet(SHEET.GANTT);
  const G = LAYOUT.gantt;

  // 表示する期間
  let start = toDate(sh.getRange(G.startDate).getValue());
  if (!start) start = addDays(today(), -30);
  let days = Number(sh.getRange(G.days).getValue()) || 90;
  days = Math.min(Math.max(days, 7), 366);
  const startKey = dayKey(start);
  const todayKey = dayKey(today());

  // 機体ごとの情報を集める
  const units = {}; // serial → { model, mgmtNo, marks: {dayIndex: mark}, lastJudge, lastDate, openStatus }
  const unit = function (serial) {
    if (!units[serial]) units[serial] = { model: '', mgmtNo: '', marks: {}, lastJudge: '', lastDate: null, openStatus: '' };
    return units[serial];
  };
  const put = function (u, date, mark) {
    const idx = dayKey(date) - startKey;
    if (idx < 0 || idx >= days) return;
    if (!u.marks[idx] || u.marks[idx].rank < mark.rank) u.marks[idx] = mark;
  };
  const span = function (u, from, to, mark) {
    for (let k = dayKey(from); k <= dayKey(to); k++) put(u, fromDayKey(k), mark);
  };

  readTable(SHEET.LOG, 2, 15).forEach(function (r) {
    const serial = normalizeSerial(r[4]);
    const date = toDate(r[1]);
    if (!serial || !date) return;
    const u = unit(serial);
    u.model = r[3] || u.model;
    u.mgmtNo = r[5] || u.mgmtNo;
    if (!u.lastDate || date >= u.lastDate) { u.lastDate = date; u.lastJudge = r[9]; }
    put(u, date, r[9] === JUDGE.NG ? GANTT_MARK.NG : GANTT_MARK.OK);
  });

  const C = LAYOUT.repair.col;
  readTable(SHEET.REPAIR, LAYOUT.repair.firstRow, LAYOUT.repair.numCols).forEach(function (r) {
    const serial = normalizeSerial(r[C.serial - 1]);
    const reg = toDate(r[C.date - 1]);
    if (!serial || !reg) return;
    const u = unit(serial);
    u.model = u.model || r[C.model - 1];
    u.mgmtNo = u.mgmtNo || r[C.mgmtNo - 1];
    const status = r[C.status - 1];
    const s = toDate(r[C.start - 1]);
    const e = toDate(r[C.end - 1]);
    if (status !== STATUS.CLOSED) u.openStatus = status;

    const waitEnd = s ? addDays(s, -1) : (e || today());
    span(u, addDays(reg, 1), waitEnd, GANTT_MARK.WAIT);
    if (s) span(u, s, e ? addDays(e, -1) : today(), GANTT_MARK.DOING);
    if (e) put(u, e, GANTT_MARK.DONE);
  });

  // 書き込み
  const serials = Object.keys(units).sort();
  const totalCols = G.firstDateCol - 1 + days;
  if (sh.getMaxColumns() < totalCols) sh.insertColumnsAfter(sh.getMaxColumns(), totalCols - sh.getMaxColumns());
  const lastRow = Math.max(sh.getLastRow(), G.firstRow);
  sh.getRange(G.monthRow, 1, lastRow - G.monthRow + 1, sh.getMaxColumns())
    .clearContent().setBackground(null).setFontColor(null).setFontWeight(null);

  const monthRow = [];
  const dayRow = [];
  const headBg = [];
  const headFont = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(start, i);
    monthRow.push(i === 0 || d.getDate() === 1 ? (d.getMonth() + 1) + '月' : '');
    dayRow.push(d.getDate());
    const wd = d.getDay();
    headBg.push(dayKey(d) === todayKey ? '#CC0000' : (wd === 0 || wd === 6 ? '#D9D9D9' : '#F3F3F3'));
    headFont.push(dayKey(d) === todayKey ? '#FFFFFF' : '#000000');
  }
  sh.getRange(G.monthRow, G.firstDateCol, 1, days).setValues([monthRow]).setFontWeight('bold');
  sh.getRange(G.headerRow, 1, 1, 4).setValues([['機体番号', '機種', '管理番号', '現在の状態']])
    .setBackground('#1F3864').setFontColor('#FFFFFF').setFontWeight('bold');
  sh.getRange(G.headerRow, G.firstDateCol, 1, days).setValues([dayRow])
    .setBackgrounds([headBg]).setFontColors([headFont]).setHorizontalAlignment('center');

  if (serials.length) {
    ensureRows(sh, G.firstRow + serials.length - 1);
    const left = [];
    const body = [];
    const bg = [];
    serials.forEach(function (serial) {
      const u = units[serial];
      left.push([serial, u.model, u.mgmtNo, u.openStatus || u.lastJudge]);
      const line = [];
      const lineBg = [];
      for (let i = 0; i < days; i++) {
        const m = u.marks[i];
        line.push(m ? m.text : '');
        lineBg.push(m ? m.bg : (startKey + i === todayKey ? '#FDECEA' : null));
      }
      body.push(line);
      bg.push(lineBg);
    });
    sh.getRange(G.firstRow, 1, serials.length, 4).setNumberFormat('@').setValues(left);
    sh.getRange(G.firstRow, G.firstDateCol, serials.length, days)
      .setValues(body).setBackgrounds(bg).setHorizontalAlignment('center');
  }
  sh.setColumnWidths(G.firstDateCol, days, 26);
}

// ============================================================
// マスタの読み込み
// ============================================================

/** 検査項目マスタから機種の項目を読む */
function getMasterItems(model) {
  return readTable(SHEET.MASTER, 2, 9)
    .filter(function (r) { return String(r[0]).trim() === model && String(r[3]).trim(); })
    .map(function (r) {
      return {
        no: r[1], flow: r[2], item: String(r[3]).trim(), criteria: r[4], method: r[5],
        options: String(r[6]).split(/[、,，]/).map(function (s) { return s.trim(); }).filter(String),
        work: String(r[7]).trim(), parts: String(r[8]).trim(),
      };
    });
}

/** NG詳細マスタを「項目|NG詳細」→ {work, parts} の形にする（項目が * なら全項目共通） */
function getNgDetailMap(model) {
  const map = {};
  readTable(SHEET.NG_MASTER, 2, 5).forEach(function (r) {
    if (String(r[0]).trim() !== model) return;
    map[String(r[1]).trim() + '|' + String(r[2]).trim()] = { work: String(r[3]).trim(), parts: String(r[4]).trim() };
  });
  return map;
}

/** 「部品名 x数、部品名 x数」を [{name, qty}] にする（x数 がなければ1個） */
function parseParts(text) {
  if (!text) return [];
  return String(text).split(/[、,，\n]/).map(function (s) { return s.trim(); }).filter(String).map(function (s) {
    const m = s.match(/^(.*?)\s*[x×X＊*]\s*(\d+)$/);
    return m ? { name: m[1].trim(), qty: Number(m[2]) } : { name: s, qty: 1 };
  });
}

// ============================================================
// 記録の検索
// ============================================================

function findLastInspection(serial) {
  let last = null;
  readTable(SHEET.LOG, 2, 15).forEach(function (r) {
    if (normalizeSerial(r[4]) !== serial) return;
    const date = toDate(r[1]);
    if (!last || (date && date >= last.date)) last = { date: date, model: r[3], mgmtNo: r[5], judge: r[9] };
  });
  return last;
}

/** その機体のクローズしていない修理（いちばん新しいもの）を探す */
function findOpenRepair(serial) {
  const C = LAYOUT.repair.col;
  const rows = readTable(SHEET.REPAIR, LAYOUT.repair.firstRow, LAYOUT.repair.numCols);
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (normalizeSerial(r[C.serial - 1]) === serial && r[C.status - 1] !== STATUS.CLOSED) {
      return { row: LAYOUT.repair.firstRow + i, id: r[C.id - 1], status: r[C.status - 1] };
    }
  }
  return null;
}

/** 検査ID：K-yyyyMMdd-連番 */
function nextInspectionId() {
  const prefix = 'K-' + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd') + '-';
  const count = readTable(SHEET.LOG, 2, 1)
    .filter(function (r) { return String(r[0]).indexOf(prefix) === 0; }).length;
  return prefix + ('0' + (count + 1)).slice(-2);
}

/** 修理ID：R-0001 からの連番 */
function nextRepairId() {
  let max = 0;
  readTable(SHEET.REPAIR, LAYOUT.repair.firstRow, 1).forEach(function (r) {
    const m = String(r[0]).match(/^R-(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return 'R-' + ('000' + (max + 1)).slice(-4);
}

// ============================================================
// 小さな道具
// ============================================================

function getSheet(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('シート「' + name + '」が見つかりません');
  return sh;
}

/** firstRow 行目から、A列が空でない行を読む */
function readTable(name, firstRow, numCols) {
  const sh = getSheet(name);
  const last = sh.getLastRow();
  if (last < firstRow) return [];
  return sh.getRange(firstRow, 1, last - firstRow + 1, numCols).getValues()
    .filter(function (r) { return String(r[0]).trim() !== ''; });
}

/** A列が空の最初の行から追記する。textCols の列は文字列として保存（機体番号の0落ち防止） */
function appendRows(sh, rows, textCols, firstRow) {
  if (rows.length === 0) return;
  const start = firstRow || 2;
  const last = sh.getLastRow();
  let row = start;
  if (last >= start) {
    const ids = sh.getRange(start, 1, last - start + 1, 1).getValues();
    let i = ids.length;
    while (i > 0 && String(ids[i - 1][0]).trim() === '') i--;
    row = start + i;
  }
  ensureRows(sh, row + rows.length - 1);
  (textCols || []).forEach(function (c) { sh.getRange(row, c, rows.length, 1).setNumberFormat('@'); });
  sh.getRange(row, 1, rows.length, rows[0].length).setValues(rows);
}

/** シートの行数が足りなければ増やす */
function ensureRows(sh, lastRow) {
  const max = sh.getMaxRows();
  if (lastRow > max) sh.insertRowsAfter(max, Math.max(lastRow - max, 500));
}

/** 検査項目が何行あるか（C列「項目」が入っている行） */
function countItemRows() {
  const sh = getSheet(SHEET.INSPECT);
  const L = LAYOUT.inspect;
  const values = sh.getRange(L.firstRow, L.col.item, L.maxRows, 1).getValues();
  let n = 0;
  while (n < values.length && String(values[n][0]).trim() !== '') n++;
  return n;
}

/** OK/△/NG に☑がついている項目の数 */
function countEnteredResults() {
  const n = countItemRows();
  if (n === 0) return 0;
  const L = LAYOUT.inspect;
  return getSheet(SHEET.INSPECT).getRange(L.firstRow, L.col.ok, n, 3).getValues()
    .filter(function (r) { return r.indexOf(true) >= 0; }).length;
}

function uncheck(range) { range.setValue(false); }

/** 検査シートのメッセージ欄と画面右下の通知に表示する */
function notify(message, isError) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SHEET.INSPECT);
  if (sh) {
    sh.getRange(LAYOUT.inspect.message).setValue((isError ? '⚠ ' : '') + message)
      .setFontColor(isError ? '#CC0000' : '#1F3864');
  }
  ss.toast(message, isError ? '確認してください' : 'OriHime管理', 8);
}

function normalizeSerial(v) { return String(v === null || v === undefined ? '' : v).trim().toUpperCase(); }

function today() {
  const s = Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd').split('/');
  return new Date(Number(s[0]), Number(s[1]) - 1, Number(s[2]));
}

function toDate(v) {
  if (v instanceof Date) return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  if (!v) return null;
  const m = String(v).match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }

/** 日付を「日数」の整数にする（日付の引き算・比較を簡単にするため） */
function dayKey(d) { return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000); }
function fromDayKey(k) { const d = new Date(k * 86400000); return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }

function fmtDate(d) { return d ? Utilities.formatDate(d, TZ, 'yyyy/MM/dd') : ''; }
