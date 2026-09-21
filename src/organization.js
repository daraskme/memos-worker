const colors = new Set(['sand', 'sage', 'sky', 'rose', 'lavender', 'peach']);
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const json = (value, status = 200) => Response.json(value, { status });

export function addCategoryFilter(params, clauses, bindings) {
  const category = params.get('category');
  if (!category) return;
  if (category === 'uncategorized') {
    clauses.push('NOT EXISTS (SELECT 1 FROM note_organization o WHERE o.note_id = n.id AND o.category_id IS NOT NULL)');
  } else {
    if (!/^\d+$/.test(category)) fail('カテゴリが正しくありません。');
    clauses.push('EXISTS (SELECT 1 FROM note_organization o WHERE o.note_id = n.id AND o.category_id = ?)');
    bindings.push(Number(category));
  }
}

export async function readOrganization(form, db) {
  if (!form.has('category_id') && !form.has('tags')) return null;
  const data = {};
  if (form.has('category_id')) {
    const value = form.get('category_id');
    if (value !== '' && value !== null && !/^\d+$/.test(String(value))) fail('カテゴリが正しくありません。');
    data.category_id = value === '' || value === null ? null : Number(value);
    if (data.category_id !== null && !await db.prepare('SELECT id FROM categories WHERE id = ?').bind(data.category_id).first()) {
      fail('カテゴリが見つかりません。', 404);
    }
  }
  if (form.has('tags')) {
    let tags;
    try { tags = JSON.parse(form.get('tags')); } catch { fail('タグは配列で指定してください。'); }
    if (!Array.isArray(tags) || tags.length > 30 || tags.some(tag => typeof tag !== 'string' || tag.trim().length > 50)) {
      fail('タグは各50文字以内、30個まで設定できます。');
    }
    data.manual_tags = [...new Set(tags.map(tag => tag.trim().replace(/^#+/, '').toLowerCase()).filter(Boolean))];
  }
  return data;
}

export async function saveOrganization(db, noteId, data) {
  if (!data) return;
  const existing = await db.prepare('SELECT category_id, manual_tags FROM note_organization WHERE note_id = ?').bind(noteId).first();
  const category = Object.hasOwn(data, 'category_id') ? data.category_id : existing?.category_id ?? null;
  const tags = data.manual_tags ? JSON.stringify(data.manual_tags) : existing?.manual_tags ?? '[]';
  await db.prepare(`INSERT INTO note_organization (note_id, category_id, manual_tags) VALUES (?, ?, ?)
    ON CONFLICT(note_id) DO UPDATE SET category_id = excluded.category_id, manual_tags = excluded.manual_tags`).bind(noteId, category, tags).run();
}

export async function decorateNotes(db, notes) {
  if (!notes.length) return notes;
  const ids = notes.map(note => note.id);
  const placeholders = ids.map(() => '?').join(',');
  const [organization, tags] = await db.batch([
    db.prepare(`SELECT o.*, c.name AS category_name, c.color AS category_color FROM note_organization o
      LEFT JOIN categories c ON c.id = o.category_id WHERE o.note_id IN (${placeholders})`).bind(...ids),
    db.prepare(`SELECT nt.note_id, t.name FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
      WHERE nt.note_id IN (${placeholders}) ORDER BY t.name`).bind(...ids),
  ]);
  const byId = new Map(organization.results.map(row => [row.note_id, row]));
  const tagMap = new Map();
  for (const tag of tags.results) {
    if (!tagMap.has(tag.note_id)) tagMap.set(tag.note_id, []);
    tagMap.get(tag.note_id).push(tag.name);
  }
  for (const note of notes) {
    const org = byId.get(note.id);
    note.category_id = org?.category_id ?? null;
    note.category_name = org?.category_name ?? null;
    note.category_color = org?.category_color ?? null;
    note.manual_tags = JSON.parse(org?.manual_tags ?? '[]');
    note.tags = tagMap.get(note.id) ?? [];
  }
  return notes;
}

export async function handleCategories(request, env, id) {
  const db = env.DB;
  try {
    if (request.method === 'GET' && !id) {
      const archived = new URL(request.url).searchParams.get('archived') === 'true' ? 1 : 0;
      const { results } = await db.prepare(`SELECT c.id, c.name, c.color, COUNT(n.id) AS count
        FROM categories c LEFT JOIN note_organization o ON o.category_id = c.id
        LEFT JOIN notes n ON n.id = o.note_id AND n.is_archived = ?
        GROUP BY c.id ORDER BY c.name COLLATE NOCASE`).bind(archived).all();
      const unclassified = await db.prepare(`SELECT COUNT(*) AS count FROM notes n WHERE n.is_archived = ?
        AND NOT EXISTS (SELECT 1 FROM note_organization o WHERE o.note_id = n.id AND o.category_id IS NOT NULL)`).bind(archived).first();
      return json({ categories: results, uncategorized: unclassified.count });
    }
    if (request.method === 'DELETE' && id) {
      // Explicitly clear only the classification; preserve every note and manual tag.
      await db.batch([
        db.prepare('UPDATE note_organization SET category_id = NULL WHERE category_id = ?').bind(id),
        db.prepare('DELETE FROM categories WHERE id = ?').bind(id),
      ]);
      return new Response(null, { status: 204 });
    }
    if ((request.method === 'POST' && !id) || (request.method === 'PUT' && id)) {
      const body = await request.json();
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name || name.length > 50) fail('カテゴリ名は1〜50文字で入力してください。');
      const color = body.color || 'sand';
      if (!colors.has(color)) fail('カテゴリの色が正しくありません。');
      const duplicate = await db.prepare('SELECT id FROM categories WHERE name = ? COLLATE NOCASE').bind(name).first();
      if (duplicate && duplicate.id !== Number(id)) fail('同じ名前のカテゴリがあります。', 409);
      const result = id
        ? await db.prepare('UPDATE categories SET name = ?, color = ? WHERE id = ? RETURNING *').bind(name, color, id).first()
        : await db.prepare('INSERT INTO categories (name, color) VALUES (?, ?) RETURNING *').bind(name, color).first();
      if (!result) fail('カテゴリが見つかりません。', 404);
      return json(result, id ? 200 : 201);
    }
    return json({ error: 'Method not allowed' }, 405);
  } catch (error) {
    return json({ error: error.message }, error.status || 500);
  }
}
