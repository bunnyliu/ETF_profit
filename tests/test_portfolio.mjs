import test from 'node:test';
import assert from 'node:assert/strict';
import {analyze, mergeHoldings, parseCSV, toCSV, validateHolding, validateHoldings, validateMarket} from '../docs/portfolio.mjs';
import {normalizeMarket} from '../docs/market.mjs';

const holding = {code:'069500', name:'KODEX 200', buy:100, invested:1000};
const raw = {resultCode:'success', result:{etfItemList:[
  {itemcode:'069500', itemname:'KODEX 200', nowVal:120, changeVal:10, changeRate:9.09, risefall:'2'},
]}};

test('profit, quantity and totals preserve original calculations', () => {
  const data = analyze([holding], normalizeMarket(raw));
  assert.equal(data.items[0].quantity, 10);
  assert.deepEqual(data.summary, {invested:1000, valuation:1200, profit:200, complete:true, return_rate:20});
});

test('unavailable prices leave totals unknown, not a fabricated loss', () => {
  for (const market of [null, {items:[{code:'069500',price:null}]}]) {
    const data = analyze([holding], market);
    assert.equal(data.summary.invested, 1000);
    assert.equal(data.summary.valuation, null);
    assert.equal(data.summary.profit, null);
    assert.equal(data.summary.return_rate, null);
    assert.equal(data.summary.complete, false);
  }
});

test('mixed available and missing quotes do not produce partial totals', () => {
  const data = analyze([holding, {...holding,code:'229200'}], normalizeMarket(raw));
  assert.equal(data.items[0].profit, 200);
  assert.equal(data.summary.invested, 2000);
  assert.equal(data.summary.valuation, null);
});

test('falling and flat prices use provider direction flags', () => {
  const data = structuredClone(raw);
  Object.assign(data.result.etfItemList[0], {nowVal:80,changeVal:20,changeRate:20,risefall:'5'});
  const quote = normalizeMarket(data).items[0];
  assert.equal(quote.change, -20);
  assert.equal(quote.change_rate, -20);
  assert.equal(analyze([holding], normalizeMarket(data)).summary.profit, -200);
  data.result.etfItemList[0].risefall = '3';
  assert.equal(normalizeMarket(data).items[0].change, 0);
});

test('CSV preserves leading zero, Korean, embedded commas, quotes and newlines', () => {
  const records = [holding, {...holding,code:'229200',name:'한글, "ETF"\n테스트'}];
  assert.deepEqual(parseCSV(toCSV(records)), records);
  assert.deepEqual(parseCSV('종목코드,종목명,취득가,투자금액\r\n069500,KODEX 200,100,1000\r\n'),[holding]);
});

test('invalid CSV is rejected before merge', () => {
  const cases = [
    '종목코드,종목명,취득가,투자금액\n069500,test,0,1000',
    '종목코드,종목명,취득가,투자금액\n069500,test,100,NaN',
    '종목코드,종목명,취득가,투자금액\n069500,test,100,1000\n069500,other,100,1000',
    '종목코드,종목명,취득가,투자금액\n069500,"unclosed,100,1000',
    '종목코드,종목명,취득가,투자금액\n069500,"test"oops,100,1000',
    '종목코드,종목명,취득가,투자금액\n069500,test,100',
    'wrong,columns\nfoo,bar',
    '종목코드,종목명,취득가,투자금액',
  ];
  for (const csv of cases) assert.throws(() => parseCSV(csv));
});

test('imports update only matching codes and retain all other records', () => {
  const other = {...holding,code:'229200',name:'other'};
  const next = {...holding, invested:2000};
  assert.deepEqual(mergeHoldings([holding, other], [next]), [next, other]);
  assert.equal(holding.invested, 1000);
});

test('invalid amount, malformed code and duplicate records are rejected', () => {
  for (const buy of [0,-1,NaN,Infinity,'oops',null]) assert.throws(() => validateHolding({...holding,buy}));
  assert.throws(() => validateHolding({...holding,code:'invalid'}));
  assert.throws(() => validateHoldings([holding,holding]));
});

test('invalid provider results are rejected rather than used or cached', () => {
  assert.throws(() => normalizeMarket({resultCode:'error'}));
  assert.throws(() => normalizeMarket({resultCode:'success',result:{etfItemList:[]}}));
  assert.throws(() => validateMarket({...normalizeMarket(raw),collected_at:'wrong'}));
  const duplicate=structuredClone(raw);duplicate.result.etfItemList.push(duplicate.result.etfItemList[0]);
  assert.throws(() => normalizeMarket(duplicate));
});

test('cached market snapshot preserves original timestamp', () => {
  const collectedAt='2026-10-19T09:00:00+09:00';
  assert.equal(normalizeMarket(raw,collectedAt).collected_at,collectedAt);
});
