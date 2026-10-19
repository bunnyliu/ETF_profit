"""Read-only HTTPS access to Naver's public ETF and daily-price data."""
import ast
import math
import time
from datetime import datetime, timedelta
from threading import Lock
from zoneinfo import ZoneInfo

import requests

SEOUL = ZoneInfo('Asia/Seoul')
_cache = {}
_lock = Lock()


class MarketUnavailable(Exception):
    pass


def _get(url, params=None):
    try:
        response = requests.get(url, params=params, timeout=(5, 12),
                                headers={'User-Agent': 'ETFPortfolio/1.0'})
        response.raise_for_status()
        return response
    except requests.RequestException as exc:
        raise MarketUnavailable('시세 제공처에 연결할 수 없습니다. 잠시 후 다시 조회해 주세요.') from exc


def _cached(key, seconds, loader):
    with _lock:
        cached = _cache.get(key)
        if cached and time.monotonic() - cached[0] < seconds:
            return cached[1]
    result = loader()
    with _lock:
        _cache[key] = (time.monotonic(), result)
    return result


def etfs():
    def load():
        try:
            data = _get('https://finance.naver.com/api/sise/etfItemList.nhn').json()
            return sorted([{'code': item['itemcode'], 'name': item['itemname']}
                           for item in data['result']['etfItemList']], key=lambda x: x['name'])
        except (ValueError, KeyError, TypeError) as exc:
            raise MarketUnavailable('ETF 목록을 읽을 수 없습니다. 종목코드로 직접 추가할 수 있습니다.') from exc
    return _cached('etfs', 86400, load)


def quote(code):
    def load():
        now = datetime.now(SEOUL)
        response = _get('https://api.finance.naver.com/siseJson.naver', {
            'symbol': code, 'requestType': '1', 'timeframe': 'day',
            'startTime': (now - timedelta(days=45)).strftime('%Y%m%d'),
            'endTime': now.strftime('%Y%m%d'),
        })
        try:
            rows = ast.literal_eval(response.text.strip())
            prices = sorted([row for row in rows[1:] if len(row) >= 5], key=lambda r: str(r[0]))
            current, previous = float(prices[-1][4]), float(prices[-2][4])
            if not all(math.isfinite(p) and p > 0 for p in (current, previous)):
                raise ValueError('Invalid price')
            date = datetime.strptime(str(prices[-1][0]), '%Y%m%d').strftime('%Y-%m-%d')
            return {'price': current, 'change': current - previous,
                    'change_rate': (current / previous - 1) * 100, 'date': date,
                    'fetched_at': now.isoformat(timespec='seconds')}
        except (ValueError, TypeError, IndexError, SyntaxError) as exc:
            raise MarketUnavailable('이 종목의 최근 일별 시세를 확인할 수 없습니다.') from exc
    return _cached(code, 60, load)
