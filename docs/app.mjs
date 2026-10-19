import {STORAGE_KEY, MARKET_KEY, validateHoldings, validateHolding, validateMarket,
  mergeHoldings, analyze, parseCSV, toCSV} from './portfolio.mjs';
import {fetchMarket} from './market.mjs';

const $ = selector => document.querySelector(selector);
const money = n => n == null ? '—' : `${Math.round(n).toLocaleString('ko-KR')}원`;
const percent = n => n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
const tone = n => n > 0 ? 'positive' : n < 0 ? 'negative' : '';
const html = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = value => new Date(value).toLocaleString('ko-KR', {timeZone:'Asia/Seoul'});
let holdings = [], market = null, items = [], busy = false, fatalStorage = false;

function notice(selector, text) { const box = $(selector); box.textContent = text; box.className = text ? 'notice' : ''; }
function message(text) { notice('#message', text); }
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved !== null) holdings = validateHoldings(JSON.parse(saved));
} catch (_) {
  fatalStorage = true;
  notice('#storage-notice', '이 브라우저의 저장 기록을 읽을 수 없습니다. 기존 기록을 보호하기 위해 변경을 중지했습니다. CSV 백업 버튼으로 원본을 보관하세요.');
}
try {
  const saved = localStorage.getItem(MARKET_KEY);
  if (saved) market = validateMarket(JSON.parse(saved));
} catch (_) { /* Invalid public cache must not prevent loading private records. */ }

function persist(next) {
  if (fatalStorage) throw Error('기존 저장 기록을 읽을 수 없어 변경하지 않았습니다. 먼저 원본을 백업해 주세요.');
  const valid = validateHoldings(next);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(valid)); }
  catch (_) { throw Error('저장공간에 기록하지 못했습니다. 저장 권한이나 남은 공간을 확인해 주세요. 변경은 적용하지 않았습니다.'); }
  holdings = valid;
  render();
}

function render() {
  const result = analyze(holdings, market); items = result.items;
  const s = result.summary;
  $('#valuation').textContent = money(s.valuation); $('#invested').textContent = money(s.invested);
  $('#profit').textContent = money(s.profit); $('#profit').className = tone(s.profit);
  $('#return-rate').textContent = `수익률 ${percent(s.return_rate)}`; $('#return-rate').className = tone(s.return_rate);
  $('#count').textContent = items.length;
  $('#updated').textContent = market ? `마지막 시세 조회 ${date(market.collected_at)} (한국시간)` : '아직 시세를 조회하지 않았습니다.';
  const stale = market && Date.now() - Date.parse(market.collected_at) > 3600_000;
  notice('#market-notice', !navigator.onLine ? '오프라인입니다. 마지막 조회 가격으로 계산하며 최신 시세가 아닙니다.' : stale ? '마지막 조회 후 1시간이 지났습니다. 시세 조회 버튼을 눌러 가격을 확인하세요.' : '');
  message(s.complete ? '' : '시세가 없는 종목이 있습니다. 전체 평가금액과 손익은 계산하지 않았습니다.');
  $('#holdings').innerHTML = items.length ? items.map((item, i) => `
    <article class="holding"><div class="holding-top"><div><span class="code">${html(item.code)}</span><h3>${html(item.name)}</h3></div><div class="holding-price"><strong>${money(item.price)}</strong><span class="${tone(item.change_rate)}">${percent(item.change_rate)}${item.change_rate == null ? '' : ' 전일 대비'}</span></div></div>
    ${item.error ? `<p class="notice">${html(item.error)}</p>` : ''}
    <div class="holding-grid"><div><span>투자금액</span><strong>${money(item.invested)}</strong></div><div><span>평가금액</span><strong>${money(item.valuation)}</strong></div><div><span>평가손익</span><strong class="${tone(item.profit)}">${money(item.profit)}</strong></div><div><span>수익률</span><strong class="${tone(item.return_rate)}">${percent(item.return_rate)}</strong></div></div>
    <div class="holding-bottom"><p class="hint">평균 취득가 ${money(item.buy)}<br>${item.quantity != null ? `계산 수량 ${item.quantity.toLocaleString('ko-KR',{maximumFractionDigits:4})}주` : '시세 확인 필요'}</p><div class="actions"><button class="text-button" data-edit="${i}">수정</button><button class="text-button" data-delete="${i}">삭제</button></div></div></article>`).join('') : '<div class="empty"><h3>첫 ETF를 기록해 보세요.</h3><p>종목을 추가하거나 PC에서 사용하던 CSV를 가져오세요.</p></div>';
}

