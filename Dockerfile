FROM python:3.12-slim
WORKDIR /app
COPY server ./server
COPY android/app/src/main/assets ./android/app/src/main/assets
RUN useradd -u 10001 -m poker && mkdir /app/data && chown poker:poker /app/data
USER poker
ENV HOST=0.0.0.0 PORT=8080 POKER_DB=/app/data/poker.sqlite3 PYTHONUNBUFFERED=1
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health',timeout=2)"
CMD ["python", "-m", "server.app"]
