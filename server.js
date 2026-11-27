import http from 'node:http';
import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import tls from 'node:tls';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeComparable, validateClaim } from './lib/claim-validation.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const chunkerVersion = 'section-overlap-v2';
// Minimal .env reader; secrets stay out of source control.
if (existsSync(path.join(root, '.env'))) {
  for (const line of (await readFile(path.join(root, '.env'), 'utf8')).split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
const stateDir=path.resolve(root,process.env.STATE_DIR||'data');
await mkdir(stateDir,{recursive:true});
const registry = JSON.parse(await readFile(path.join(root, 'data/registry.json'), 'utf8'));
const docs = await Promise.all(registry.map(async d => {
  const { text: _demoExcerpt, ...meta } = d;
  try { return { ...meta, text: await readFile(path.join(root, 'data/source_docs', d.sourceFile), 'utf8') }; }
  catch { return { ...meta, text: '' }; }
}));
const glossary = JSON.parse(await readFile(path.join(root, 'data/glossary.json'), 'utf8'));
const uppercaseOnlyGlossary = new Set(Object.keys(glossary).filter(term => [...term].length <= 2 && /\p{L}/u.test(term)));
let verifiedExperiences = [];
try { verifiedExperiences = JSON.parse(await readFile(path.join(stateDir, 'verified_experiences.json'), 'utf8')); } catch {}
const port = Number(process.env.PORT || 3000);

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}
function normalize(s) {
  let out = String(s || '').replace(/ё/gi, match => match === 'Ё' ? 'Е' : 'е');
  for (const [short, expansion] of Object.entries(glossary)) {
    const token = short.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const uppercaseOnly = uppercaseOnlyGlossary.has(short);
    const pattern = uppercaseOnly ? short.toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : token;
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, uppercaseOnly ? 'gu' : 'giu'), match => `${match} ${expansion}`);
  }
  return normalizeComparable(out);
}
const stopWords = new Set('как что где когда кто кому кем какой какая какие можно ли нужно надо для при в на по из с от или это если быть сколько проект проекта проекту проектом проекты срок сроки срока сроках работа работы работ сегодня завтра вчера понедельник вторник среду среда четверг пятницу пятница субботу суббота воскресенье крайний раз срочно быстро быстрее сейчас потом дальше вообще просто очень может могли должен должны обязаны обязан прокатит завернут завернуть значит сказали мне нам я ты вы он она они мы уже прямо сам сама сами устно так тогда все всё таки ли то-то кто-то что-то как-то там тут не ну вот же ведь ещё еще клиент клиенту заказчику заказчик написал написала спросил спросила получается делать делает сделать будет будут было быть именно создал создала создать создали приложил приложила приложить добавил добавила добавили хватает хватило хватит один одна одного два двух две двое три трех трёх четыре четырех четыре пять пяти семь семи полгода месяце месяцев год лет один-два два-три прошло прошла прошли купил купила купить купили объяснили объяснил объяснила основу основа всех обоих обеих другого другая другая дирекция дбрцт'.split(' '));
// Keep spelled-out durations as searchable terms; their numeric forms differ in source documents.
for (const term of 'один одна одного два двух две двое три трех трёх четыре четырех пять пяти семь семи полгода месяце месяцев год лет'.split(' ')) stopWords.delete(term);
function tokenMatches(token, word) {
  const stem=value=>{
    const suffixes=['иями','ями','ами','ого','его','ому','ему','ыми','ими','ую','юю','ая','яя','ое','ее','ые','ых','их','ие','ия','ий','ый','ой','ей','ым','им','ом','ем','ах','ях','ам','ям','ов','ев','ок','ек','ы','и','а','я','о','е','у','ю','ь','й'];
    for(const suffix of suffixes)if(value.length-suffix.length>=3&&value.endsWith(suffix))return value.slice(0,-suffix.length);
    return value;
  };
  return word===token||stem(word)===stem(token);
}
function unitsMentioned(text) {
  const words=normalizeComparable(text).split(/\s+/).filter(Boolean);
  const units=[...new Set(registry.map(d=>d.unit))];
  return units.filter(unit=>registry.filter(d=>d.unit===unit).some(doc=>{
    const aliases=[unit,...(doc.aliases||[])];
    return aliases.some(alias=>{
      const parts=normalizeComparable(alias).split(/\s+/).filter(Boolean);
      return parts.length>0&&parts.every(part=>words.some(word=>tokenMatches(part,word)));
    });
  }));
}
function sections(d) {
  const lines = d.text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const out = []; let section = '', buffer = [];
  const flush = () => {
    let value=buffer.join(' ').trim();
    while(value.length>1600){out.push({section,text:value.slice(0,1600)});value=value.slice(1420);}
    if(value)out.push({section,text:value});
    buffer=[];
  };
  for (const line of lines) {
    const heading = line.match(/^(\d+(?:\.\d+)*\.?)(?:\s+)(.*)$/);
    if (heading && (line.length < 180 || /^\d+(?:\.\d+){1,3}\./.test(line))) { flush(); section = heading[1].replace(/\.$/, ''); buffer.push(line); }
    else {
      buffer.push(line);
      if (buffer.join(' ').length > 1800) flush();
    }
  }
  flush();
  if (!out.length && d.text) out.push({ section: '', text: d.text.slice(0, 1800) });
  return out;
}
function sourceSection(documentId,sectionNo){
  const doc=docs.find(d=>d.id===documentId);
  if(!doc)return null;
  const part=sections(doc).find(s=>s.section===sectionNo);
  return part?{...doc,section:part.section,excerpt:part.text}:null;
}
const dbPath=path.resolve(root,process.env.DB_PATH||path.join(stateDir,'mvp.sqlite'));
const db = new DatabaseSync(dbPath);
db.exec(`PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, unit TEXT NOT NULL, process TEXT,
  version TEXT, status TEXT, source TEXT, url TEXT, tags_json TEXT,
  content_hash TEXT NOT NULL, indexed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  section TEXT, chunk_no INTEGER NOT NULL, content TEXT NOT NULL,
  embedding_json TEXT, embedding_model TEXT, embedding_dim INTEGER
);
CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_documents_unit ON documents(unit);
CREATE TABLE IF NOT EXISTS glossary (term TEXT PRIMARY KEY, expansion TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS approved_answers (
  id TEXT PRIMARY KEY, topic TEXT NOT NULL, text TEXT NOT NULL, unit TEXT,
  status TEXT NOT NULL, source TEXT NOT NULL, approved_at TEXT NOT NULL
);`);
// Migrate early MVP databases that used `answer` instead of `text`.
const approvedColumns=db.prepare('PRAGMA table_info(approved_answers)').all().map(column=>column.name);
if(!approvedColumns.includes('text')){
  db.exec('ALTER TABLE approved_answers ADD COLUMN text TEXT');
  if(approvedColumns.includes('answer'))db.exec('UPDATE approved_answers SET text=answer WHERE text IS NULL');
}
const hasLegacyAnswerColumn=approvedColumns.includes('answer');
const findDocHash=db.prepare('SELECT content_hash FROM documents WHERE id=?');
const upsertDoc=db.prepare(`INSERT INTO documents(id,title,unit,process,version,status,source,url,tags_json,content_hash,indexed_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,unit=excluded.unit,process=excluded.process,
  version=excluded.version,status=excluded.status,source=excluded.source,url=excluded.url,tags_json=excluded.tags_json,content_hash=excluded.content_hash,indexed_at=excluded.indexed_at`);
