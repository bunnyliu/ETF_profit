import {validateMarket} from './portfolio.mjs';

function numeric(value) {
  if (value == null || typeof value === 'boolean' || value === '') return null;
  const number = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(number) ? number : null;
}

export function normalizeMarket(data, collectedAt = new Date().toISOString()) {
  if (data?.resultCode !== 'success' || !Array.isArray(data?.result?.etfItemList)) {
    throw Error('시세 제공처의 응답을 읽을 수 없습니다.');
  }
  const items = data.result.etfItemList.map(item => {
    let price = numeric(item.nowVal), change = numeric(item.changeVal), rate = numeric(item.changeRate);
    if (price != null && price <= 0) price = null;
    const direction = String(item.risefall);
    if (['4','5'].includes(direction)) {
      change = change == null ? null : -Math.abs(change); rate = rate == null ? null : -Math.abs(rate);
    } else if (['1','2'].includes(direction)) {
      change = change == null ? null : Math.abs(change); rate = rate == null ? null : Math.abs(rate);
    } else if (direction === '3') { change = 0; rate = 0; }
    return {code: String(item.itemcode), name: item.itemname, price, change, change_rate: rate};
  });
  return validateMarket({version: 1, collected_at: collectedAt, source: '네이버 금융', items});
}

export function fetchMarket(timeoutMs = 15000) {
  // Execute the provider's JSONP in an opaque-origin sandbox. It cannot access
  // the parent document or the browser storage containing private holdings.
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.title = '공개 ETF 시세 조회';
    const token = crypto.randomUUID();
    const source = new URL('https://finance.naver.com/api/sise/etfItemList.nhn');
    source.searchParams.set('_callback', '__etfResult');
    source.searchParams.set('_', Date.now());
    function cleanup() { clearTimeout(timer); window.removeEventListener('message', onMessage); frame.remove(); }
    function onMessage(event) {
      if (event.source !== frame.contentWindow || event.data?.token !== token) return;
      cleanup();
      if (event.data.error) return reject(Error('시세 제공처에 연결할 수 없습니다. 다시 조회해 주세요.'));
      try { resolve(normalizeMarket(event.data.payload)); } catch (error) { reject(error); }
    }
    const timer = setTimeout(() => { cleanup(); reject(Error('시세 조회 시간이 초과되었습니다. 다시 조회해 주세요.')); }, timeoutMs);
    window.addEventListener('message', onMessage);
    frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>
      const send = result => parent.postMessage({token: ${JSON.stringify(token)}, ...result}, ${JSON.stringify(location.origin)});
      window.__etfResult = payload => send({payload});
      const script = document.createElement('script');
      script.charset = 'euc-kr'; script.referrerPolicy = 'no-referrer';
      script.src = ${JSON.stringify(source.href)};
      script.onerror = () => send({error:true});
      document.head.append(script);
    <\/script></body></html>`;
    document.body.append(frame);
  });
}
