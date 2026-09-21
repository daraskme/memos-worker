'use strict';
const $ = selector => document.querySelector(selector);
const icons = {
  note:'M8 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h2M8 8h8M8 12h8M8 16h5',
  menu:'M4 6h16M4 12h16M4 18h16',search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  plus:'M12 5v14M5 12h14',close:'M6 6l12 12M6 18L18 6',edit:'M14 5l5 5M4 20l4-1L20 7a2 2 0 0 0-4-4L4 15v5',
  star:'m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3',
  archive:'M4 8h16v12H4V8M3 3h18v5H3V3M9 12h6',book:'M12 5v16M12 5C9 3 5 3 2 4v15c3-1 7-1 10 2 3-3 7-3 10-2V4c-3-1-7-1-10 1',
  grid:'M3 3h7v7H3V3M14 3h7v7h-7V3M3 14h7v7H3v-7M14 14h7v7h-7v-7',
  columns:'M3 4h5v16H3V4M10 4h5v12h-5V4M17 4h4v14h-4V4',list:'M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01',
  image:'M3 3h18v18H3V3M3 16l5-5 5 5 3-3 5 5M15 7h.01',attach:'m8 13 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7L13 2',
  pin:'M8 3h8l-1 7 3 4v2H6v-2l3-4-1-7M12 16v6',trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  moon:'M20 14A9 9 0 0 1 10 4a9 9 0 1 0 10 10',sun:'M12 3V1M12 23v-2M3 12H1M23 12h-2M5 5 3 3M21 21l-2-2M5 19l-2 2M21 3l-2 2M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  refresh:'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1',tag:'m3 11 8 10 10-10-9-8H3v8M7 7h.01',folder:'M3 7V4h6l2 3h10v13H3V7',share:'M18 8l-12 6M6 10l12 6M21 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0M9 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0M21 19a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icons[name] || icons.note}"/></svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
document.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon));
const state = { mode:'home', category:null, tag:null, query:'', categories:[], tags:[], uncategorized:0, notes:[], page:1, more:false, request:0, view:localStorage.getItem('memos-keep-view') || 'cards' };
if (!['cards','board','list'].includes(state.view)) state.view = 'cards';
let editing = null, pendingFiles = [], removedFiles = new Set(), categoryEditing = null, dragId = null, saveBusy = false, toastTimer;
let autosaveTimer, savePromise = null, editorVersion = 0, savedVersion = 0, closeRequested = false;
const localPreview = ['127.0.0.1','localhost'].includes(location.hostname);

async function api(path, options = {}) {
  const res = await fetch(path, options);
  if (res.status === 401) {
    if (!path.endsWith('/login') && !$('#editor-dialog').open) showLogin();
    throw new Error(localPreview ? 'ユーザー名・パスワードを確認してログインしてください。' : 'ログインの有効期限が切れました。別タブでログインし直してから再度保存してください。');
  }
  if (res.status === 204) return null;
  let data;
  try { data = await res.json(); } catch { throw new Error('応答を読み取れませんでした。もう一度お試しください。'); }
  if (!res.ok) throw new Error(data.message || data.error || '保存できませんでした。');
  return data;
}
function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false; toastTimer = setTimeout(() => $('#toast').hidden = true, 3500); }
function showLogin() { $('#app').hidden = true; $('#login-screen').hidden = false; $('#login-form').hidden = !localPreview; $('#access-login').hidden = localPreview; document.querySelectorAll('dialog[open]').forEach(d => d.close()); }
function setTheme(theme) { document.documentElement.dataset.theme = theme; localStorage.setItem('memos-keep-theme', theme); $('#theme-button').innerHTML = icon(theme === 'dark' ? 'sun' : 'moon'); }
setTheme(localStorage.getItem('memos-keep-theme') || 'light');
function setMenu(open) { document.body.classList.toggle('menu-open', open); $('#scrim').hidden = !open; $('#menu-button').setAttribute('aria-expanded', String(open)); }
function markdown(text) {
  if (!window.marked || !window.DOMPurify) return `<p>${esc(text)}</p>`;
  return DOMPurify.sanitize(marked.parse(text || '', { breaks:true }), { USE_PROFILES:{html:true}, FORBID_TAGS:['form','iframe','style','script'], FORBID_ATTR:['style','id','name'], SANITIZE_NAMED_PROPS:true });
}
function actionButton(action, title, glyph, selected = false) { return `<button class="icon-button ${selected ? 'selected' : ''}" data-action="${action}" title="${title}" aria-label="${title}">${icon(glyph)}</button>`; }
const colorStyle = color => ['sand','sage','sky','rose','lavender','peach'].includes(color) ? `background:var(--${color})` : '';

