import csv
import hmac
import io
import math
import os
import re
import secrets
import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor
from functools import wraps
from pathlib import Path
from threading import Lock

from flask import Flask, Response, g, jsonify, redirect, render_template, request, session, url_for

import market

COLUMNS = ['종목코드', '종목명', '취득가', '투자금액']


def validate(row):
    if not isinstance(row, dict):
        raise ValueError('종목 정보의 형식이 올바르지 않습니다.')
    code = str(row.get('code', '')).strip().upper()
    name = str(row.get('name', '')).strip()
    if not re.fullmatch(r'[0-9A-Z]{6}', code):
        raise ValueError('종목코드는 영문·숫자 6자리로 입력해 주세요.')
    if not name or len(name) > 100:
        raise ValueError('종목명은 1~100자로 입력해 주세요.')
    try:
        buy, invested = float(row['buy']), float(row['invested'])
    except (KeyError, TypeError, ValueError):
        raise ValueError('취득가와 투자금액을 숫자로 입력해 주세요.')
    if not all(math.isfinite(n) and 0 < n <= 1e15 for n in (buy, invested)):
        raise ValueError('취득가와 투자금액은 0보다 큰 유효한 금액이어야 합니다.')
    return {'code': code, 'name': name, 'buy': buy, 'invested': invested}


def analyze(rows):
    def price(row):
        item = dict(row)
        try:
            item.update(market.quote(item['code']))
            item['quantity'] = item['invested'] / item['buy']
            item['valuation'] = item['quantity'] * item['price']
            item['profit'] = item['valuation'] - item['invested']
            item['return_rate'] = item['profit'] / item['invested'] * 100
        except market.MarketUnavailable as exc:
            item['error'] = str(exc)
        return item
    with ThreadPoolExecutor(max_workers=4) as pool:
        items = list(pool.map(price, rows))
    invested = sum(item['invested'] for item in items)
    complete = all('error' not in item for item in items)
    valuation = sum(item['valuation'] for item in items) if complete else None
    profit = valuation - invested if complete else None
    return {'items': items, 'summary': {
        'invested': invested, 'valuation': valuation, 'profit': profit,
        'return_rate': profit / invested * 100 if complete and invested else (0 if complete else None),
        'complete': complete,
    }}