const insertChunk=db.prepare('INSERT INTO chunks(id,document_id,section,chunk_no,content) VALUES(?,?,?,?,?)');
db.exec('BEGIN IMMEDIATE');
try{
  const registeredIds=new Set(docs.map(doc=>doc.id));
  for(const row of db.prepare('SELECT id FROM documents').all())if(!registeredIds.has(row.id))db.prepare('DELETE FROM documents WHERE id=?').run(row.id);
  for(const doc of docs){
    const hash=createHash('sha256').update(`${chunkerVersion}\n${doc.text||''}`).digest('hex');
    const old=findDocHash.get(doc.id)?.content_hash;
    upsertDoc.run(doc.id,doc.title,doc.unit,doc.process,doc.version,doc.status,doc.source,doc.url,JSON.stringify(doc.tags),hash,new Date().toISOString());
    if(old!==hash){
      db.prepare('DELETE FROM chunks WHERE document_id=?').run(doc.id);
      if(doc.text)sections(doc).forEach((chunk,i)=>insertChunk.run(`${doc.id}:${chunk.section||'intro'}:${i}`,doc.id,chunk.section,i,chunk.text));
    }
  }
  db.exec('COMMIT');
}catch(error){db.exec('ROLLBACK');throw error;}
const upsertGlossary=db.prepare('INSERT INTO glossary(term,expansion) VALUES(?,?) ON CONFLICT(term) DO UPDATE SET expansion=excluded.expansion');
for(const [term,expansion] of Object.entries(glossary))upsertGlossary.run(term,expansion);
const upsertApproved=db.prepare(hasLegacyAnswerColumn
  ? `INSERT INTO approved_answers(id,topic,text,unit,status,source,approved_at,answer) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET topic=excluded.topic,text=excluded.text,unit=excluded.unit,status=excluded.status,source=excluded.source,approved_at=excluded.approved_at,answer=excluded.answer`
  : `INSERT INTO approved_answers(id,topic,text,unit,status,source,approved_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET topic=excluded.topic,text=excluded.text,unit=excluded.unit,status=excluded.status,source=excluded.source,approved_at=excluded.approved_at`);
const saveApproved=item=>hasLegacyAnswerColumn
  ?upsertApproved.run(item.id,item.topic,item.text,item.unit,item.status,item.source,item.approvedAt||new Date().toISOString(),item.text)
  :upsertApproved.run(item.id,item.topic,item.text,item.unit,item.status,item.source,item.approvedAt||new Date().toISOString());
const insertLegacyApproved=db.prepare(hasLegacyAnswerColumn
  ?'INSERT OR IGNORE INTO approved_answers(id,topic,text,unit,status,source,approved_at,answer) VALUES(?,?,?,?,?,?,?,?)'
  :'INSERT OR IGNORE INTO approved_answers(id,topic,text,unit,status,source,approved_at) VALUES(?,?,?,?,?,?,?)');
for(const item of verifiedExperiences){
  const params=[item.id,item.topic,item.text,item.unit,item.status,item.source,item.approvedAt||new Date().toISOString()];
  insertLegacyApproved.run(...(hasLegacyAnswerColumn?[...params,item.text]:params));
}
function loadApprovedAnswers(){return db.prepare('SELECT id,topic,text,unit,status,source,approved_at AS approvedAt FROM approved_answers WHERE status=?').all('approved').map(row=>({id:row.id,topic:row.topic,text:row.text,unit:row.unit,status:row.status,source:row.source,approvedAt:row.approvedAt}));}
const approvedRows=loadApprovedAnswers();
if(approvedRows.length)verifiedExperiences=approvedRows;

function cosine(a,b){if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length||!a.length)return 0;let dot=0,na=0,nb=0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];}return na&&nb?dot/(Math.sqrt(na)*Math.sqrt(nb)):0;}
const embeddingSignature=process.env.EMBEDDINGS_BASE_URL&&process.env.EMBEDDINGS_MODEL
  ?createHash('sha256').update(`${process.env.EMBEDDINGS_BASE_URL.replace(/\/$/,'')}|${process.env.EMBEDDINGS_MODEL}`).digest('hex').slice(0,16)
  :null;