async function taxonomy() {
  const mode = state.mode;
  const [cats, tags] = await Promise.all([api(`/api/categories?archived=${mode === 'archive'}`), api(`/api/tags?archived=${mode === 'archive'}`)]);
  if (mode !== state.mode) return;
  state.categories = cats.categories; state.uncategorized = cats.uncategorized; state.tags = tags;
  renderTaxonomy();
}
function renderTaxonomy() {
  $('#category-list').innerHTML = `<button class="taxonomy-item ${state.category === 'uncategorized' ? 'active' : ''}" data-category="uncategorized">${icon('folder')}<span class="label">未分類</span><span class="count">${state.uncategorized}</span></button>` + state.categories.map(c => `<button class="taxonomy-item ${String(c.id) === state.category ? 'active' : ''}" data-category="${c.id}"><span class="category-dot" style="${colorStyle(c.color)}"></span><span class="label">${esc(c.name)}</span><span class="count">${c.count}</span></button>`).join('');
  $('#tag-total').textContent = '';
  $('#tag-list').innerHTML = state.tags.length ? state.tags.map(t => `<button class="taxonomy-item ${t.name === state.tag ? 'active' : ''}" data-tag="${esc(t.name)}">${icon('tag')}<span class="label">${esc(t.name)}</span><span class="count">${t.count}</span></button>`).join('') : '<p class="empty-label">メモに付けたタグが<br>ここに並びます。</p>';
  const selected = $('#memo-category').value;
  $('#memo-category').innerHTML = '<option value="">未分類</option>' + state.categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  $('#memo-category').value = selected;
  $('#tag-suggestions').innerHTML = state.tags.map(t => `<option value="${esc(t.name)}"></option>`).join('');
  renderCategoryManager(); renderFilters();
}
function renderFilters() {
  const category = state.categories.find(c => String(c.id) === state.category);
  const chips = [];
  if (state.category) chips.push(`<button class="filter-chip" data-clear="category">${icon('folder')}${esc(category?.name || '未分類')}${icon('close')}</button>`);
  if (state.tag) chips.push(`<button class="filter-chip" data-clear="tag"># ${esc(state.tag)}${icon('close')}</button>`);
  if (state.query) chips.push(`<button class="filter-chip" data-clear="query">${icon('search')}${esc(state.query)}${icon('close')}</button>`);
  $('#active-filters').innerHTML = chips.join('') + (chips.length > 1 ? '<button class="clear-filters" data-clear="all">すべて解除</button>' : '');
  const titles = {home:'すべてのメモ',favorites:'お気に入り',archive:'アーカイブ'};
  $('#board-title').textContent = category?.name || (state.category === 'uncategorized' ? '未分類' : titles[state.mode]);
  $('#board-eyebrow').textContent = state.mode === 'archive' ? 'ARCHIVE' : 'MY NOTES';
  $('#board-caption').textContent = state.view === 'board' ? 'カードをドラッグして、カテゴリを変更できます。' : state.tag ? `「${state.tag}」のタグで絞り込み中` : '思いついたことを、ひとつずつ。';
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === state.mode));
  document.querySelectorAll('[data-view]').forEach(b => { b.classList.toggle('active', b.dataset.view === state.view); b.setAttribute('aria-pressed', String(b.dataset.view === state.view)); });
}
async function loadNotes(append = false) {
  const request = ++state.request;
  const page = append ? state.page + 1 : 1;
  const params = new URLSearchParams({page:String(page), limit:'50', archived:String(state.mode === 'archive')});
  if (state.mode === 'favorites') params.set('favorites','true');
  if (state.category) params.set('category',state.category);
  if (state.tag) params.set('tag',state.tag);
  if (state.query) params.set('q',state.query);
  $('#loading').hidden = false; $('#load-error').hidden = true; $('#load-more').disabled = true;
  try {
    const data = await api(`/api/${state.query ? 'search' : 'notes'}?${params}`);
    if (request !== state.request) return;
    state.notes = append ? [...state.notes,...data.notes] : data.notes;
    state.page = page; state.more = data.hasMore;
    renderNotes();
  } catch (error) { if (request === state.request) { $('#load-error').textContent = error.message; $('#load-error').hidden = false; } }
  finally { if (request === state.request) { $('#loading').hidden = true; $('#load-more').disabled = false; } }
}
async function refresh() { await Promise.all([loadNotes(), taxonomy().catch(error => toast(error.message))]); renderNotes(); }
function card(note) {
  const date = new Intl.DateTimeFormat('ja-JP',{month:'short',day:'numeric'}).format(new Date(note.updated_at));
  const labels = (note.category_name ? `<button class="label-chip" data-category="${note.category_id}">${esc(note.category_name)}</button>` : '') + (note.tags || []).map(t => `<button class="label-chip tag" data-tag="${esc(t)}">#${esc(t)}</button>`).join('');
  const files = (note.files || []).map(f => `<a class="file-pill" href="/api/files/${note.id}/${encodeURIComponent(f.id)}" download="${esc(f.name)}">${icon('attach')}<span>${esc(f.name)}</span></a>`).join('');
  return `<article class="memo-card" data-note="${note.id}" ${state.view === 'board' ? 'draggable="true"' : ''} style="${colorStyle(note.category_color)}" aria-label="メモ ${note.id}">${note.is_pinned ? `<span class="pin-indicator" title="固定済み">${icon('pin')}</span>` : ''}<div class="card-content markdown">${markdown(note.content)}</div>${files ? `<div class="card-attachments">${files}</div>` : ''}${labels ? `<div class="card-labels">${labels}</div>` : ''}<div class="card-footer"><time class="card-date" datetime="${new Date(note.updated_at).toISOString()}">${date}</time><div class="card-actions">${actionButton('edit','編集','edit')}${actionButton('pin',note.is_pinned ? '固定を解除' : '上部に固定','pin',note.is_pinned)}${actionButton('favorite',note.is_favorited ? 'お気に入りを解除' : 'お気に入り','star',note.is_favorited)}${actionButton('archive',note.is_archived ? 'アーカイブから戻す' : 'アーカイブ','archive')}${actionButton('delete','メモを削除','trash')}</div></div></article>`;
}
function renderNotes() {
  const board = $('#notes-board'); board.className = state.view === 'list' ? 'list-view' : '';
  if (state.view === 'board') {
    let lanes = [{id:'uncategorized',name:'未分類',color:''},...state.categories];
    if (state.category) lanes = lanes.filter(c => String(c.id) === state.category);
    board.innerHTML = `<div class="kanban">${lanes.map(c => { const notes = state.notes.filter(n => String(n.category_id ?? 'uncategorized') === String(c.id)); return `<section class="kanban-lane" data-lane="${c.id}" aria-label="${esc(c.name)}"><div class="lane-heading"><span class="category-dot" style="${colorStyle(c.color)}"></span>${esc(c.name)}<span class="count">${notes.length}</span><button class="icon-button small" data-new-in="${c.id}" aria-label="${esc(c.name)}にメモを追加">${icon('plus')}</button></div>${notes.length ? notes.map(card).join('') : '<p class="lane-empty">ここにメモを置く</p>'}</section>`; }).join('')}</div>`;
  } else {
    const pinned = state.notes.filter(n => n.is_pinned), others = state.notes.filter(n => !n.is_pinned);
    board.innerHTML = `${pinned.length ? '<h2 class="section-label">固定したメモ</h2><div class="masonry">'+pinned.map(card).join('')+'</div>' : ''}${others.length ? (pinned.length ? '<h2 class="section-label">その他のメモ</h2>' : '')+'<div class="masonry">'+others.map(card).join('')+'</div>' : ''}`;
  }
  const empty = !state.notes.length && state.view !== 'board';
  $('#empty-state').hidden = !empty;
  const filtered = state.category || state.tag || state.query || state.mode !== 'home';
  $('#empty-state h2').textContent = filtered ? '該当するメモはありません' : 'ここから、ひとつ。';
  $('#empty-state p').textContent = filtered ? '絞り込みを変えるか、新しいメモを追加できます。' : 'メモを追加して、考えやアイデアを残しましょう。';
  $('#empty-add').textContent = filtered ? '新しいメモを書く' : '最初のメモを書く';
  $('#load-more').hidden = !state.more;
  renderFilters();
}
function openEditor(note = null, category = state.category) {
  clearTimeout(autosaveTimer); editorVersion = 0; savedVersion = 0; closeRequested = false;
  editing = note; pendingFiles = []; removedFiles.clear();
  $('#editor-title').textContent = note ? 'メモを編集' : '新しいメモ';
  $('#memo-content').value = note?.content || '';
  $('#memo-category').value = note ? String(note.category_id ?? '') : category && category !== 'uncategorized' ? category : '';
  $('#memo-tags').value = note ? (note.manual_tags || []).join(', ') : state.tag || '';
  $('#memo-files').value = ''; $('#editor-error').textContent = '';
  setPreview(false); renderFiles(); $('#autosave-status').textContent = note ? '保存済み' : '入力すると自動保存';
  $('#editor-dialog').showModal(); $('#memo-content').focus();
}
async function confirmAction(message, label = '削除する', title = '削除しますか？') {
  const dialog = $('#confirm-dialog'); $('#confirm-title').textContent = title; $('#confirm-message').textContent = message; $('#confirm-ok').textContent = label;
  dialog.showModal();
  return new Promise(resolve => {
    const finish = value => { dialog.close(); $('#confirm-ok').onclick = null; $('#confirm-cancel').onclick = null; dialog.oncancel = null; resolve(value); };
    $('#confirm-ok').onclick = () => finish(true); $('#confirm-cancel').onclick = () => finish(false); dialog.oncancel = event => { event.preventDefault(); finish(false); };
  });
}
async function closeEditor() { await saveEditor(true); }
function editorChanged() {
  editorVersion++; clearTimeout(autosaveTimer);
  $('#autosave-status').textContent = '保存待ち…'; $('#editor-error').textContent = '';
  autosaveTimer = setTimeout(() => saveEditor(false), 2000);
}
function setPreview(on) { $('#memo-preview').hidden = !on; $('#memo-content').hidden = on; $('#edit-tab').classList.toggle('active',!on); $('#preview-tab').classList.toggle('active',on); if (on) $('#memo-preview').innerHTML = markdown($('#memo-content').value); }
function renderFiles() {
  $('#existing-files').innerHTML = (editing?.files || []).map(f => `<div class="editor-file ${removedFiles.has(f.id) ? 'removed' : ''}">${icon('attach')}<span>${esc(f.name)}</span><button type="button" data-remove-file="${esc(f.id)}">${removedFiles.has(f.id) ? '戻す' : '削除'}</button></div>`).join('');
  $('#pending-files').innerHTML = pendingFiles.map((f,i) => `<div class="editor-file">${icon('attach')}<span>${esc(f.name)}</span><button type="button" data-remove-pending="${i}" aria-label="${esc(f.name)}を取り除く">${icon('close')}</button></div>`).join('');
}
async function saveEditor(close = false) {
  clearTimeout(autosaveTimer);
  if (close) closeRequested = true;
  if (savePromise) return savePromise;
  if (editorVersion === savedVersion) { if (closeRequested) { $('#editor-dialog').close(); closeRequested = false; } return; }
  saveBusy = true; $('#save-memo').disabled = true;
  savePromise = Promise.resolve().then(async () => {
    try {
      do {
        let content = $('#memo-content').value;
        if (!content.trim() && !pendingFiles.length && !(editing?.files || []).some(f => !removedFiles.has(f.id))) {
          if (!editing) { $('#autosave-status').textContent = '入力すると自動保存'; if (closeRequested) $('#editor-dialog').close(); closeRequested = false; return; }
          throw new Error('空のメモには変更できません。削除はカードの削除ボタンから行えます。');
        }
        let tags = $('#memo-tags').value.split(/[,、\n]/).map(t => t.trim().replace(/^#+/, '')).filter(Boolean);
        if (tags.length > 30 || tags.some(t => t.length > 50)) throw new Error('タグは各50文字以内、30個まで設定できます。');
        $('#autosave-status').textContent = '保存中…'; $('#editor-error').textContent = '';
        for (const file of [...pendingFiles].filter(f => f.type.startsWith('image/'))) {
          const upload = new FormData(); upload.set('file',file);
          const result = await api('/api/upload/image',{method:'POST',body:upload});
          $('#memo-content').value += `\n\n![${file.name.replace(/[\[\]\\\n\r]/g,'')}](${result.url})`;
          pendingFiles = pendingFiles.filter(f => f !== file); renderFiles();
        }
        const version = editorVersion, files = [...pendingFiles], removals = [...removedFiles];
        content = $('#memo-content').value;
        tags = $('#memo-tags').value.split(/[,、\n]/).map(t => t.trim().replace(/^#+/, '')).filter(Boolean);
        const form = new FormData(); form.set('content',content); form.set('category_id',$('#memo-category').value); form.set('tags',JSON.stringify(tags)); form.set('filesToDelete',JSON.stringify(removals));
        files.forEach(f => form.append('file',f));
        editing = await api(editing ? `/api/notes/${editing.id}` : '/api/notes',{method:editing ? 'PUT' : 'POST',body:form});
        pendingFiles = pendingFiles.filter(f => !files.includes(f)); removals.forEach(id => removedFiles.delete(id));
        savedVersion = version; renderFiles(); $('#editor-title').textContent = 'メモを編集';
        $('#autosave-status').textContent = savedVersion === editorVersion ? '✓ 保存済み' : '保存待ち…';
        await refresh();
      } while (closeRequested && editorVersion !== savedVersion);
      if (closeRequested) { $('#editor-dialog').close(); closeRequested = false; }
      else if (editorVersion !== savedVersion) autosaveTimer = setTimeout(() => saveEditor(), 2000);
    } catch (error) {
      closeRequested = false; $('#editor-error').textContent = error.message; $('#autosave-status').textContent = '未保存 — 再試行できます';
    } finally { saveBusy = false; savePromise = null; $('#save-memo').disabled = false; }
  });
  return savePromise;
}
$('#editor-form').addEventListener('submit',event => { event.preventDefault(); saveEditor(true); });
['memo-content','memo-category','memo-tags'].forEach(id => $(`#${id}`).addEventListener(id === 'memo-category' ? 'change' : 'input', editorChanged));
$('#editor-dialog').addEventListener('click',event => { if (event.target !== $('#editor-dialog')) return; const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeEditor(); });
window.addEventListener('beforeunload',event => { if ($('#editor-dialog').open && (saveBusy || editorVersion !== savedVersion)) { event.preventDefault(); event.returnValue = ''; } });
async function updateNote(id, fields) { const form = new FormData(); Object.entries(fields).forEach(([key,value]) => form.set(key,String(value))); return api(`/api/notes/${id}`,{method:'PUT',body:form}); }
async function noteAction(action, note) {
  if (action === 'edit') return openEditor(note);
  try {
    if (action === 'delete') {
      if (!await confirmAction('このメモと添付ファイルを削除します。この操作は取り消せません。')) return;
      await api(`/api/notes/${note.id}`,{method:'DELETE'}); toast('メモを削除しました');
    } else {
      const changes = {pin:{isPinned:!note.is_pinned},favorite:{isFavorited:!note.is_favorited},archive:{is_archived:!note.is_archived}};
      if (!changes[action]) return;
      await updateNote(note.id,changes[action]);
      toast(action === 'archive' ? note.is_archived ? 'メモを戻しました' : 'アーカイブしました' : '更新しました');
    }
    await refresh();
  } catch (error) { toast(error.message); }
}
function openCategoryManager() { categoryEditing = null; $('#category-name').value = ''; $('#category-color').value = 'sand'; $('#save-category').textContent = '追加'; $('#cancel-category-edit').hidden = true; $('#category-error').textContent = ''; renderCategoryManager(); $('#categories-dialog').showModal(); $('#category-name').focus(); }
function renderCategoryManager() {
  $('#category-manager-list').innerHTML = state.categories.length ? state.categories.map(c => `<div class="manager-row"><span class="category-dot" style="${colorStyle(c.color)}"></span><span class="name">${esc(c.name)}</span><span class="count">${c.count}</span><button class="icon-button" data-edit-category="${c.id}" aria-label="${esc(c.name)}を編集">${icon('edit')}</button><button class="icon-button" data-delete-category="${c.id}" aria-label="${esc(c.name)}を削除">${icon('trash')}</button></div>`).join('') : '<p class="empty-label">まだカテゴリはありません。</p>';
}
$('#category-form').addEventListener('submit',async event => {
  event.preventDefault(); const button = $('#save-category'); button.disabled = true; $('#category-error').textContent = '';
  try {
    const result = await api(categoryEditing ? `/api/categories/${categoryEditing}` : '/api/categories',{method:categoryEditing ? 'PUT' : 'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:$('#category-name').value,color:$('#category-color').value})});
    const wasNew = !categoryEditing; categoryEditing = null; $('#category-name').value = ''; button.textContent = '追加'; $('#cancel-category-edit').hidden = true;
    await taxonomy(); renderNotes();
    if (wasNew && $('#editor-dialog').open) { $('#memo-category').value = String(result.id); editorChanged(); $('#categories-dialog').close(); }
    else await loadNotes();
    toast(wasNew ? 'カテゴリを追加しました' : 'カテゴリを更新しました');
  } catch (error) { $('#category-error').textContent = error.message; }
  finally { button.disabled = false; }
});
document.addEventListener('click',async event => {
  const target = event.target.closest('button, a, .card-content'); if (!target) return;
  if (target.dataset.close) { target.dataset.close === 'editor-dialog' ? await closeEditor() : $(`#${target.dataset.close}`).close(); return; }
  if (target.dataset.category !== undefined) { state.category = state.category === target.dataset.category ? null : target.dataset.category; renderTaxonomy(); setMenu(false); await loadNotes(); return; }
  if (target.dataset.tag !== undefined) { state.tag = state.tag === target.dataset.tag ? null : target.dataset.tag; renderTaxonomy(); setMenu(false); await loadNotes(); return; }
  if (target.dataset.clear) { const key = target.dataset.clear; if (key === 'all') { state.category = null; state.tag = null; state.query = ''; } else state[key] = key === 'query' ? '' : null; $('#search').value = state.query; renderTaxonomy(); await loadNotes(); return; }
  if (target.dataset.mode) { state.mode = target.dataset.mode; state.category = null; state.tag = null; renderFilters(); setMenu(false); await refresh(); return; }
  if (target.dataset.view) { state.view = target.dataset.view; localStorage.setItem('memos-keep-view',state.view); renderNotes(); return; }
  if (target.dataset.newIn) { openEditor(null,target.dataset.newIn); return; }
  if (target.dataset.removeFile) { const id = target.dataset.removeFile; removedFiles.has(id) ? removedFiles.delete(id) : removedFiles.add(id); renderFiles(); editorChanged(); return; }
  if (target.dataset.removePending !== undefined) { pendingFiles.splice(Number(target.dataset.removePending),1); renderFiles(); editorChanged(); return; }
  if (target.dataset.editCategory) { const c = state.categories.find(c => c.id === Number(target.dataset.editCategory)); categoryEditing = c.id; $('#category-name').value = c.name; $('#category-color').value = c.color; $('#save-category').textContent = '更新'; $('#cancel-category-edit').hidden = false; $('#category-name').focus(); return; }
  if (target.dataset.deleteCategory) {
    const id = Number(target.dataset.deleteCategory), category = state.categories.find(c => c.id === id);
    if (!await confirmAction(`「${category.name}」を削除します。メモとタグは残り、メモのカテゴリは「未分類」になります。`)) return;
    try { await api(`/api/categories/${id}`,{method:'DELETE'}); if (state.category === String(id)) state.category = null; await refresh(); toast('カテゴリを削除しました'); } catch (error) { $('#category-error').textContent = error.message; } return;
  }
  const article = target.closest('[data-note]');
  if (article && (target.dataset.action || target.classList.contains('card-content'))) { const note = state.notes.find(n => n.id === Number(article.dataset.note)); if (note) await noteAction(target.dataset.action || 'edit',note); }
});
$('#notes-board').addEventListener('dragstart',event => { const card = event.target.closest('[data-note]'); if (state.view !== 'board' || !card || event.target.closest('a')) return; dragId = Number(card.dataset.note); event.dataTransfer.setData('text/plain',String(dragId)); event.dataTransfer.effectAllowed = 'move'; card.classList.add('dragging'); });
$('#notes-board').addEventListener('dragover',event => { const lane = event.target.closest('[data-lane]'); if (lane && dragId !== null) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over')); lane.classList.add('drag-over'); } });
$('#notes-board').addEventListener('drop',async event => {
  const lane = event.target.closest('[data-lane]'); if (!lane || dragId === null) return; event.preventDefault();
  const id = dragId, category = lane.dataset.lane === 'uncategorized' ? '' : lane.dataset.lane; dragId = null;
  document.querySelectorAll('.drag-over,.dragging').forEach(el => el.classList.remove('drag-over','dragging'));
  try { await updateNote(id,{category_id:category}); await refresh(); toast('カテゴリを変更しました'); } catch (error) { toast(error.message); }
});
$('#notes-board').addEventListener('dragend',() => { dragId = null; document.querySelectorAll('.drag-over,.dragging').forEach(el => el.classList.remove('drag-over','dragging')); });
$('#composer').onclick = () => openEditor(); $('#empty-add').onclick = () => openEditor();
$('#edit-tab').onclick = () => setPreview(false); $('#preview-tab').onclick = () => setPreview(true);
$('#memo-files').onchange = event => { pendingFiles.push(...event.target.files); event.target.value = ''; renderFiles(); editorChanged(); };
$('#editor-dialog').addEventListener('cancel',event => { event.preventDefault(); closeEditor(); });
$('#manage-categories').onclick = openCategoryManager; $('#add-category').onclick = openCategoryManager; $('#editor-add-category').onclick = openCategoryManager;
$('#cancel-category-edit').onclick = () => { categoryEditing = null; $('#category-name').value = ''; $('#save-category').textContent = '追加'; $('#cancel-category-edit').hidden = true; };
$('#menu-button').onclick = () => { if (matchMedia('(max-width:760px)').matches) setMenu(!document.body.classList.contains('menu-open')); else { document.body.classList.toggle('sidebar-hidden'); $('#menu-button').setAttribute('aria-expanded',String(!document.body.classList.contains('sidebar-hidden'))); } }; $('#scrim').onclick = () => setMenu(false);
$('#theme-button').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
$('#refresh-button').onclick = refresh; $('#load-more').onclick = () => loadNotes(true);
let searchTimer;
$('#search').addEventListener('input',event => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.query = event.target.value.trim(); renderFilters(); loadNotes(); },250); });
document.addEventListener('keydown',event => { if (event.key === '/' && !event.ctrlKey && !event.metaKey && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !document.querySelector('dialog[open]')) { event.preventDefault(); $('#search').focus(); } if (event.key === 'Escape') setMenu(false); });
$('#logout-button').onclick = async () => { try { const result = await api('/api/logout',{method:'POST'}); if (result.logoutUrl) location.assign(result.logoutUrl); else showLogin(); } catch (error) { toast(error.message); } };
$('#login-form').addEventListener('submit',async event => { event.preventDefault(); const button = $('#login-form button'); button.disabled = true; $('#login-error').textContent = ''; try { await api('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:$('#username').value,password:$('#password').value})}); $('#password').value = ''; await start(); } catch (error) { $('#login-error').textContent = error.message; } finally { button.disabled = false; } });
async function start() {
  try { const session = await api('/api/session'); $('#logout-button').textContent = (session.email || session.username || 'M')[0].toUpperCase(); $('#logout-button').title = `${session.email || session.username} — ログアウト`; $('#login-screen').hidden = true; $('#app').hidden = false; renderFilters(); await refresh(); }
  catch { showLogin(); }
}
start();
