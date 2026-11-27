const $ = selector => document.querySelector(selector);
const result = $('#result');
function esc(value = '') { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

async function init() {
  const [units, registry] = await Promise.all([fetch('/api/units').then(r=>r.json()), fetch('/api/registry').then(r=>r.json())]);
  units.forEach(unit => $('#unit').insertAdjacentHTML('beforeend', `<option>${esc(unit)}</option>`));
  $('#doc-count').textContent = `${registry.length} документа`;
  $('#registry-list').innerHTML = registry.map(doc => `<div class="registry-item"><strong>${esc(doc.title)}</strong>${esc(doc.unit)} · ${esc(doc.process)}<br><span class="hint">${esc(doc.version)} · ${doc.indexed?'текст подключён':'текст не найден'}</span><br>${doc.tags.map(tag=>`<span class="tag">${esc(tag)}</span>`).join('')}</div>`).join('');
  refreshAnalytics();
}

async function refreshAnalytics() {
  const [data, registry] = await Promise.all([fetch('/api/analytics').then(r=>r.json()), fetch('/api/registry').then(r=>r.json())]);
  const labels={helpful:'помог',not_helpful:'неполный',missing:'не нашёл'};
  $('#analytics').innerHTML=`Всего обращений: <b>${data.total}</b> · без подходящего источника: <b>${data.noSource}</b> · модель недоступна: <b>${data.modelUnavailable}</b><p>${Object.entries(data.feedback||{}).map(([k,v])=>`${labels[k]||k}: ${v}`).join(' · ')||'Оценок пока нет'}</p><p><b>Использование документов:</b><br>${registry.map(d=>`${esc(d.title)} — ${data.byDocument?.[d.id]||0}`).join('<br>')}</p>`;
}

function mountQualityForm(question, unit) {
  const box=$('#quality-form'); if(!box)return;
  box.innerHTML=`<div class="card"><label for="reply-email">Куда прислать ответ службы качества?</label><input id="reply-email" type="email" autocomplete="email" placeholder="name@company.ru"><label class="consent"><input id="reply-consent" type="checkbox"> Согласна передать мой вопрос и этот адрес службе качества. Адрес не попадёт в аналитику.</label><button id="send-quality">Отправить обращение</button><div id="send-result" class="hint"></div></div>`;
  $('#send-quality').onclick=async()=>{
    const email=$('#reply-email').value.trim(),consent=$('#reply-consent').checked;
    const output=$('#send-result');
    try {
      const response=await fetch('/api/quality/requests',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question,unit,email,consent})});
      const data=await response.json();if(!response.ok)throw new Error(data.error);
      output.innerHTML=`${esc(data.message)} Номер обращения: <code>${esc(data.id)}</code>${data.mailto?`<br><a href="${esc(data.mailto)}">Открыть письмо в почте</a>`:''}<br><button class="secondary" id="check-quality-answer">Проверить ответ специалиста</button><div id="quality-answer-status" class="hint"></div>`;
      $('#check-quality-answer').onclick=async()=>{const state=await fetch(`/api/quality/requests/${data.id}`).then(r=>r.json());$('#quality-answer-status').textContent=state.status==='answered'?`Ответ службы качества: ${state.answer}`:'Обращение ожидает ответа специалиста.'};
    } catch(error){output.textContent=error.message;}
  };
}

function renderCitations(citations=[]) {
  if (!citations.length) return '';
  return `<h3>На чём основан ответ</h3>${citations.map(c=>`<div class="source"><span class="tag">[${c.ref}]</span> <a href="${esc(c.url)}" target="_blank" rel="noreferrer">${esc(c.title)} ↗</a><p>${esc(c.unit)} · раздел ${esc(c.section||'не указан')}</p></div>`).join('')}`;
}