async function getEmbeddings(inputs){
  if(!process.env.EMBEDDINGS_BASE_URL||!process.env.EMBEDDINGS_MODEL)return null;
  const headers={'content-type':'application/json'};const apiKey=process.env.EMBEDDINGS_API_KEY||process.env.POLZA_RUNTIME_API_KEY;if(apiKey)headers.authorization=`Bearer ${apiKey}`;
  const response=await fetch(`${process.env.EMBEDDINGS_BASE_URL.replace(/\/$/,'')}/embeddings`,{method:'POST',headers,body:JSON.stringify({model:process.env.EMBEDDINGS_MODEL,input:inputs}),signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error(`Embeddings endpoint ответил ${response.status}`);
  const data=await response.json();return data.data?.sort((a,b)=>a.index-b.index).map(x=>x.embedding)||null;
}
async function ensureEmbeddingIndex(){
  if(!process.env.EMBEDDINGS_BASE_URL||!process.env.EMBEDDINGS_MODEL)return;
  const rows=db.prepare('SELECT id,content FROM chunks WHERE embedding_json IS NULL OR COALESCE(embedding_model,\'\')<>?').all(embeddingSignature);
  const update=db.prepare('UPDATE chunks SET embedding_json=?,embedding_model=?,embedding_dim=? WHERE id=?');
  try{
    for(let i=0;i<rows.length;i+=24){const batch=rows.slice(i,i+24),vectors=await getEmbeddings(batch.map(x=>x.content));if(!vectors||vectors.length!==batch.length)throw new Error('Размер ответа embedding не совпал');for(let j=0;j<batch.length;j++)update.run(JSON.stringify(vectors[j]),embeddingSignature,vectors[j].length,batch[j].id);}
  }catch(error){console.warn(`Семантический индекс не обновлён; останется поиск по словам: ${error.message}`);}
}
void ensureEmbeddingIndex();
function embeddingsReady(){
  if(!embeddingSignature)return false;
  const vectors=db.prepare('SELECT COUNT(*) AS n FROM chunks WHERE embedding_json IS NOT NULL AND embedding_model=?').get(embeddingSignature).n;
  return vectors>0&&vectors===db.prepare('SELECT COUNT(*) AS n FROM chunks').get().n;
}

async function search(q, unit = '') {
  const terms = [...new Set(normalize(q).split(/\s+/).filter(t => t.length > 2 && !stopWords.has(t)))];
  let queryVector=null;
  const indexedVectors=embeddingSignature?db.prepare('SELECT COUNT(*) AS n FROM chunks WHERE embedding_json IS NOT NULL AND embedding_model=?').get(embeddingSignature).n:0;
  const totalChunks=db.prepare('SELECT COUNT(*) AS n FROM chunks').get().n;
  if(indexedVectors>0&&indexedVectors===totalChunks)try{const embedded=await getEmbeddings([q]);queryVector=embedded?.[0]||null;}catch{}
  if (terms.length < 1 && !queryVector) return [];
  const matches = [];
  const chunks=db.prepare(`SELECT c.id,c.section,c.content,c.embedding_json,c.embedding_model,c.embedding_dim,d.id AS doc_id,d.title,d.unit,d.process,d.version,d.url,d.tags_json
    FROM chunks c JOIN documents d ON d.id=c.document_id ${unit?'WHERE d.unit=?':''}`).all(...(unit?[unit]:[]));
  for (const c of chunks) {
      const tags=JSON.parse(c.tags_json||'[]');
      const metadata = normalize(`${c.title} ${c.unit} ${c.process} ${tags.join(' ')}`);
      const words = normalize(c.content).split(/\s+/);
      const hits = terms.filter(t => words.some(w => tokenMatches(t, w)));
      let phraseHits=0;
      for(let i=0;i<terms.length-1;i++){
        const first=[],second=[];
        words.forEach((word,index)=>{if(tokenMatches(terms[i],word))first.push(index);if(tokenMatches(terms[i+1],word))second.push(index);});
        if(first.some(a=>second.some(b=>b>a&&b-a<=4)))phraseHits++;
      }
      const metaHits = terms.filter(t => normalize(metadata).split(/\s+/).some(w => tokenMatches(t,w))).length;
      const vector=c.embedding_json?JSON.parse(c.embedding_json):null;
      const compatibleVector=queryVector&&vector&&c.embedding_model===embeddingSignature&&c.embedding_dim===queryVector.length?vector:null;
      const similarity=compatibleVector?cosine(queryVector,compatibleVector):0;
      const hasVector=Boolean(compatibleVector);
      const phraseBoost=Math.min(1.8,phraseHits*0.6);
      const score=hasVector?(hits.length*0.55+phraseBoost+Math.min(0.2,metaHits*0.05)+similarity*2.2):hits.length+phraseBoost+Math.min(0.3,metaHits*0.1);
      const relevant=hasVector||score>=Math.min(0.8,terms.length);
      if(relevant)matches.push({id:c.doc_id,title:c.title,unit:c.unit,process:c.process,version:c.version,url:c.url,excerpt:c.content,section:c.section,score,hasVector,coverage:hits.length/Math.max(1,terms.length)});
  }
  matches.sort((a,b) => b.score - a.score);
  if (!matches.length) return [];
  if(!queryVector&&matches[0].coverage<0.25)return [];
  // Multi-part questions often need two adjacent sections with slightly different lexical scores.
  const relevanceFloor = Math.max(matches[0].hasVector?0:0.8, matches[0].score - (matches[0].hasVector?3.5:2.2));
  const relevant = matches.filter(m => m.score >= relevanceFloor);
  // Keep the strongest evidence across documents, while allowing more than one section per source.
  const picked = [], perDoc = new Map(), seenSections = new Set();
  const addMatch=(m,requireNewSection)=>{
    const count=perDoc.get(m.id)||0, sectionKey=`${m.id}:${m.section||''}`;
    if(count>=20||(requireNewSection&&seenSections.has(sectionKey)))return;
    picked.push(m);perDoc.set(m.id,count+1);seenSections.add(sectionKey);
  };
  // Prefer different sections over duplicate chunks from a single long section.
  for(const m of relevant){addMatch(m,true);if(picked.length>=20)break;}
  if(picked.length<20)for(const m of relevant){if(!picked.includes(m))addMatch(m,false);if(picked.length>=20)break;}
  return picked;
}
async function searchScope(q, units = []) {
  if(units.length<=1)return search(q,units[0]||'');
  const results=await Promise.all(units.map(unit=>search(q,unit)));
  const firstPerUnit=results.map(group=>group[0]).filter(Boolean);
  const rest=results.flat().filter(source=>!firstPerUnit.includes(source)).sort((a,b)=>b.score-a.score);
  return [...firstPerUnit,...rest].slice(0,20);
}
function mergeSources(...groups) {
  const unique=new Map();
  for(const source of groups.flat()){
    const key=`${source.id}:${source.section||''}`;
    const prior=unique.get(key);
    if(!prior||source.score>prior.score)unique.set(key,source);
  }
  const all=[...unique.values()], units=[...new Set(all.map(x=>x.unit))];
  const first=units.map(unit=>all.filter(x=>x.unit===unit).sort((a,b)=>b.score-a.score)[0]);
  return [...first,...all.filter(x=>!first.includes(x)).sort((a,b)=>b.score-a.score)].slice(0,20);
}
async function rerankSources(question,candidates,requiredUnits=[]) {
  if(candidates.length<=3)return candidates;
  const key=process.env.POLZA_RUNTIME_API_KEY;
  if(!key)return candidates.slice(0,4);
  try{
    console.warn('Rerank candidates:',candidates.map(s=>`${s.id}:${s.section||'n/a'}`).join(','));
    const response=await fetch(`${process.env.POLZA_BASE_URL||'https://polza.ai/api/v1'}/chat/completions`,{
      method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},signal:AbortSignal.timeout(45000),
      body:JSON.stringify({model:process.env.RERANK_MODEL||process.env.POLZA_MODEL||'qwen/qwen3.8-flash',temperature:0,max_tokens:2000,enable_thinking:false,reasoning_effort:'none',response_format:{type:'json_object'},messages:[
        {role:'system',content:'Ты ранжируешь фрагменты корпоративных регламентов для поиска. Сравнивай не общие совпадающие слова, а то, содержит ли фрагмент правило, которое прямо отвечает на вопрос, с учётом объекта, этапа, подразделения и условий. Ничего не отвечай и не выводи фактов. Верни только JSON вида {"ranked":[{"i":1,"score":10},...]}: индекс фрагмента и оценка от 0 до 10. Если фрагмент лишь похож по теме, но ответа не содержит, оцени низко.'},
        {role:'user',content:`/no_think\nВопрос: ${question}\n\nКандидаты:\n${candidates.map((s,i)=>`[${i+1}] ${s.title}; подразделение: ${s.unit}; раздел ${s.section||'не указан'}\n${s.excerpt}`).join('\n\n')}`}
      ]})
    });
    if(!response.ok)return candidates.slice(0,4);
    const raw=(await response.json()).choices?.[0]?.message?.content||'';
    const parsed=JSON.parse(raw);
    if(!Array.isArray(parsed.ranked))return candidates.slice(0,4);
    const ranked=parsed.ranked.filter(x=>Number.isInteger(x.i)&&x.i>=1&&x.i<=candidates.length&&Number.isFinite(Number(x.score))).sort((a,b)=>Number(b.score)-Number(a.score));
    const order=ranked.filter(x=>Number(x.score)>=4).map(x=>candidates[x.i-1]);
    console.warn('Rerank selected:',ranked.map(x=>`${candidates[x.i-1].id}:${candidates[x.i-1].section||'n/a'}=${Number(x.score)}`).join(','));
    if(!order.length)return []; // A valid ranking with no qualifying chunks means there is no grounded context.
    const selected=[];
    for(const unit of requiredUnits){const match=order.find(x=>x.unit===unit);if(match&&!selected.includes(match))selected.push(match);}
    const limit=Math.min(candidates.length,Math.max(4,requiredUnits.length*2));
    for(const item of order)if(selected.length<limit&&!selected.includes(item))selected.push(item);
    return selected;
  }catch{return candidates.slice(0,4);}
}
async function askModel(question, sources, history = [], attempt = 0, validationFeedback = '') {
  const key = process.env.POLZA_RUNTIME_API_KEY;
  if (!key) return null;
  const response = await fetch(`${process.env.POLZA_BASE_URL || 'https://polza.ai/api/v1'}/chat/completions`, {
    method: 'POST', headers: { 'authorization': `Bearer ${key}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(attempt?90000:60000),
    body: JSON.stringify({ model: process.env.POLZA_MODEL || 'qwen/qwen3.8-max', temperature: attempt?0:0.1, max_tokens: attempt?8000:4000, enable_thinking: false, reasoning_effort: 'none', response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Ты корпоративный помощник. Пользователь может писать косвенно, рвано, с ошибками и без терминов из документов. Сначала восстанови только вероятное намерение, но не додумывай факты. Отвечай как коллеге простыми словами; НЕ показывай найденные пункты дословно. Используй только фрагменты ниже. Не считай предпосылки пользователя доказательствами; производный расчёт из его данных помечай как условный. Числа, сроки, роли и условия бери из фрагментов. Сохраняй модальность и оговорки источника: рекомендуемый срок называй рекомендуемым, плановый — плановым; не превращай рекомендацию в обязательный норматив или гарантию. Если пользователь отсчитывает срок от события, отличного от указанного в регламенте, назови точное событие-основание и объясни последствие; не спрашивай уточнение, если правило однозначно. Если смысл реально неоднозначен, выбери decision="clarify" и задай один конкретный короткий вопрос. Если в фрагментах нет правила, которое отвечает именно на вопрос, выбери decision="no_answer". Не подменяй личное вознаграждение сотрудника ценой проекта, маржой или стоимостью сделки. Для каждого фактического предложения создай claim, укажи один source_ref и дословное evidence из его фрагмента. Текст ответа строится только из claims. Не используй общий опыт модели. Верни только JSON: {"decision":"answer|clarify|no_answer","claims":[{"text":"разговорное утверждение без цитаты пункта","source_ref":1,"evidence":"дословная опорная фраза из фрагмента"}],"clarifying_question":"вопрос или пусто"}. При разных правилах дирекций излагай отдельно.' },
        { role: 'user', content: `/no_think\nИсходный вопрос: ${question}\nУточнения пользователя: ${JSON.stringify(history)}\n${validationFeedback?`\nПри предыдущей проверке найдено: ${validationFeedback}. Пересобери ответ так, чтобы каждое утверждение было подтверждено фрагментом. Если это невозможно, выбери no_answer.\n`:''}\nПодтверждённые фрагменты (единственная база фактов):\n${sources.map((d,i)=>`[${i+1}] ${d.title}, подразделение: ${d.unit}, раздел ${d.section || 'не указан'}:\n${d.excerpt}`).join('\n\n')}` }
      ]
    })
  });
  if (!response.ok) throw new Error(`Polza API вернул ${response.status}`);
  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content;
  if (!raw && attempt===0) return askModel(question,sources,history,1);
  if (!raw) throw new Error(`Qwen returned empty content (finish_reason=${data.choices?.[0]?.finish_reason||'unknown'}; message_fields=${Object.keys(data.choices?.[0]?.message||{}).join(',')})`);
  let result;
  try {
    result = JSON.parse(raw);
    if (!['answer','clarify','no_answer'].includes(result.decision)) throw new Error('Некорректный тип ответа модели');
    if (result.decision === 'answer') {
      const claims = Array.isArray(result.claims) ? result.claims.slice(0,6) : [];
      if (!claims.length) throw new Error('Ответ модели не содержит проверяемых утверждений');
      for (const claim of claims) {
        const ref=claim.source_ref, evidence=String(claim.evidence||'').trim();
        const evidenceWords=normalize(evidence).split(/\s+/).filter(word=>word.length>=3);
        if (!claim.text?.trim() || !Number.isInteger(ref) || ref<1 || ref>sources.length || evidenceWords.length<3) throw new Error('Не хватает подтверждения для ответа');
        const normalizedEvidence=normalizeComparable(evidence);
        const normalizedSource=normalizeComparable(sources[ref-1].excerpt);
        if (!normalizedSource.includes(normalizedEvidence)) throw new Error('Опора ответа не найдена в документе');
        validateClaim(claim.text,evidence);
      }
      const refs=[...new Set(claims.map(c=>c.source_ref))];
      return { ...result, claims, citation_refs: refs, answer: claims.map(c=>`${c.text.trim()} [${c.source_ref}]`).join(' ') };
    }
    if (result.decision === 'clarify' && !result.clarifying_question?.trim()) throw new Error('Нет текста уточнения');
    return result;
  } catch(error) {
    if(attempt===0)return askModel(question,sources,history,1,error.message);
    throw error;
  }
}
async function expandSearch(question, history = []) {
  const key = process.env.POLZA_RUNTIME_API_KEY;
  if (!key) return null;
  const response = await fetch(`${process.env.POLZA_BASE_URL || 'https://polza.ai/api/v1'}/chat/completions`, {
    method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ model: process.env.POLZA_MODEL || 'qwen/qwen3.8-max', temperature: 0, max_tokens: 500, enable_thinking: false, reasoning_effort: 'none', response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Преобразуй неформальный или рваный вопрос в поисковые слова для корпоративных регламентов: сохрани ключевые слова пользователя и добавь их нейтральные корпоративные эквиваленты, когда регламент может называть тот же смысл иначе. Это только запрос для поиска, не ответ. Не добавляй цифры, сроки, роли, решения или новые обстоятельства. Если можно понять два разных намерения, задай один короткий вопрос и верни пустые search_terms. Верни только JSON: {"search_terms":["..."],"clarifying_question":"..."}. До 8 терминов.' },
        { role: 'user', content: `/no_think\nВопрос: ${question}\nУточнения: ${JSON.stringify(history)}` }
      ]
    })
  });
  if (!response.ok) throw new Error('Не удалось уточнить намерение');
  const raw = (await response.json()).choices?.[0]?.message?.content;
  const result = JSON.parse(raw || '{}');
  return { terms: Array.isArray(result.search_terms) ? result.search_terms.filter(x=>typeof x==='string').slice(0,6).map(x=>x.slice(0,60)) : [], clarification: String(result.clarifying_question||'').slice(0,250) };
}
let logWriteQueue=Promise.resolve();
function logEvent(event) {
  const operation=logWriteQueue.then(async()=>{
  const file = path.join(stateDir, 'logs.jsonl');
  let raw='';
  try { raw=await readFile(file, 'utf8'); } catch {}
  let current=[];
  for(const line of raw.split(/\r?\n/).filter(Boolean))try{current.push(JSON.parse(line));}catch{}
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  current = current.filter(e => Date.parse(e.at) >= cutoff);
  current.push({ at: new Date().toISOString(), ...event });
  await writeFile(file, current.map(e=>JSON.stringify(e)).join('\n') + '\n');
  });
  logWriteQueue=operation.catch(()=>{});
  return operation;
}
async function bodyJson(req) {
  let body = ''; for await (const chunk of req) body += chunk;
  if (body.length > 20000) throw new Error('Слишком большой запрос');
  return JSON.parse(body || '{}');
}
async function readList(name) {
  try {
    const list = JSON.parse(await readFile(path.join(stateDir, name), 'utf8'));
    if (name === 'quality_queue.json') return list.filter(x=>Date.now()-Date.parse(x.createdAt)<30*24*60*60*1000);
    return list;
  } catch { return []; }
}
async function writeList(name, list) {
  const file = path.join(stateDir, name);
  const temp = `${file}.tmp`;
  await writeFile(temp, JSON.stringify(list, null, 2));
  const { rename } = await import('node:fs/promises');
  await rename(temp, file);
}
function isQualityAdmin(req) {
  const expected = process.env.QUALITY_ADMIN_TOKEN;
  return Boolean(expected && req.headers.authorization === `Bearer ${expected}`);
}
async function sendGmailMail({ to, cc, replyTo, subject, text }) {
  const username = process.env.GMAIL_SMTP_USER;
  const appPassword = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, '');
  if (!username || !appPassword) return { sent: false, reason: 'Gmail SMTP не настроен' };
  const socket = tls.connect({ host: process.env.GMAIL_SMTP_HOST || 'smtp.gmail.com', port: Number(process.env.GMAIL_SMTP_PORT || 465), servername: 'smtp.gmail.com' });
  socket.setTimeout(15000,()=>socket.destroy(new Error('Таймаут Gmail SMTP')));
  let buffer='', lines=[], waiter=null;
  const queued=[];
  socket.on('error',error=>{if(waiter){const pending=waiter;waiter=null;pending.reject(error);}});
  socket.on('data',chunk=>{
    buffer+=chunk.toString('utf8');
    let newline;
    while((newline=buffer.indexOf('\r\n'))>=0){
      const line=buffer.slice(0,newline);buffer=buffer.slice(newline+2);lines.push(line);
      if(/^\d{3} /.test(line)){
        const result=lines;lines=[];
        if(waiter){const done=waiter;waiter=null;done.resolve(result);}else queued.push(result);
      }
    }
  });
  const readResponse=()=>queued.length?Promise.resolve(queued.shift()):new Promise((resolve,reject)=>{waiter={resolve,reject};});
  const expect=async(codes)=>{const response=await readResponse();const code=Number(response.at(-1)?.slice(0,3));if(!codes.includes(code))throw new Error(`Gmail SMTP ответил ${code}`);return response;};
  const command=async(command,codes)=>{socket.write(`${command}\r\n`);return expect(codes);};
  try {
    await new Promise((resolve,reject)=>{
      const onError=error=>{socket.off('secureConnect',onConnect);reject(error);};
      const onConnect=()=>{socket.off('error',onError);resolve();};
      socket.once('error',onError);socket.once('secureConnect',onConnect);
    });
    await expect([220]);
    await command('EHLO localhost',[250]);
    await command('AUTH LOGIN',[334]);
    await command(Buffer.from(username).toString('base64'),[334]);
    await command(Buffer.from(appPassword).toString('base64'),[235]);
    await command(`MAIL FROM:<${username}>`,[250]);
    await command(`RCPT TO:<${to}>`,[250,251]);
    if(cc)await command(`RCPT TO:<${cc}>`,[250,251]);
    await command('DATA',[354]);
    const subjectB64=Buffer.from(subject,'utf8').toString('base64');
    const bodyB64=Buffer.from(text,'utf8').toString('base64').match(/.{1,76}/g)?.join('\r\n')||'';
    const message=[`From: ${username}`,`To: ${to}`,...(cc?[`Cc: ${cc}`]:[]),...(replyTo?[`Reply-To: ${replyTo}`]:[]),`Subject: =?UTF-8?B?${subjectB64}?=`,`MIME-Version: 1.0`,'Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','','',bodyB64,'.'].join('\r\n');
    socket.write(`${message}\r\n`);
    await expect([250]);
    await command('QUIT',[221]);
    socket.end();
    return { sent: true };
  } catch(error) { socket.destroy(); throw error; }
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/api/health') {
      const activeEmbeddingModel=process.env.EMBEDDINGS_MODEL || null;
      const vectorCount=embeddingSignature?db.prepare('SELECT COUNT(*) AS n FROM chunks WHERE embedding_json IS NOT NULL AND embedding_model=?').get(embeddingSignature).n:0;
      const chunkCount=db.prepare('SELECT COUNT(*) AS n FROM chunks').get().n;
      return send(res, 200, { ok: true, model: process.env.POLZA_MODEL || 'qwen/qwen3.8-max', keyConfigured: Boolean(process.env.POLZA_RUNTIME_API_KEY), indexedDocuments: docs.filter(d=>d.text).length, registryDocuments: docs.length, chunkCount, embeddingModel: activeEmbeddingModel, embeddedChunks: vectorCount, retrieval: vectorCount===chunkCount&&chunkCount>0 ? 'hybrid' : 'lexical' });
    }
    if (req.method === 'GET' && url.pathname === '/api/units') return send(res, 200, [...new Set(docs.map(d => d.unit))]);
    if (req.method === 'GET' && url.pathname === '/api/registry') return send(res, 200, docs.map(({id,title,unit,process,version,status,source,tags,url})=>({id,title,unit,process,version,status,source,tags,url,indexed:Boolean(docs.find(x=>x.id===id)?.text)})));
    if (req.method === 'POST' && url.pathname === '/api/ask') {
      const input = await bodyJson(req);
      const { question, unit = '', compareAll = false } = input;
      const history = Array.isArray(input.history) ? input.history.filter(x=>typeof x==='string').slice(-2).map(x=>x.slice(0,1000)) : [];
      if (!question?.trim()) return send(res, 400, { error: 'Введите вопрос' });
      if (unit && !docs.some(d => d.unit === unit)) return send(res, 400, { error: 'Неизвестное подразделение' });
      const explicitUnits=unitsMentioned([question,...history].join(' '));
      const searchUnits=explicitUnits.length>1?explicitUnits:(unit?[unit]:explicitUnits);
      let searchQuestion = [question, ...history].filter(Boolean).join(' ');
      const id = randomUUID();
      let sources=await searchScope(searchQuestion,searchUnits);
      let retrievalExpanded=false,expansion=null;
      if(!sources.length||(!embeddingsReady()&&(sources[0]?.coverage||0)<0.45)||searchUnits.length>1){
        try{
          expansion=await expandSearch(question,history);retrievalExpanded=true;
          if(expansion?.terms.length)sources=mergeSources(sources,await searchScope(expansion.terms.join(' '),searchUnits));
          if(!sources.length&&expansion?.clarification&&history.length<2&&searchUnits.length<=1)return send(res,200,{id,status:'clarify',answer:expansion.clarification});
        }catch{/* Keep the retrieval-only path available if query rewriting fails. */}
      }
      if(sources.length>3)sources=await rerankSources(question,sources,searchUnits);
      const asksAcrossUnits=explicitUnits.length>1||compareAll;
      if (!sources.length) {
        await logEvent({ outcome: 'no_source', unit: unit || null });
        const requestedUnits=asksAcrossUnits?(searchUnits.length?searchUnits:[...new Set(docs.map(d=>d.unit))]):[];
        const scopeNote=requestedUnits.length?` по указанным подразделениям (${requestedUnits.join('; ')})`:'';
        return send(res, 200, { id, answer: `В предоставленных материалах${scopeNote} не нашла подтверждённого ответа. Хотите отправить вопрос в службу качества?`, citations: [], sources: [], status: 'escalation' });
      }
      const sourceUnits = [...new Set(sources.map(s=>s.unit))];
      const unresolvedUnits=asksAcrossUnits?searchUnits.filter(named=>!sourceUnits.includes(named)):[];
      if(unresolvedUnits.length){
        await logEvent({outcome:'no_source',unit:null,sourceIds:sources.map(s=>s.id)});
        const found=sourceUnits.join(', ')||'ни одного';
        return send(res,200,{id,status:'escalation',answer:`Нашла подходящие фрагменты только для: ${found}. По ${unresolvedUnits.join(', ')} подтверждённого фрагмента не нашла, поэтому не буду объединять правила в общий ответ. Хотите передать вопрос в службу качества?`,citations:sources.map((s,i)=>({ref:i+1,title:s.title,unit:s.unit,section:s.section,url:s.url})),question,unit:null,history});
      }
      if (!unit && !compareAll && sourceUnits.length > 1 && !asksAcrossUnits) {
        return send(res, 200, { id, status: 'clarify_unit', answer: 'Порядок может отличаться между подразделениями. Для какого центра компетенций или дирекции ищем ответ?', options: sourceUnits });
      }
      const questionTerms = [...new Set(normalize([question,...history].join(' ')).split(/\s+/).filter(t=>t.length>3&&!stopWords.has(t)))];
      const experienceMatches = verifiedExperiences.filter(x => {
        if (!questionTerms.length || x.status !== 'approved' || !x.unit || !sourceUnits.includes(x.unit)) return false;
        const topicTerms=[...new Set(normalize(x.topic).split(/\s+/).filter(t=>t.length>3&&!stopWords.has(t)))];
        const hits=questionTerms.filter(t=>topicTerms.some(w=>tokenMatches(t,w))).length;
        return questionTerms.length>=2&&topicTerms.length>=2&&hits>=2&&hits/Math.min(questionTerms.length,topicTerms.length)>=0.5;
      });
      let generated, answer, status = 'answered', modelNotice = '';
      try {
        generated = await askModel(question, sources, history);
        if(generated?.decision==='no_answer'&&!retrievalExpanded){
          expansion=await expandSearch(question,history);retrievalExpanded=true;
          if(expansion?.terms.length){
            const expandedSources=await searchScope(expansion.terms.join(' '),searchUnits);
            if(expandedSources.length){sources=await rerankSources(question,mergeSources(sources,expandedSources),searchUnits);generated=await askModel(question,sources,history);}
          }
        }
      }
      catch(error) { console.warn(`Qwen answer rejected or unavailable: ${error.message}`); status = 'sources_only'; modelNotice = 'Модель вернула непроверяемый ответ или временно недоступна. Хотите передать вопрос в службу качества?'; }
      if (!generated) { status = 'sources_only'; answer = 'Не могу сейчас сформулировать проверенный ответ. Хотите передать вопрос в службу качества?'; }
      else if (generated.decision === 'clarify') {
        if (history.length >= 2) { status = 'escalation'; answer = 'После двух уточнений я всё ещё не могу выбрать однозначное правило. Хотите передать вопрос специалисту службы качества?'; }
        else { status = 'clarify'; answer = generated.clarifying_question; }
      } else if (generated.decision === 'no_answer') {
        console.warn('No answer; final evidence sections:',sources.map(s=>`${s.id}:${s.section||'n/a'}`).join(','));
        status = 'escalation'; answer = 'В найденных материалах нет подтверждённого ответа именно на этот вопрос. Хотите отправить обращение в службу качества?';
      } else answer = generated.answer;
      await logEvent({ outcome: status, unit: unit || null, sourceIds: sources.map(d=>d.id) });
      const citeRefs = generated?.decision === 'answer' ? generated.citation_refs : (generated?.decision==='no_answer'?[]:sources.map((_,i)=>i+1));
      const citations = citeRefs.map(ref=>{const s=sources[ref-1];return {ref,title:s.title,unit:s.unit,section:s.section,url:s.url};});
      const citedUnits=new Set(citations.map(c=>c.unit).filter(Boolean));
      const answerTerms=[...new Set(normalize((generated?.claims||[]).map(c=>c.text).join(' ')).split(/\s+/).filter(t=>t.length>3&&!stopWords.has(t)))];
      const experiences=status==='answered'?experienceMatches.filter(x=>{
        if(!citedUnits.has(x.unit)||answerTerms.length<2)return false;
        const topicTerms=[...new Set(normalize(x.topic).split(/\s+/).filter(t=>t.length>3&&!stopWords.has(t)))];
        const overlap=topicTerms.filter(t=>answerTerms.some(w=>tokenMatches(t,w))).length;
        return overlap>=2&&overlap/Math.min(topicTerms.length,answerTerms.length)>=0.5;
      }).map(x=>({text:x.text,source:x.source,unit:x.unit,approvedAt:x.approvedAt})):[];
      return send(res, 200, { id, answer, modelNotice, citations, question, unit, history, experiences, status });
    }
    if (req.method === 'POST' && url.pathname === '/api/feedback') {
      const data = await bodyJson(req);
      if (!['helpful','not_helpful','missing'].includes(data.rating)) return send(res, 400, { error: 'Некорректная оценка' });
      await logEvent({ outcome: 'feedback_received', rating: data.rating });
      return send(res, 200, { ok: true, message: 'Спасибо. Оценка сохранена в обезличенной аналитике. Интеграция со службой качества в этом прототипе не подключена.' });
    }
    if (req.method === 'POST' && url.pathname === '/api/quality/requests') {
      const data = await bodyJson(req);
      const question = String(data.question || '').trim();
      if (question.length < 5 || question.length > 2000) return send(res, 400, { error: 'Вопрос должен быть от 5 до 2000 символов' });
      if (data.unit && !docs.some(d=>d.unit===data.unit)) return send(res, 400, { error: 'Неизвестное подразделение' });
      const queue = (await readList('quality_queue.json')).filter(x=>Date.now()-Date.parse(x.createdAt)<30*24*60*60*1000);
      const email = String(data.email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(res, 400, { error: 'Укажите корректный адрес электронной почты' });
      if (data.consent !== true) return send(res, 400, { error: 'Нужно подтвердить отправку вопроса и адреса в службу качества' });
      const ticket = { id: randomUUID(), createdAt: new Date().toISOString(), question, unit: data.unit || null, email, status: 'pending', answer: null };
      queue.push(ticket);
      let delivery = { sent: false };
      try {
        if (process.env.QUALITY_EMAIL) delivery = await sendGmailMail({ to: process.env.QUALITY_EMAIL, cc: email, replyTo: email, subject: `Вопрос по корпоративному регламенту · ${ticket.id.slice(0,8)}`, text: `Вопрос сотрудника:\n${question}\n\nПодразделение: ${ticket.unit || 'не указано'}\nНомер обращения: ${ticket.id}\n\nОтветьте на это письмо через «Ответить всем», чтобы сотрудник получил ответ.` });
      } catch { delivery = { sent: false }; }
      ticket.delivery = delivery.sent ? 'sent' : 'demo_queue';
      await writeList('quality_queue.json', queue);
      await logEvent({ outcome: 'quality_request', unit: ticket.unit });
      const mailto = !delivery.sent && process.env.QUALITY_EMAIL ? `mailto:${process.env.QUALITY_EMAIL}?cc=${encodeURIComponent(email)}&subject=${encodeURIComponent(`Вопрос по регламенту ${ticket.id.slice(0,8)}`)}&body=${encodeURIComponent(`Вопрос: ${question}\nПодразделение: ${ticket.unit || 'не указано'}\nНомер обращения: ${ticket.id}`)}` : null;
      return send(res, 201, { id: ticket.id, status: ticket.status, delivery: ticket.delivery, mailto, message: delivery.sent ? `Письмо принято почтовым шлюзом и отправлено в службу качества с копией на ${email}.` : 'Обращение сохранено в демо-очереди; письмо автоматически не отправлено.' });
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/quality/requests/')) {
      const ticket = (await readList('quality_queue.json')).find(x=>x.id===url.pathname.split('/').pop());
      if (!ticket) return send(res, 404, { error: 'Обращение не найдено' });
      return send(res, 200, { id: ticket.id, status: ticket.status, answer: ticket.answer });
    }
    if (req.method === 'GET' && url.pathname === '/api/quality/admin/requests') {
      if (!isQualityAdmin(req)) return send(res, 401, { error: 'Нужен токен службы качества' });
      return send(res, 200, await readList('quality_queue.json'));
    }
    if (req.method === 'POST' && url.pathname === '/api/quality/admin/answer') {
      if (!isQualityAdmin(req)) return send(res, 401, { error: 'Нужен токен службы качества' });
      const data = await bodyJson(req);
      const answer = String(data.answer || '').trim();
      if (!data.id || answer.length < 5 || answer.length > 3000) return send(res, 400, { error: 'Укажите обращение и ответ до 3000 символов' });
      const queue = await readList('quality_queue.json');
      const ticket = queue.find(x=>x.id===data.id);
      if (!ticket) return send(res, 404, { error: 'Обращение не найдено' });
      if(ticket.status==='answered')return send(res,409,{error:'На это обращение уже ответили'});
      const approved={ id: ticket.id, topic: ticket.question, text: answer, unit: ticket.unit, status: 'approved', source: `Подтверждено службой качества · обращение ${ticket.id.slice(0,8)}`, approvedAt: new Date().toISOString() };
      saveApproved(approved);
      verifiedExperiences=loadApprovedAnswers();
      ticket.answer = answer; ticket.status = 'answered'; ticket.answeredAt = approved.approvedAt;
      await writeList('quality_queue.json', queue);
      if (ticket.email && process.env.QUALITY_EMAIL) {
        try { const sent = await sendGmailMail({ to: ticket.email, cc: process.env.QUALITY_EMAIL, replyTo: process.env.QUALITY_EMAIL, subject: `Ответ службы качества · ${ticket.id.slice(0,8)}`, text: answer }); ticket.answerDelivery = sent.sent ? 'sent' : 'demo_queue'; }
        catch { ticket.answerDelivery = 'demo_queue'; }
        await writeList('quality_queue.json', queue);
      }
      const learned=verifiedExperiences;
      await writeList('verified_experiences.json', learned);
      await logEvent({ outcome: 'quality_answered', unit: ticket.unit });
      return send(res, 200, { ok: true, message: 'Ответ сохранён и добавлен в базу подтверждённых ответов.' });
    }
    if (req.method === 'GET' && url.pathname === '/api/analytics') {
      let entries = []; try { entries = (await readFile(path.join(stateDir, 'logs.jsonl'), 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse); } catch {}
      const byDocument = {};
      for (const event of entries) for (const id of event.sourceIds || []) byDocument[id] = (byDocument[id] || 0) + 1;
      const ratings = {};
      for (const event of entries) if (event.rating) ratings[event.rating] = (ratings[event.rating] || 0) + 1;
      return send(res, 200, { total: entries.length, noSource: entries.filter(e=>e.outcome==='no_source').length, modelUnavailable: entries.filter(e=>e.outcome==='sources_only').length, feedback: ratings, byDocument });
    }
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return send(res, 200, await readFile(path.join(root, 'public/index.html'), 'utf8'), 'text/html; charset=utf-8');
    if (req.method === 'GET' && url.pathname === '/app.css') return send(res, 200, await readFile(path.join(root, 'public/app.css'), 'utf8'), 'text/css; charset=utf-8');
    if (req.method === 'GET' && url.pathname === '/app.js') return send(res, 200, await readFile(path.join(root, 'public/app.js'), 'utf8'), 'text/javascript; charset=utf-8');
    if (req.method === 'GET' && url.pathname === '/quality') return send(res, 200, await readFile(path.join(root, 'public/quality.html'), 'utf8'), 'text/html; charset=utf-8');
    if (req.method === 'GET' && url.pathname === '/quality.js') return send(res, 200, await readFile(path.join(root, 'public/quality.js'), 'utf8'), 'text/javascript; charset=utf-8');
    send(res, 404, { error: 'Не найдено' });
  } catch (e) { send(res, 500, { error: e.message || 'Внутренняя ошибка' }); }
});
server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Process Compass MVP listening on ${process.env.HOST || '127.0.0.1'}:${port}`));
