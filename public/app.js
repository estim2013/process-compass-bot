const $ = selector => document.querySelector(selector);
const result = $('#result');
function esc(value = '') { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

async function init() {
  const units = await fetch('/api/units').then(r=>r.json());
  units.forEach(unit => $('#unit').insertAdjacentHTML('beforeend', `<option>${esc(unit)}</option>`));
}

function mountQualityForm(question, unit) {
  document.querySelector('#quality-dialog')?.remove();
  const dialog=document.createElement('dialog');
  dialog.id='quality-dialog';
  dialog.className='quality-dialog';
  dialog.innerHTML=`<form id="quality-form" class="quality-dialog-card"><button type="button" class="dialog-close secondary" aria-label="Закрыть">×</button><p class="eyebrow">ОБРАЩЕНИЕ В СЛУЖБУ КАЧЕСТВА</p><h2>Куда прислать разъяснение?</h2><p class="hint">Отправим специалистам ваш вопрос как вы его написали. Ответ придёт на указанный адрес.</p><label for="reply-email">Ваш email</label><input id="reply-email" name="email" type="email" autocomplete="email" required maxlength="254" placeholder="name@company.ru"><label for="quality-question-preview">В службу качества уйдёт вопрос</label><textarea id="quality-question-preview" rows="4" readonly></textarea><label class="consent"><input id="reply-consent" type="checkbox" required> Согласен(на) передать вопрос и этот email в службу качества для подготовки ответа.</label><div id="send-result" class="hint" role="status" aria-live="polite"></div><div class="dialog-actions"><button type="button" class="secondary" id="cancel-quality">Отмена</button><button id="send-quality">Отправить вопрос</button></div></form>`;
  document.body.append(dialog);
  $('#quality-question-preview').value=question;
  const close=()=>dialog.close();
  dialog.querySelector('.dialog-close').onclick=close;
  dialog.querySelector('#cancel-quality').onclick=close;
  dialog.addEventListener('click',event=>{if(event.target===dialog)close();});
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  $('#quality-form').addEventListener('submit',async event=>{
    event.preventDefault();
    const email=$('#reply-email').value.trim(),consent=$('#reply-consent').checked,button=$('#send-quality'),output=$('#send-result');
    button.disabled=true; output.textContent='Отправляю обращение…';
    try {
      const response=await fetch('/api/quality/requests',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question,unit,email,consent})});
      const data=await response.json();if(!response.ok)throw new Error(data.error);
      output.textContent=`${data.message} Номер обращения: ${data.id}`;
      button.hidden=true;$('#cancel-quality').textContent='Закрыть';
      if(data.mailto){const link=document.createElement('a');link.href=data.mailto;link.textContent='Открыть письмо в почте';link.className='quality-mailto';output.append(document.createElement('br'),link);}
    } catch(error){output.textContent=error.message;button.disabled=false;}
  });
  dialog.showModal();
  $('#reply-email').focus();
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
    const status=data.status==='out_of_scope'?'Это вне моей базы':data.status==='escalation'?'Надёжного ответа в материалах не нашла':data.status==='sources_only'?'Не удалось проверить ответ по найденным источникам':data.status==='experience_only'?'Ответ службы качества · проверенный опыт':data.status==='partial_answer'?'Часть ответа подтверждена':'Ответ по материалам компании';
    result.innerHTML=`<article class="card"><div class="status ${['answered','experience_only'].includes(data.status)?'':'warning'}">${status}</div><p class="answer">${esc(data.answer)}</p>${data.modelNotice?`<p class="hint warning">${esc(data.modelNotice)}</p>`:''}${data.status==='clarify'?`<div class="clarify-form"><input id="clarify-reply" placeholder="Ваш ответ"><button id="continue-dialog">Продолжить</button><p class="hint">Можно уточнить до двух раз. Не вводите личные данные.</p></div>`:''}${data.experiences?.length?`<details class="experience"><summary>Дополнительное разъяснение службы качества</summary><p class="hint">Отдельно от ответа по регламенту; это разъяснение не является пунктом документа.</p>${data.experiences.map(x=>`<p>${esc(x.text)} <span class="hint">${esc([x.unit,x.approvedAt?new Date(x.approvedAt).toLocaleDateString('ru-RU'):'',x.source||''].filter(Boolean).join(' · '))}</span></p>`).join('')}</details>`:''}${renderCitations(data.citations)}${['escalation','sources_only','partial_answer'].includes(data.status)?`<div class="quality-action"><button id="quality-request">Да, отправить вопрос в службу качества</button><button class="secondary" id="quality-cancel">Нет</button></div>`:''}<div class="feedback"><b>Ответ помог?</b><br><button class="secondary" data-rating="helpful">Да</button><button class="secondary" data-rating="not_helpful">Не совсем</button><button class="secondary" data-rating="missing">Не нашёл ответ</button><div id="feedback-msg" class="hint"></div></div></article>`;
    $('#continue-dialog')?.addEventListener('click',()=>{const text=$('#clarify-reply').value.trim();if(text)ask(question,unit,compareAll,[...history,text]);});
    $('#quality-request')?.addEventListener('click',()=>mountQualityForm(question,unit));
    $('#quality-cancel')?.addEventListener('click',()=>{$('#quality-cancel').textContent='Понятно';$('#quality-request').disabled=true;});
    result.querySelectorAll('[data-rating]').forEach(button=>button.onclick=async()=>{const saved=await fetch('/api/feedback',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({rating:button.dataset.rating})}).then(r=>r.json());$('#feedback-msg').textContent=saved.message;if(button.dataset.rating!=='helpful'&&!$('#quality-request'))$('#feedback-msg').innerHTML+=` <button class="secondary" id="feedback-quality">Отправить вопрос в качество</button>`;$('#feedback-quality')?.addEventListener('click',()=>mountQualityForm(question,unit));});
  } catch(error) { result.innerHTML=`<article class="card error">${esc(error.message)}</article>`; }
}

$('#ask').onclick=async()=>{const question=$('#question').value.trim();if(!question)return $('#question').focus();const button=$('#ask');button.disabled=true;button.textContent='Ищу…';try{await ask(question,$('#unit').value);}finally{button.disabled=false;button.innerHTML='Найти ответ <span>→</span>';}};
init();
