/* =========================================================
   store.js — データの「保存・読み込み・整形」をまとめた部品
   （画面のことは一切知らない。データの面倒だけを見る係）
   ========================================================= */
window.TaskStore = (function () {
  'use strict';

  const TASKS_KEY = 'quicktask_tasks';
  const CATS_KEY = 'quicktask_categories';
  const DEFAULT_CATEGORIES = ['仕事', 'プライベート', '学習', 'その他'];

  /* localStorage は使えない環境（プライベートモード等）もあるため、
     読み書きは必ず try/catch で包んで、失敗してもアプリは動かす。 */
  function readJSON(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* 保存できなくても続行 */
    }
  }

  /* ---- 日付ヘルパー ---- */
  // 今日を "YYYY-MM-DD" で返す（ローカル時刻。UTCずれを避ける）
  function todayStr() {
    return toStr(new Date());
  }
  function toStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function addDaysStr(base, days) {
    const d = new Date(base + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return toStr(d);
  }

  // ランダムで重複しにくいID
  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* 初回起動時のサンプル（今日を基準に相対的に作るので、
     いつ開いても「1件は期限切れ・残りは近日」が見える） */
  function seedTasks() {
    const t = todayStr();
    return [
      { id: newId(), title: '資料を印刷しておく', due: addDaysStr(t, -2), category: '仕事', done: false },
      { id: newId(), title: '企画書を提出する',   due: addDaysStr(t, 1),  category: '仕事', done: false },
      { id: newId(), title: '歯医者を予約する',   due: addDaysStr(t, 4),  category: 'プライベート', done: false },
      { id: newId(), title: '参考書を1章読む',    due: '',                category: '学習', done: false }
    ];
  }

  /* ---- 読み込み・保存 ---- */
  function loadTasks() {
    const saved = readJSON(TASKS_KEY);
    if (Array.isArray(saved)) return saved;
    const seeded = seedTasks();
    writeJSON(TASKS_KEY, seeded);
    return seeded;
  }
  function saveTasks(tasks) { writeJSON(TASKS_KEY, tasks); }

  function loadCategories() {
    const saved = readJSON(CATS_KEY);
    if (Array.isArray(saved) && saved.length) return saved;
    writeJSON(CATS_KEY, DEFAULT_CATEGORIES);
    return DEFAULT_CATEGORIES.slice();
  }
  function saveCategories(cats) { writeJSON(CATS_KEY, cats); }

  /* ---- 納期の情報を計算 ----
     残り日数・状態（期限切れ/今日/近日/先）・表示文字をまとめて返す。 */
  const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
  function dueInfo(due) {
    if (!due) {
      return { hasDue: false, state: 'none', label: '納期なし' };
    }
    const today = new Date(todayStr() + 'T00:00:00');
    const target = new Date(due + 'T00:00:00');
    const diffDays = Math.round((target - today) / 86400000);
    const dateText = `${target.getMonth() + 1}/${target.getDate()}（${WEEKDAYS[target.getDay()]}）`;

    let state, rel;
    if (diffDays < 0)       { state = 'overdue'; rel = `${Math.abs(diffDays)}日超過`; }
    else if (diffDays === 0){ state = 'today';   rel = '今日'; }
    else if (diffDays === 1){ state = 'soon';    rel = '明日'; }
    else if (diffDays <= 3) { state = 'soon';    rel = `${diffDays}日後`; }
    else                    { state = 'future';  rel = `${diffDays}日後`; }

    return { hasDue: true, state, diffDays, dateText, rel, label: `${dateText}・${rel}` };
  }

  /* 並べ替え：未完了を上・完了を下、その中で納期の近い順（納期なしは最後）*/
  function sortTasks(tasks) {
    return tasks.slice().sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      const ad = a.due || '9999-12-31';
      const bd = b.due || '9999-12-31';
      return ad.localeCompare(bd);
    });
  }

  /* ジャンルで絞り込み */
  function filterTasks(tasks, category) {
    if (!category || category === 'すべて') return tasks;
    return tasks.filter(t => t.category === category);
  }

  // 外から使える関数だけ公開する
  return {
    DEFAULT_CATEGORIES,
    newId, todayStr,
    loadTasks, saveTasks,
    loadCategories, saveCategories,
    dueInfo, sortTasks, filterTasks
  };
})();