def create_app(test_config=None):
    app = Flask(__name__)
    login_failures = {}
    login_lock = Lock()
    data_dir = Path(os.environ.get('ETF_DATA_DIR', Path(__file__).parent / '.data'))
    app.config.update(
        APP_PASSWORD=os.environ.get('APP_PASSWORD', ''),
        DATABASE=str(data_dir / 'portfolio.sqlite3'),
        MAX_CONTENT_LENGTH=1024 * 1024,
        SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE='Lax',
        SESSION_COOKIE_SECURE=os.environ.get('COOKIE_SECURE', 'false').lower() == 'true',
    )
    if test_config:
        app.config.update(test_config)
    Path(app.config['DATABASE']).parent.mkdir(parents=True, exist_ok=True)
    if not app.config.get('SECRET_KEY'):
        key_path = Path(app.config['DATABASE']).parent / 'session.key'
        try:
            with open(key_path, 'x', opener=lambda p, f: os.open(p, f, 0o600)) as handle:
                handle.write(secrets.token_hex(32))
        except FileExistsError:
            pass
        app.config['SECRET_KEY'] = key_path.read_text().strip()
    with sqlite3.connect(app.config['DATABASE']) as db:
        db.execute('CREATE TABLE IF NOT EXISTS holdings '
                   '(code TEXT PRIMARY KEY, name TEXT NOT NULL, buy REAL NOT NULL, invested REAL NOT NULL)')

    def connection():
        if 'db' not in g:
            g.db = sqlite3.connect(app.config['DATABASE'], timeout=10)
            g.db.row_factory = sqlite3.Row
        return g.db

    @app.teardown_appcontext
    def close(_error):
        if 'db' in g:
            g.db.close()

    def authenticated():
        expected = hmac.digest(app.secret_key.encode(), app.config['APP_PASSWORD'].encode(), 'sha256').hex()
        return hmac.compare_digest(session.get('auth', ''), expected)

    def protected(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            if not app.config['APP_PASSWORD'] or not authenticated():
                return jsonify(error='로그인이 필요합니다.'), 401
            return fn(*args, **kwargs)
        return wrapper

    @app.before_request
    def csrf():
        if request.method in ('POST', 'PUT', 'DELETE'):
            supplied = request.headers.get('X-CSRF-Token') or request.form.get('csrf', '')
            if not session.get('csrf') or not hmac.compare_digest(supplied, session['csrf']):
                return jsonify(error='접속이 만료되었습니다. 페이지를 새로 열어 주세요.'), 403

    @app.after_request
    def headers(response):
        if request.endpoint != 'static':
            response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['Referrer-Policy'] = 'same-origin'
        return response

    @app.get('/')
    def index():
        session.setdefault('csrf', secrets.token_urlsafe(32))
        if not app.config['APP_PASSWORD']:
            return render_template('login.html', setup=True), 503
        if not authenticated():
            return render_template('login.html', setup=False)
        return render_template('index.html')

    @app.post('/login')
    def login():
        address, now = request.remote_addr, time.monotonic()
        with login_lock:
            # Bound memory and limit password guessing. One production worker is intentional.
            for key in list(login_failures):
                if now - login_failures[key][1] >= 60:
                    del login_failures[key]
            count, since = login_failures.get(address, (0, now))
        if count >= 5:
            return render_template('login.html', error='로그인 시도가 많습니다. 1분 뒤 다시 시도해 주세요.', setup=False), 429
        password = request.form.get('password', '')
        if not app.config['APP_PASSWORD'] or not hmac.compare_digest(
                password.encode(), app.config['APP_PASSWORD'].encode()):
            with login_lock:
                login_failures[address] = (count + 1, since)
            return render_template('login.html', error='암호가 맞지 않습니다.', setup=False), 401
        with login_lock:
            login_failures.pop(address, None)
        session.clear()
        session['auth'] = hmac.digest(app.secret_key.encode(), password.encode(), 'sha256').hex()
        session['csrf'] = secrets.token_urlsafe(32)
        return redirect(url_for('index'))

    @app.post('/logout')
    def logout():
        session.clear()
        return redirect(url_for('index'))

    @app.get('/api/portfolio')
    @protected
    def portfolio():
        rows = connection().execute('SELECT * FROM holdings ORDER BY invested DESC').fetchall()
        return jsonify(analyze(rows))

    @app.get('/api/etfs')
    @protected
    def etfs():
        try:
            return jsonify(items=market.etfs())
        except market.MarketUnavailable as exc:
            return jsonify(error=str(exc), items=[]), 503

    @app.post('/api/holdings')
    @protected
    def upsert():
        try:
            row = validate(request.get_json(silent=True) or {})
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        with connection() as db:
            db.execute('INSERT INTO holdings VALUES (:code,:name,:buy,:invested) '
                       'ON CONFLICT(code) DO UPDATE SET name=excluded.name,buy=excluded.buy,invested=excluded.invested', row)
        return jsonify(ok=True)

    @app.delete('/api/holdings/<code>')
    @protected
    def delete(code):
        with connection() as db:
            db.execute('DELETE FROM holdings WHERE code=?', (code,))
        return jsonify(ok=True)

    @app.get('/api/export')
    @protected
    def export():
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(COLUMNS)
        for row in connection().execute('SELECT code,name,buy,invested FROM holdings ORDER BY code'):
            writer.writerow(row)
        return Response(output.getvalue().encode('utf-8-sig'), mimetype='text/csv',
                        headers={'Content-Disposition': 'attachment; filename=my_portfolio.csv'})

    @app.post('/api/import')
    @protected
    def import_csv():
        upload = request.files.get('file')
        if not upload:
            return jsonify(error='CSV 파일을 선택해 주세요.'), 400
        try:
            reader = csv.DictReader(io.StringIO(upload.read().decode('utf-8-sig')))
            if reader.fieldnames is None or not set(COLUMNS).issubset(reader.fieldnames):
                raise ValueError('필수 열: ' + ', '.join(COLUMNS))
            rows, seen = [], set()
            for number, row in enumerate(reader, 2):
                if number > 1001:
                    raise ValueError('최대 1,000개 종목까지 가져올 수 있습니다.')
                holding = validate(dict(zip(('code', 'name', 'buy', 'invested'), (row[c] for c in COLUMNS))))
                if holding['code'] in seen:
                    raise ValueError(f'{number}행: 중복 종목코드가 있습니다.')
                seen.add(holding['code'])
                rows.append(holding)
            if not rows:
                raise ValueError('CSV에 종목이 없습니다.')
        except (ValueError, UnicodeError, csv.Error) as exc:
            return jsonify(error=str(exc)), 400
        with connection() as db:
            db.executemany('INSERT INTO holdings VALUES (:code,:name,:buy,:invested) '
                           'ON CONFLICT(code) DO UPDATE SET name=excluded.name,buy=excluded.buy,invested=excluded.invested', rows)
        return jsonify(ok=True, count=len(rows))

    @app.get('/sw.js')
    def worker():
        return app.send_static_file('sw.js')

    return app


if __name__ == '__main__':
    create_app().run(host='0.0.0.0', port=int(os.environ.get('PORT', 8501)))
