FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py market.py ./
COPY templates ./templates
COPY static ./static
ENV ETF_DATA_DIR=/data
EXPOSE 8501
CMD ["gunicorn", "app:create_app()", "--bind", "0.0.0.0:8501", "--workers", "1", "--threads", "4", "--timeout", "90", "--no-control-socket", "--access-logfile", "-"]
