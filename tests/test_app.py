import io

import pytest

import market
from app import analyze, create_app


@pytest.fixture
def app(tmp_path, monkeypatch):
    monkeypatch.setattr(market, 'etfs', lambda: [{'code': '069500', 'name': 'KODEX 200'}])
    monkeypatch.setattr(market, 'quote', lambda code: {
        'price': 120, 'change': 10, 'change_rate': 10 / 110 * 100,
        'date': '2026-10-16', 'fetched_at': '2026-10-19T14:00:00+09:00',
    })
    return create_app({'TESTING': True, 'APP_PASSWORD': 'test-only-password',
                       'SECRET_KEY': 'test-only-key', 'DATABASE': str(tmp_path / 'portfolio.sqlite3')})


@pytest.fixture
def client(app):
    client = app.test_client()
    client.get('/')
    with client.session_transaction() as state:
        csrf = state['csrf']
    assert client.post('/login', data={'password': 'test-only-password', 'csrf': csrf}).status_code == 302
    return client


def headers(client):
    with client.session_transaction() as state:
        return {'X-CSRF-Token': state['csrf']}


def add(client, code='069500'):
    return client.post('/api/holdings', headers=headers(client), json={
        'code': code, 'name': 'KODEX 200', 'buy': 100, 'invested': 1000})


def test_password_and_csrf_protection(app):
    client = app.test_client()
    assert client.get('/api/portfolio').status_code == 401
    assert client.get('/api/export').status_code == 401
    assert client.post('/api/holdings', json={}).status_code == 403
    client.get('/')
    token = headers(client)['X-CSRF-Token']
    assert client.post('/login', data={'password': 'wrong', 'csrf': token}).status_code == 401
    assert '나의 접속 암호' in client.get('/').text


def test_login_throttle(app):
    client = app.test_client()
    client.get('/')
    token = headers(client)['X-CSRF-Token']
    for _ in range(5):
        assert client.post('/login', data={'password': 'wrong', 'csrf': token}).status_code == 401
    assert client.post('/login', data={'password': 'wrong', 'csrf': token}).status_code == 429


def test_no_password_fails_closed(app):
    app.config['APP_PASSWORD'] = ''
    client = app.test_client()
    assert client.get('/').status_code == 503
    assert client.get('/api/portfolio').status_code == 401


def test_generated_session_key_survives_restart(tmp_path):
    config = {'TESTING': True, 'DATABASE': str(tmp_path / 'portfolio.sqlite3'),
              'APP_PASSWORD': 'test-only-password'}
    first = create_app(config)
    second = create_app(config)
    assert first.secret_key == second.secret_key
    assert len(first.secret_key) == 64
    assert (tmp_path / 'session.key').stat().st_mode & 0o777 == 0o600
    assert first.test_client().get('/').status_code == 200


def test_crud_calculation_and_persistence(client, app):
    assert add(client).status_code == 200
    result = client.get('/api/portfolio').json
    assert result['summary'] == {'invested': 1000, 'valuation': 1200, 'profit': 200,
                                 'return_rate': 20, 'complete': True}
    assert result['items'][0]['quantity'] == 10
    assert client.get('/api/portfolio').headers['Cache-Control'] == 'no-store'
    restarted = create_app(dict(app.config)).test_client()
    with client.session_transaction() as old, restarted.session_transaction() as new:
        new.update(old)
    assert restarted.get('/api/portfolio').json['items'][0]['code'] == '069500'
    assert client.delete('/api/holdings/069500', headers=headers(client)).status_code == 200
    assert client.get('/api/portfolio').json['items'] == []


def test_missing_quote_does_not_report_false_loss(client, monkeypatch):
    add(client)
    def unavailable(_):
        raise market.MarketUnavailable('조회 실패')
    monkeypatch.setattr(market, 'quote', unavailable)
    result = client.get('/api/portfolio').json
    assert result['summary']['invested'] == 1000
    assert result['summary']['valuation'] is None
    assert result['summary']['profit'] is None
    assert result['summary']['return_rate'] is None
    assert result['items'][0]['error'] == '조회 실패'


@pytest.mark.parametrize('value', [0, -1, 'NaN', 'Infinity', 'oops', None])
def test_invalid_amount(client, value):
    result = client.post('/api/holdings', headers=headers(client), json={
        'code': '069500', 'name': 'test', 'buy': value, 'invested': 1000})
    assert result.status_code == 400
    assert client.get('/api/portfolio').json['items'] == []


def upload(client, text):
    return client.post('/api/import', headers=headers(client), data={
        'file': (io.BytesIO(text.encode('utf-8-sig')), 'my_portfolio.csv')})


def test_csv_roundtrip_merge_and_atomic_validation(client):
    add(client)
    csv = client.get('/api/export').data.decode('utf-8-sig')
    assert '069500,KODEX 200,100.0,1000.0' in csv
    invalid = csv + '229200,test,0,1000\n'
    assert upload(client, invalid).status_code == 400
    assert len(client.get('/api/portfolio').json['items']) == 1
    assert upload(client, csv + '229200,test,10,200\n').json['count'] == 2
    assert len(client.get('/api/portfolio').json['items']) == 2
    assert upload(client, csv).status_code == 200
    assert len(client.get('/api/portfolio').json['items']) == 2
    assert upload(client, csv + '069500,duplicate,10,200\n').status_code == 400


def test_mixed_prices_and_losses(monkeypatch):
    def quote(code):
        if code == '229200':
            raise market.MarketUnavailable('failed')
        return {'price': 80, 'change': -5, 'change_rate': -5, 'date': '2026-10-16'}
    monkeypatch.setattr(market, 'quote', quote)
    rows = [{'code': '069500', 'name': 'one', 'buy': 100, 'invested': 1000}]
    assert analyze(rows)['summary']['profit'] == -200
    rows.append({'code': '229200', 'name': 'two', 'buy': 50, 'invested': 500})
    assert analyze(rows)['summary']['profit'] is None


def test_pwa_assets(client):
    manifest = client.get('/static/manifest.webmanifest').json
    assert manifest['display'] == 'standalone'
    for icon in manifest['icons']:
        assert client.get(icon['src']).status_code == 200
    assert client.get('/sw.js').mimetype == 'text/javascript'
    assert client.get('/static/offline.html').status_code == 200


def test_logout_and_password_rotation(client, app):
    app.config['APP_PASSWORD'] = 'rotated'
    assert client.get('/api/portfolio').status_code == 401
    assert client.post('/logout', headers=headers(client)).status_code == 302


def test_market_parser_and_cache(monkeypatch):
    market._cache.clear()
    calls = []
    class Response:
        text = "[['날짜','시가','고가','저가','종가','거래량'], ['20261015',100,120,90,110,50], ['20261016',110,130,100,120,80],]"
    def get(*args):
        calls.append(args)
        return Response()
    monkeypatch.setattr(market, '_get', get)
    result = market.quote('069500')
    assert result['price'] == 120
    assert result['change'] == 10
    assert result['date'] == '2026-10-16'
    assert market.quote('069500') == result
    assert len(calls) == 1
