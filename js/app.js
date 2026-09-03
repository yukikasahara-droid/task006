/* =========================================================
   app.js — 画面の組み立てと、ユーザー操作の処理
   （データは store.js に任せ、ここは「見た目と操作」を担当）
   ========================================================= */
(function () {
  'use strict';
  const S = window.TaskStore;

  /* ---- いまの状態（メモリ上）。変更したら store に保存して同期する ---- */
  let tasks = S.loadTasks();
  let categories = S.loadCategories();
  let currentFilter = 'すべて';

  /* ---- よく使う要素をまとめて取得 ---- */
  const $ = (sel) => document.querySelector(sel);
  const addForm       = $('#addForm');
  const titleInput    = $('#titleInput');
  const dueInput      = $('#dueInput');
  const categoryInput = $('#categoryInput');
  const filterTabs    = $('#filterTabs');
  const taskList      = $('#taskList');
  const emptyState    = $('#emptyState');
  const taskCount     = $('#taskCount');
  const liveRegion    = $('#liveRegion');
  const dialog        = $('#categoryDialog');
  const catList       = $('#catList');
  const catForm       = $('#catForm');
  const newCatInput   = $('#newCatInput');

  // スクリーンリーダーに状況を伝える（例：「追加しました」）
  function announce(msg) { liveRegion.textContent = msg; }

  /* ============ 描画（状態 → 画面）============ */

  // 追加フォームのジャンル選択肢
  function renderCategoryOptions() {
    const current = categoryInput.value;
    categoryInput.innerHTML = '';
    categories.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat; opt.textContent = cat;
      categoryInput.appendChild(opt);
    });
    if (categories.includes(current)) categoryInput.value = current;
  }

  // 絞り込みタブ（すべて＋各ジャンル）
  function renderFilters() {
    filterTabs.innerHTML = '';
    ['すべて', ...categories].forEach(cat => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'filter-tab';
      btn.textContent = cat;
      btn.setAttribute('aria-pressed', String(cat === currentFilter));
      btn.addEventListener('click', () => {
        currentFilter = cat;
        renderFilters();
        renderTasks();
      });
      filterTabs.appendChild(btn);
    });
  }

  // タスク一覧
  function renderTasks() {
    const visible = S.sortTasks(S.filterTasks(tasks, currentFilter));
    taskList.innerHTML = '';

    const remaining = visible.filter(t => !t.done).length;
    taskCount.textContent = visible.length ? `未完了 ${remaining} 件 / 全 ${visible.length} 件` : '';

    if (!visible.length) { emptyState.hidden = false; return; }
    emptyState.hidden = true;

    visible.forEach(task => taskList.appendChild(renderTaskItem(task)));
  }

  // タスク1件分の要素を作る
  function renderTaskItem(task) {
    const li = document.createElement('li');
    li.className = 'task' + (task.done ? ' is-done' : '');
    const info = S.dueInfo(task.due);
    if (info.state === 'overdue' && !task.done) li.classList.add('is-overdue');

    // チェックボックス（完了トグル）
    const cbId = 'cb-' + task.id;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'task-check';
    checkbox.id = cbId;
    checkbox.checked = task.done;
    checkbox.addEventListener('change', () => toggleDone(task.id, checkbox.checked));

    // 本文（label にしてチェックボックスと関連付け → タップ範囲も広がる）
    const label = document.createElement('label');
    label.className = 'task-main';
    label.setAttribute('for', cbId);

    const title = document.createElement('span');
    title.className = 'task-title';
    title.textContent = task.title;

    const meta = document.createElement('span');
    meta.className = 'task-meta';

    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = task.category;

    const due = document.createElement('span');
    due.className = 'due due-' + info.state;
    // 色だけに頼らない：期限切れは文字（⚠ 期限切れ）でも示す
    if (info.state === 'overdue' && !task.done) {
      due.textContent = '⚠ 期限切れ ' + info.label;
    } else {
      due.textContent = info.label;
    }

    meta.appendChild(chip);
    meta.appendChild(due);
    label.appendChild(title);
    label.appendChild(meta);

    // 削除ボタン
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'task-delete';
    del.textContent = '削除';
    del.setAttribute('aria-label', `「${task.title}」を削除`);
    del.addEventListener('click', () => deleteTask(task.id));

    li.appendChild(checkbox);
    li.appendChild(label);
    li.appendChild(del);
    return li;
  }

  // ダイアログ内のジャンル一覧
  function renderCatList() {
    catList.innerHTML = '';
    categories.forEach(cat => {
      const li = document.createElement('li');
      li.className = 'cat-item';

      const name = document.createElement('span');
      name.textContent = cat;
      li.appendChild(name);

      // ジャンルが1つだけのときは削除させない（0個防止）
      if (categories.length > 1) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cat-delete';
        btn.textContent = '削除';
        btn.setAttribute('aria-label', `ジャンル「${cat}」を削除`);
        btn.addEventListener('click', () => deleteCategory(cat));
        li.appendChild(btn);
      }
      catList.appendChild(li);
    });
  }

  /* ============ 操作（ユーザー → 状態）============ */

  function addTask(e) {
    e.preventDefault();
    const title = titleInput.value.trim();
    if (!title) return;
    tasks.unshift({
      id: S.newId(),
      title,
      due: dueInput.value || '',
      category: categoryInput.value || categories[0],
      done: false
    });
    S.saveTasks(tasks);
    titleInput.value = '';
    renderTasks();
    announce(`タスク「${title}」を追加しました`);
    titleInput.focus();   // 続けて入力しやすいようフォーカスを戻す
  }

  function toggleDone(id, done) {
    const t = tasks.find(t => t.id === id);
    if (!t) return;
    t.done = done;
    S.saveTasks(tasks);
    renderTasks();
    announce(done ? `「${t.title}」を完了にしました` : `「${t.title}」を未完了に戻しました`);
  }

  function deleteTask(id) {
    const t = tasks.find(t => t.id === id);
    tasks = tasks.filter(t => t.id !== id);
    S.saveTasks(tasks);
    renderTasks();
    if (t) announce(`「${t.title}」を削除しました`);
    titleInput.focus();   // フォーカスが行方不明にならないように
  }

  function addCategory(e) {
    e.preventDefault();
    const name = newCatInput.value.trim();
    if (!name) return;
    if (categories.includes(name)) { announce('同じ名前のジャンルがすでにあります'); return; }
    categories.push(name);
    S.saveCategories(categories);
    newCatInput.value = '';
    renderCategoryOptions();
    renderFilters();
    renderCatList();
    announce(`ジャンル「${name}」を追加しました`);
    newCatInput.focus();
  }

  function deleteCategory(cat) {
    if (categories.length <= 1) return;
    // 消すジャンルのタスクは、残りの先頭ジャンルに移す
    const fallback = categories.find(c => c !== cat) || 'その他';
    tasks.forEach(t => { if (t.category === cat) t.category = fallback; });
    categories = categories.filter(c => c !== cat);
    S.saveTasks(tasks);
    S.saveCategories(categories);
    if (currentFilter === cat) currentFilter = 'すべて';
    renderCategoryOptions();
    renderFilters();
    renderCatList();
    renderTasks();
    announce(`ジャンル「${cat}」を削除しました`);
  }

  /* ============ ジャンル管理ダイアログ ============ */
  function openDialog() {
    renderCatList();
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');   // 古いブラウザ向けの簡易表示
    newCatInput.focus();
  }
  function closeDialog() {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  /* ============ 初期化 ============ */
  function init() {
    dueInput.value = S.todayStr();   // 納期の初期値を今日に
    renderCategoryOptions();
    renderFilters();
    renderTasks();

    addForm.addEventListener('submit', addTask);
    catForm.addEventListener('submit', addCategory);
    $('#manageCategoriesBtn').addEventListener('click', openDialog);
    $('#catCloseBtn').addEventListener('click', closeDialog);
  }

  // 読み込みタイミングに関わらず確実に起動する
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
