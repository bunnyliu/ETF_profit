export const STORAGE_KEY = 'etf-profit.portfolio.v1';
export const MARKET_KEY = 'etf-profit.market.v1';
const COLUMNS = ['종목코드', '종목명', '취득가', '투자금액'];

export function validateHolding(row) {
  if (!row || typeof row !== 'object') throw Error('종목 정보의 형식이 올바르지 않습니다.');
  const code = String(row.code ?? '').trim().toUpperCase();
  const name = String(row.name ?? '').trim();
  if (!/^[0-9A-Z]{6}$/.test(code)) throw Error('종목코드는 영문·숫자 6자리로 입력해 주세요.');
  if (!name || name.length > 100) throw Error('종목명은 1~100자로 입력해 주세요.');
  const buy = Number(row.buy), invested = Number(row.invested);
  if (![buy, invested].every(n => Number.isFinite(n) && n > 0 && n <= 1e15)) {
    throw Error('취득가와 투자금액은 0보다 큰 유효한 금액이어야 합니다.');
  }
  return {code, name, buy, invested};
}

export function validateHoldings(rows) {
  if (!Array.isArray(rows) || rows.length > 1000) throw Error('최대 1,000개 종목까지 저장할 수 있습니다.');
  const seen = new Set();
  return rows.map(row => {
    const item = validateHolding(row);
    if (seen.has(item.code)) throw Error('중복된 종목코드가 있습니다.');
    seen.add(item.code);
    return item;
  });
}

export function mergeHoldings(existing, incoming) {
  return validateHoldings([...new Map([...existing, ...incoming].map(row => [row.code, row])).values()]);
}

export function validateMarket(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.items) || !data.items.length ||
      !Number.isFinite(Date.parse(data.collected_at))) throw Error('시세 파일 형식이 올바르지 않습니다.');
  const seen = new Set();
  for (const item of data.items) {
    if (!/^[0-9A-Z]{6}$/.test(item.code) || typeof item.name !== 'string' || !item.name.trim() || seen.has(item.code)) {
      throw Error('시세 파일의 종목 정보가 올바르지 않습니다.');
    }
    seen.add(item.code);
    if (item.price !== null && !(typeof item.price === 'number' && Number.isFinite(item.price) && item.price > 0)) {
      throw Error('시세 파일에 잘못된 가격이 있습니다.');
    }
    for (const key of ['change', 'change_rate']) {
      if (item[key] !== null && !(typeof item[key] === 'number' && Number.isFinite(item[key]))) {
        throw Error('시세 파일에 잘못된 등락 정보가 있습니다.');
      }
    }
  }
  return data;
}

export function analyze(holdings, market) {
  const prices = new Map((market?.items || []).map(row => [row.code, row]));
  const items = holdings.map(row => {
    const quote = prices.get(row.code);
    if (!quote || !Number.isFinite(quote.price) || quote.price <= 0) {
      return {...row, error: '시세 파일에서 가격을 확인하지 못했습니다.'};
    }
    const quantity = row.invested / row.buy;
    const valuation = quantity * quote.price;
    if (![quantity, valuation].every(Number.isFinite)) return {...row, error: '금액이 계산 범위를 초과했습니다.'};
    const profit = valuation - row.invested;
    return {...row, price: quote.price, change: quote.change, change_rate: quote.change_rate,
      quantity, valuation, profit, return_rate: profit / row.invested * 100};
  }).sort((a, b) => b.invested - a.invested);
  const invested = items.reduce((sum, row) => sum + row.invested, 0);
  const complete = items.every(row => !row.error);
  const valuation = complete ? items.reduce((sum, row) => sum + row.valuation, 0) : null;
  const profit = complete ? valuation - invested : null;
  return {items, summary: {invested, valuation, profit, complete,
    return_rate: complete ? (invested ? profit / invested * 100 : 0) : null}};
}

export function parseCSV(text) {
  if (text.length > 1024 * 1024) throw Error('CSV 파일은 1MB 이하로 선택해 주세요.');
  text = text.replace(/^\uFEFF/, '');
  const rows = []; let row = [], value = '', quoted = false, closed = false;
  function cell() { row.push(value); value = ''; closed = false; }
  function line() { cell(); if (row.some(cell => cell.trim())) rows.push(row); row = []; }
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { value += '"'; i++; }
        else { quoted = false; closed = true; }
      } else value += char;
    } else if (char === ',') cell();
    else if (char === '\n' || char === '\r') { if (char === '\r' && text[i + 1] === '\n') i++; line(); }
    else if (char === '"' && value === '' && !closed) quoted = true;
    else if (closed || char === '"') throw Error('CSV의 따옴표 형식이 올바르지 않습니다.');
    else value += char;
  }
  if (quoted) throw Error('CSV의 따옴표가 닫히지 않았습니다.');
  if (row.length || value || closed) line();
  const header = (rows.shift() || []).map(value => value.trim());
  const indexes = COLUMNS.map(column => header.indexOf(column));
  if (indexes.includes(-1) || new Set(header).size !== header.length) throw Error(`필수 열: ${COLUMNS.join(', ')}`);
  if (!rows.length) throw Error('CSV에 종목이 없습니다.');
  return validateHoldings(rows.map((row, i) => {
    if (row.length !== header.length) throw Error(`${i + 2}행의 열 개수가 올바르지 않습니다.`);
    return {code: row[indexes[0]], name: row[indexes[1]], buy: row[indexes[2]], invested: row[indexes[3]]};
  }));
}

export function toCSV(holdings) {
  const quote = value => `"${String(value).replace(/"/g, '""')}"`;
  return '\uFEFF' + [COLUMNS, ...holdings.map(item => [item.code, item.name, item.buy, item.invested])]
    .map(row => row.map(quote).join(',')).join('\r\n') + '\r\n';
}
