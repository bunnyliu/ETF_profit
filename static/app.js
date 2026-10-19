'use strict';
const $ = selector => document.querySelector(selector);
const csrf = $('meta[name="csrf-token"]').content;
const money = n => n == null ? '—' : `${Math.round(n).toLocaleString('ko-KR')}원`;
const percent = n => n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
const tone = n => n > 0 ? 'positive' : n < 0 ? 'negative' : '';
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let items = [], catalog = [], busy = false;
function message(text) { const box = $('#message'); box.textContent = text; box.className = text ? 'notice' : ''; }
async function api(path, options = {}) {
  const response = await fetch(path, {...options, headers: {'X-CSRF-Token': csrf, ...options.headers}, cache:'no-store'});
  if (response.status === 401) { location.reload(); throw Error('다시 로그인해 주세요.'); }
  const data = await response.json().catch(() => ({error:'응답을 읽을 수 없습니다.'}));
  if (!response.ok) throw Error(data.error || '요청을 처리할 수 없습니다.');
  return data;
}
async function refresh() {
  if (busy) return;
  busy = true; $('#refresh').disabled = true; $('#refresh').textContent = '조회 중…';
  try {
    const data = await api('/api/portfolio'); items = data.items;
    const s = data.summary;
    $('#valuation').textContent = money(s.valuation); $('#invested').textContent = money(s.invested);
    $('#profit').textContent = money(s.profit); $('#profit').className = tone(s.profit);
    $('#return-rate').textContent = `수익률 ${percent(s.return_rate)}`; $('#return-rate').className = tone(s.return_rate);
    $('#count').textContent = items.length;
    $('#updated').textContent = `화면 조회 ${new Date().toLocaleString('ko-KR', {timeZone:'Asia/Seoul'})} (한국시간) · 시세 캐시 최대 60초`;
    message(s.complete ? '' : '시세를 확인하지 못한 종목이 있습니다. 전체 평가금액과 손익은 계산하지 않았습니다.');
    $('#holdings').innerHTML = items.length ? items.map((item, i) => `
      <article class="holding"><div class="holding-top"><div><span class="code">${escapeHtml(item.code)}</span><h3>${escapeHtml(item.name)}</h3></div><div class="holding-price"><strong>${money(item.price)}</strong><span class="${tone(item.change_rate)}">${percent(item.change_rate)}${item.change_rate == null ? '' : ' 전일 대비'}</span></div></div>
      ${item.error ? `<p class="notice">${escapeHtml(item.error)}</p>` : ''}
      <div class="holding-grid"><div><span>투자금액</span><strong>${money(item.invested)}</strong></div><div><span>평가금액</span><strong>${money(item.valuation)}</strong></div><div><span>평가손익</span><strong class="${tone(item.profit)}">${money(item.profit)}</strong></div><div><span>수익률</span><strong class="${tone(item.return_rate)}">${percent(item.return_rate)}</strong></div></div>
      <div class="holding-bottom"><p class="hint">평균 취득가 ${money(item.buy)}<br>${item.date ? `시세 기준일 ${escapeHtml(item.date)}` : '시세 확인 필요'}</p><div class="actions"><button class="text-button" data-edit="${i}">수정</button><button class="text-button" data-delete="${i}">삭제</button></div></div></article>`).join('') : '<div class="empty"><h3>첫 ETF를 기록해 보세요.</h3><p>종목을 추가하거나 PC에서 사용하던 CSV를 가져오세요.</p></div>';
  } catch (error) { message(error.message); }
  finally { busy = false; $('#refresh').disabled = false; $('#refresh').textContent = '↻ 시세 새로고침'; }
}
async function openEditor(item) {
  $('#holding-form').reset(); $('#form-error').textContent = ''; $('#search-results').replaceChildren();
  $('#code').readOnly = Boolean(item);
  $('#editor-title').textContent = item ? 'ETF 수정' : 'ETF 추가';
  if(item) for(const key of ['code','name','buy','invested']) $('#holding-form').elements[key].value = item[key];
  $('#editor').showModal();
  if (!catalog.length) {
    try { const data = await api('/api/etfs'); catalog = data.items; $('#search-status').textContent = '종목명을 입력해 검색하세요.'; }
    catch(error) { $('#search-status').textContent = `${error.message} 아래에 종목을 직접 입력할 수 있습니다.`; }
  }
}
$('#search').addEventListener('input', () => {
  const query = $('#search').value.trim().toLowerCase();
  const results = query ? catalog.filter(x => x.name.toLowerCase().includes(query) || x.code.includes(query)).slice(0,15) : [];
  $('#search-results').replaceChildren(...results.map(item => {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = `${item.name} · ${item.code}`;
    button.onclick = () => { if($('#code').readOnly) return; $('#code').value = item.code; $('#name').value = item.name; $('#search-results').replaceChildren(); }; return button;
  }));
});
$('#holding-form').addEventListener('submit', async event => {
  event.preventDefault(); $('#save').disabled = true;
  try { await api('/api/holdings', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(event.target)))}); $('#editor').close(); await refresh(); }
  catch(error) { $('#form-error').textContent = error.message; }
  finally { $('#save').disabled = false; }
});
$('#holdings').addEventListener('click', async event => {
  const button = event.target.closest('button'); if(!button) return;
  if(button.dataset.edit !== undefined) openEditor(items[button.dataset.edit]);
  if(button.dataset.delete !== undefined) {
    const item = items[button.dataset.delete];
    if(!confirm(`${item.name}을 포트폴리오에서 삭제할까요?`)) return;
    button.disabled = true;
    try { await api(`/api/holdings/${encodeURIComponent(item.code)}`, {method:'DELETE'}); await refresh(); }
    catch(error) { message(error.message); button.disabled = false; }
  }
});
$('#csv-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if(!file) return;
  if(!confirm('CSV를 가져올까요? 같은 종목코드의 투자 정보는 파일의 값으로 바뀝니다.')) { event.target.value = ''; return; }
  const body = new FormData(); body.append('file',file);
  try { const result = await api('/api/import',{method:'POST',body}); await refresh(); message(`${result.count}개 종목을 가져왔습니다.`); }
  catch(error) { message(error.message); } finally { event.target.value = ''; }
});
$('#close').onclick = () => $('#editor').close();
$('#add').onclick = () => openEditor();
$('#refresh').onclick = refresh;
window.addEventListener('online', refresh);
window.addEventListener('offline', () => message('인터넷 연결이 없습니다. 화면의 시세는 최신 정보가 아닐 수 있습니다.'));
refresh();
