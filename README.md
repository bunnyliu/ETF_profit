# 나의 ETF — 아이폰 홈 화면 웹앱

기존 `etf.py`의 국내 ETF 조회·투자금액/평균 취득가 기반 손익 계산을 모바일 웹앱으로 옮겼습니다. Python 3.12를 사용합니다. 화면과 서버를 함께 제공하는 Flask 앱이며 Streamlit 설치는 필요하지 않습니다.

## 제공 기능

- 국내 ETF 검색, 종목코드 직접 입력, 투자 내역 추가·수정·삭제
- 휴대전화 화면에 맞는 종목 카드와 전체 평가손익
- 접속 암호 보호: 서버의 `APP_PASSWORD`가 없으면 투자 화면과 API를 열지 않습니다.
- 기존 `my_portfolio.csv` 가져오기, UTF-8 BOM CSV 백업
- SQLite 서버 저장: 동일한 앱 주소와 암호를 사용하는 기기끼리 하나의 포트폴리오 공유
- 홈 화면 아이콘, 독립 실행 화면, 오프라인 안내. 인터넷 없이 시세를 조회하거나 투자 내역을 편집하는 앱은 아닙니다.

## PC에서 실행

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
# 암호가 터미널 기록에 남지 않게 입력합니다.
read -r -s -p '접속 암호: ' APP_PASSWORD
export APP_PASSWORD
.venv/bin/python app.py
```

Windows PowerShell에서는 `.venv\Scripts\python -m pip install -r requirements.txt`로 설치하고, `$env:APP_PASSWORD`를 설정한 뒤 `.venv\Scripts\python app.py`로 실행합니다. 로컬 기본 포트는 8501입니다. 실제 인터넷 서비스에는 Flask 개발 서버 대신 아래 Gunicorn 명령을 사용하세요.

## PC를 꺼도 아이폰에서 사용하기 — Render 배포 예시

GitHub 저장소에 파일이 올라간 뒤 진행합니다. GitHub 연결만으로 서버가 배포되지는 않습니다.

1. Render에서 **New → Web Service**를 선택하고 `bunnyliu/ETF_profit` 저장소의 `main`을 연결합니다.
2. Runtime은 **Python 3**, Python 버전은 `3.12.14`를 선택하거나 `PYTHON_VERSION=3.12.14` 환경변수를 지정합니다.
3. Build Command: `pip install -r requirements.txt`
4. Start Command: `gunicorn 'app:create_app()' --bind 0.0.0.0:$PORT --workers 1 --threads 4 --timeout 90 --no-control-socket --access-logfile -`
5. 환경변수에 `APP_PASSWORD`(본인만 아는 긴 암호), `COOKIE_SECURE=true`, `ETF_DATA_DIR=/var/data/etf`를 설정합니다. 암호는 GitHub나 채팅에 올리지 않습니다.
6. **Persistent Disk**를 `/var/data`에 연결하고 배포합니다. Render의 영구 디스크는 유료 플랜이 필요할 수 있으므로 요금을 확인하세요. 디스크 없이 체험하려면 `ETF_DATA_DIR`을 생략하고 CSV를 수시로 백업하세요. 이 경우 재배포·재시작 때 데이터가 사라질 수 있습니다.
7. 발급된 **HTTPS 주소**를 열어 로그인 → 종목 추가 → 조회 → CSV 백업까지 확인합니다.

다른 호스팅도 Python 3.12, HTTPS, 영구 저장공간과 위 환경변수를 지원하면 사용할 수 있습니다. 서버는 네이버의 `finance.naver.com`, `api.finance.naver.com`에 HTTPS 접속할 수 있어야 합니다. 네이버 정책이나 데이터 형식 변경으로 조회가 제한될 수 있습니다.

Docker를 사용하는 경우 `docker build -t etf-portfolio .` 후 `APP_PASSWORD`를 환경변수로 주입하고 `/data`에 영구 볼륨을 연결합니다. 포트는 8501입니다. 운영 환경에서는 HTTPS 프록시 뒤에서 `COOKIE_SECURE=true`를 사용하세요.

## 아이폰 홈 화면에 추가

1. 아이폰 **Safari**에서 배포된 HTTPS 주소를 엽니다.
2. **공유 → 홈 화면에 추가**를 선택합니다. ‘웹 앱으로 열기’가 표시되면 켭니다.
3. 홈 화면의 **나의 ETF** 아이콘으로 실행하고 암호로 로그인합니다.

HTTPS가 필요합니다. 단순히 PC에서 켠 개발 서버의 내부 주소로 접속하는 방식은 PC를 꺼도 실행되는 배포를 대신하지 않습니다. 실제 아이폰에서 설치하는 절차는 사용자가 배포 후 확인해야 합니다.

## 기존 PC 기록 옮기기

기존 스크립트 옆의 `my_portfolio.csv`를 아이폰 파일 앱으로 옮긴 다음 앱의 **CSV 가져오기**에서 선택하세요. PC 브라우저에서 같은 배포 주소에 접속해 업로드해도 됩니다. 열 이름은 `종목코드,종목명,취득가,투자금액`이며 기존 파일 형식과 같습니다.

가져오기는 종목코드로 병합합니다. 같은 코드는 덮어쓰고 나머지는 유지합니다. 잘못된 파일은 전체를 거절하며 기존 내역을 변경하지 않습니다. 먼저 CSV를 백업하세요. 투자 내역·암호·DB는 GitHub에 포함하지 않습니다.

## 계산 및 시세 기준

수량 = 투자금액 ÷ 취득가, 평가금액 = 수량 × 최근 가격, 손익 = 평가금액 − 투자금액입니다. 소수 수량을 허용하는 원본 계산을 유지하므로 실제 정수 보유 수량과 다를 수 있습니다. 수수료·세금·분배금은 포함하지 않습니다.

네이버의 최근 일별 가격과 전일 가격을 비교합니다. 실시간 체결가가 아니며 시세 기준일을 표시합니다. 시세는 최대 60초, 검색 목록은 하루 캐시합니다. 하나라도 시세 조회에 실패하면 전체 평가금액·손익·수익률을 `—`로 표시합니다. 조회 실패를 0원이나 손실로 계산하지 않습니다.

암호는 모든 사용자가 공유하는 단일 포트폴리오용입니다. 여러 사용자에게 공개하는 서비스나 사용자별 계좌 기능은 제공하지 않습니다. 브라우저 오프라인 캐시에는 투자 내역·CSV·로그인 응답을 저장하지 않습니다.

## 개발 검증

```bash
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q
```

자동 테스트는 시세 응답을 대체해 수익 계산, 조회 실패, 로그인/CSRF, CSV 검증·병합·백업, 데이터 재시작 복원을 검증합니다. 네이버 실제 응답 및 배포 환경 접속은 별도 확인이 필요합니다.