async function refresh() {
  if (busy) return;
  busy = true; $('#refresh').disabled = true; $('#refresh').textContent = '조회 중…';
  try {
    market = await fetchMarket();
    try { localStorage.setItem(MARKET_KEY, JSON.stringify(market)); } catch (_) { /* Online prices still work without cache. */ }
    render();
    notice('#market-notice', '시세를 가져왔습니다. 표시 가격은 제공처 기준이며 실시간 체결가와 차이가 날 수 있습니다.');
  } catch (error) {
    render();
    notice('#market-notice', `${error.message} ${market ? '마지막 조회 가격을 유지합니다. 위의 조회 시각을 확인해 주세요.' : '인터넷 연결을 확인한 뒤 다시 시도해 주세요.'}`);
  } finally { busy = false; $('#refresh').disabled = false; $('#refresh').textContent = '↻ 시세 조회'; }
}

function openEditor(item) {
  $('#holding-form').reset(); $('#form-error').textContent = ''; $('#search-results').replaceChildren();
  $('#code').readOnly = Boolean(item); $('#search').disabled = Boolean(item);
  $('#editor-title').textContent = item ? 'ETF 수정' : 'ETF 추가';
  if (item) for (const key of ['code','name','buy','invested']) $('#holding-form').elements[key].value = item[key];
  $('#search-status').textContent = market ? '종목명이나 코드로 검색하세요.' : '시세 조회 후 검색할 수 있습니다. 아래에 직접 입력할 수도 있어요.';
  $('#editor').showModal();
}
$('#search').addEventListener('input', () => {
  const query = $('#search').value.trim().toLowerCase();
  const results = query ? (market?.items || []).filter(x => x.name.toLowerCase().includes(query) || x.code.includes(query)).slice(0,15) : [];
  $('#search-results').replaceChildren(...results.map(item => {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = `${item.name} · ${item.code}`;
    button.onclick = () => { $('#code').value = item.code; $('#name').value = item.name; $('#search-results').replaceChildren(); }; return button;
  }));
});
$('#holding-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const item = validateHolding(Object.fromEntries(new FormData(event.target)));
    if (!$('#code').readOnly && holdings.some(row => row.code === item.code) && !confirm('이미 등록한 종목입니다. 투자 정보를 덮어쓸까요?')) return;
    persist(mergeHoldings(holdings, [item])); $('#editor').close();
  } catch (error) { $('#form-error').textContent = error.message; }
});
$('#holdings').addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.dataset.edit !== undefined) openEditor(items[button.dataset.edit]);
  if (button.dataset.delete !== undefined) {
    const item = items[button.dataset.delete];
    if (!confirm(`${item.name}을 포트폴리오에서 삭제할까요?`)) return;
    try { persist(holdings.filter(row => row.code !== item.code)); } catch (error) { message(error.message); }
  }
});
function download(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], {type}));
  const link = document.createElement('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
$('#export').onclick = () => {
  if (fatalStorage) {
    try { download(localStorage.getItem(STORAGE_KEY) || '', 'portfolio-recovery.txt', 'text/plain;charset=utf-8'); }
    catch (_) { message('저장공간 접근이 차단되어 백업할 수 없습니다. 브라우저 설정을 확인해 주세요.'); }
  } else download(toCSV(holdings), 'my_portfolio.csv', 'text/csv;charset=utf-8');
};
$('#csv-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 1024 * 1024) throw Error('CSV 파일은 1MB 이하로 선택해 주세요.');
    const rows = parseCSV(await file.text());
    if (!confirm(`${rows.length}개 종목을 가져올까요? 같은 종목코드의 투자 정보는 파일의 값으로 바뀝니다.`)) return;
    persist(mergeHoldings(holdings, rows)); message(`${rows.length}개 종목을 가져왔습니다.`);
  } catch (error) { message(error.message); } finally { event.target.value = ''; }
});
$('#close').onclick = () => $('#editor').close();
$('#add').onclick = () => openEditor();
$('#refresh').onclick = refresh;
window.addEventListener('online', render);
window.addEventListener('offline', render);
window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY) return;
  try { holdings = validateHoldings(JSON.parse(event.newValue || '[]')); render(); }
  catch (_) { fatalStorage = true; notice('#storage-notice', '다른 창의 기록을 읽을 수 없습니다. 새로 열기 전에 원본을 백업해 주세요.'); }
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
render();
if (navigator.onLine) refresh();
