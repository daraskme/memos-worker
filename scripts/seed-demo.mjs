import { readFile } from 'node:fs/promises';

const base = new URL(process.argv[2] || 'http://127.0.0.1:8787');
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
  throw new Error('Demo data may only be added to a local loopback server.');
}
const vars = await readFile(new URL('../.dev.vars', import.meta.url), 'utf8');
const readVar = name => vars.match(new RegExp(`^${name}\\s*=\\s*["']?([^"'\\r\\n]+)["']?\\s*$`, 'm'))?.[1].trim();
let cookie;
async function api(path, options = {}) {
  const response = await fetch(new URL(path, base), { ...options, redirect: 'error', headers: { ...(cookie ? { Cookie: cookie } : {}), ...options.headers } });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  if (path === '/api/login') cookie = response.headers.get('set-cookie')?.split(';')[0];
  return response.status === 204 ? null : response.json();
}
await api('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: readVar('USERNAME'), password: readVar('PASSWORD') }) });
try {
  const [active, archived, taxonomy] = await Promise.all([api('/api/notes?limit=1'), api('/api/notes?limit=1&archived=true'), api('/api/categories')]);
  if (active.notes.length || archived.notes.length || taxonomy.categories.length) throw new Error('Use an empty local database. Existing data will not be changed.');
  const categories = [];
  for (const [name, color] of [['アイデア', 'sand'], ['仕事', 'sky'], ['暮らし', 'sage'], ['読書', 'lavender']]) {
    categories.push(await api('/api/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, color }) }));
  }
  const samples = [
    ['## 小さく、つくってみる\n\n思いついたことは、忘れないうちにメモ。\nまずは一枚のカードから、アイデアを育てる。\n\n- シンプルに始める\n- 使いながら整える', 0, ['ひらめき', 'あとで読む']],
    ['## 今週、やってみたいこと\n\n- 散歩しながら新しい道を見つける\n- 積んでいた本を一章読む\n- 机の上に小さな花を飾る', 2, ['週末', '小さな習慣']],
    ['## 次の打ち合わせ\n\n**水曜日 14:00**\n\n方向性をそろえてから、具体的な作業を決める。\n\n1. 前回の振り返り\n2. 試作のフィードバック\n3. 来週に向けて', 1, ['ミーティング']],
    ['> 答えを急がずに、\n> 問いを持ちつづける。\n\n読書ノートに残しておきたいこと。', 3, ['ことば', 'あとで読む']],
    ['## 買いものリスト\n\n- コーヒー豆\n- オートミール\n- 季節の果物\n- ノート', 2, ['買いもの']],
    ['## 余白のあるデザイン\n\n機能を増やす前に、なくせるものを探してみる。\n\n色は少なく。\n文字は読みやすく。\n大切なものを、見つけやすく。', 1, ['デザイン', 'ひらめき']],
    ['## 読みたい本\n\n気になった一冊を忘れないためのメモ。\n\n本屋で見かけたら、最初の数ページを読んでみる。', 3, ['あとで読む']],
    ['週末は少し早起きして、\nお気に入りのパン屋へ。', 2, ['週末']],
    ['## 次の一歩\n\n完璧にまとまっていなくても、\nまずは書いておく。', null, ['ひらめき']],
  ];
  for (const [content, category, tags] of samples) {
    const form = new FormData();
    form.set('content', content);
    form.set('category_id', category === null ? '' : String(categories[category].id));
    form.set('tags', JSON.stringify(tags));
    await api('/api/notes', { method: 'POST', body: form });
  }
  console.log('Created 9 fictional demo notes and 4 categories in the empty local database.');
} finally {
  await api('/api/logout', { method: 'POST' });
}
