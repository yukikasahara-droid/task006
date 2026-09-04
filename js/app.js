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
  const noteToggle    = $('#noteToggle');
  const noteField     = $('#noteField');
  const noteInput     = $('#noteInput');
  const listHeading   = $('#list-heading');

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

    // チェックボックス（完了の切り替えはここだけ。左上の□。誤タップ防止）
    const cbId = 'cb-' + task.id;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'task-check';
    checkbox.id = cbId;
    checkbox.checked = task.done;
    checkbox.setAttribute('aria-label', `「${task.title}」を完了にする`);
    checkbox.addEventListener('change', () => toggleDone(task.id, checkbox.checked));

    // 本文のまとまり（タイトル・メタ・備考をタテに並べる箱）
    const body = document.createElement('div');
    body.className = 'task-body';

    // 備考の編集欄（ふだんは隠す。タイトルをタップすると開く）
    const noteEdit = document.createElement('textarea');
    noteEdit.className = 'task-note-edit';
    noteEdit.id = 'note-edit-' + task.id;
    noteEdit.rows = 2;
    noteEdit.value = task.note || '';
    noteEdit.placeholder = '備考を入力（自動で保存されます）';
    noteEdit.setAttribute('aria-label', `「${task.title}」の備考`);
    noteEdit.hidden = true;
    noteEdit.addEventListener('input', () => {
      const cur = tasks.find(x => x.id === task.id);
      if (!cur) return;
      cur.note = noteEdit.value;   // 打つそばから保存
      S.saveTasks(tasks);
    });

    // タイトル部分はボタン。タップで備考の編集を開閉（完了はしない）
    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'task-main';
    main.setAttribute('aria-expanded', 'false');
    main.setAttribute('aria-controls', noteEdit.id);

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
    main.appendChild(title);
    main.appendChild(meta);

    // 備考の表示（書いてあるときだけ）
    if (task.note) {
      const noteView = document.createElement('span');
      noteView.className = 'task-note';
      noteView.textContent = task.note;
      main.appendChild(noteView);
    }

    // ヒント（タイトルタップで備考を編集/追加できることを伝える）
    const hint = document.createElement('span');
    hint.className = 'note-hint';
    hint.textContent = task.note ? '✎ タップで備考を編集' : '✎ タップで備考メモを追加';
    main.appendChild(hint);

    // タイトルタップ → 備考の編集欄を開閉
    main.addEventListener('click', () => {
      const opening = noteEdit.hidden;
      noteEdit.hidden = !opening;
      main.setAttribute('aria-expanded', String(opening));
      const nv = main.querySelector('.task-note');
      if (nv) nv.hidden = opening;   // 編集中は表示用の備考を隠す
      hint.hidden = opening;
      if (opening) {
        noteEdit.focus();
      } else {
        renderTasks();   // 閉じたら最新の内容を反映（空なら消える）
      }
    });

    body.appendChild(main);
    body.appendChild(noteEdit);

    // 右側の操作（削除のみ）
    const actions = document.createElement('div');
    actions.className = 'task-actions';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'task-delete';
    del.textContent = '削除';
    del.setAttribute('aria-label', `「${task.title}」を削除`);
    del.addEventListener('click', () => deleteTask(task.id));
    actions.appendChild(del);

    li.appendChild(checkbox);
    li.appendChild(body);
    li.appendChild(actions);
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
      done: false,
      note: noteInput.value.trim()   // 備考（空でもOK）
    });
    S.saveTasks(tasks);
    titleInput.value = '';
    noteInput.value = '';
    collapseNoteField();   // 追加したら備考欄はまた閉じる
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
    // 入力欄には戻さない（スマホでキーボードが出てしまうため）。
    // 代わりに見出しへフォーカスを移し、操作位置を見失わないようにする。
    listHeading.focus();
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

  /* ============ 追加フォームの「備考」開閉 ============ */
  function toggleNoteField() {
    const willOpen = noteField.hidden;
    noteField.hidden = !willOpen;
    noteToggle.setAttribute('aria-expanded', String(willOpen));
    noteToggle.textContent = willOpen ? '－ 備考を閉じる' : '＋ 備考（任意）';
    if (willOpen) noteInput.focus();
  }
  function collapseNoteField() {
    noteField.hidden = true;
    noteToggle.setAttribute('aria-expanded', 'false');
    noteToggle.textContent = '＋ 備考（任意）';
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
    noteToggle.addEventListener('click', toggleNoteField);
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