async function ask(question, unit='', compareAll=false, history=[]) {
  result.classList.remove('hidden'); result.innerHTML='<article class="card">Сверяю вопрос с реестром и документами…</article>';
  try {
    const response=await fetch('/api/ask',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question,unit,compareAll,history})});
    const data=await response.json(); if(!response.ok) throw new Error(data.error);
    if(data.status==='clarify_unit') {
      result.innerHTML=`<article class="card"><div class="status">Уточню, чтобы не смешать разные правила</div><p class="answer">${esc(data.answer)}</p><div class="unit-options">${data.options.map(u=>`<button class="secondary" data-unit="${esc(u)}">${esc(u)}</button>`).join('')}<button class="secondary" data-compare="yes">Не знаю — сравнить варианты</button></div></article>`;
      result.querySelectorAll('[data-unit]').forEach(button=>button.onclick=()=>ask(question,button.dataset.unit,compareAll,history));
      result.querySelector('[data-compare]')?.addEventListener('click',()=>ask(question,'',true,history));
      return;
    }
    const status=data.status==='escalation'?'Надёжного ответа в материалах не нашла':data.status==='sources_only'?'Не удалось проверить ответ по найденным источникам':data.status==='experience_only'?'Ответ службы качества · проверенный опыт':'Ответ по материалам компании';
    const qualityQuestion=[question,...history].join('\nУточнение: ');
    result.innerHTML=`<article class="card"><div class="status ${['answered','experience_only'].includes(data.status)?'':'warning'}">${status}</div><p class="answer">${esc(data.answer)}</p>${data.modelNotice?`<p class="hint warning">${esc(data.modelNotice)}</p>`:''}${data.status==='clarify'?`<div class="clarify-form"><input id="clarify-reply" placeholder="Ваш ответ"><button id="continue-dialog">Продолжить</button><p class="hint">Можно уточнить до двух раз. Не вводите личные данные.</p></div>`:''}${data.experiences?.length?`<details class="experience"><summary>Дополнительное разъяснение службы качества</summary><p class="hint">Отдельно от ответа по регламенту; это разъяснение не является пунктом документа.</p>${data.experiences.map(x=>`<p>${esc(x.text)} <span class="hint">${esc([x.unit,x.approvedAt?new Date(x.approvedAt).toLocaleDateString('ru-RU'):'',x.source||''].filter(Boolean).join(' · '))}</span></p>`).join('')}</details>`:''}${renderCitations(data.citations)}${['escalation','sources_only'].includes(data.status)?`<div class="quality-action"><button id="quality-request">Да, отправить вопрос в службу качества</button><button class="secondary" id="quality-cancel">Нет</button><div id="quality-form"></div></div>`:''}<div class="feedback"><b>Ответ помог?</b><br><button class="secondary" data-rating="helpful">Да</button><button class="secondary" data-rating="not_helpful">Не совсем</button><button class="secondary" data-rating="missing">Не нашёл ответ</button><div id="feedback-msg" class="hint"></div></div></article>`;
    $('#continue-dialog')?.addEventListener('click',()=>{const text=$('#clarify-reply').value.trim();if(text)ask(question,unit,compareAll,[...history,text]);});
    $('#quality-request')?.addEventListener('click',()=>mountQualityForm(qualityQuestion,unit));
    $('#quality-cancel')?.addEventListener('click',()=>{$('#quality-form').textContent='Хорошо. Если появится точный регламент, можно задать вопрос ещё раз.';});
    result.querySelectorAll('[data-rating]').forEach(button=>button.onclick=async()=>{const saved=await fetch('/api/feedback',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({rating:button.dataset.rating})}).then(r=>r.json());$('#feedback-msg').textContent=saved.message;if(button.dataset.rating!=='helpful')$('#feedback-msg').innerHTML+=` <button class="secondary" id="feedback-quality">Отправить вопрос в качество</button>`;$('#feedback-quality')?.addEventListener('click',()=>mountQualityForm(qualityQuestion,unit));refreshAnalytics();});
    refreshAnalytics();
  } catch(error) { result.innerHTML=`<article class="card error">${esc(error.message)}</article>`; }
}

$('#ask').onclick=async()=>{const question=$('#question').value.trim();if(!question)return $('#question').focus();const button=$('#ask');button.disabled=true;button.textContent='Ищу…';try{await ask(question,$('#unit').value);}finally{button.disabled=false;button.innerHTML='Найти ответ <span>→</span>';}};
init();
