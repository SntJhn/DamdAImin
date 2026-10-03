FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    ASR_MODEL=large-v3-turbo \
    ASR_LANGUAGE=auto \
    ASR_DEVICE=cpu \
    ASR_COMPUTE_TYPE=int8

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --upgrade pip \
    && pip install -r requirements.txt

COPY main.py ./
COPY vendor ./vendor

EXPOSE 4100

CMD ["python", "main.py"]
