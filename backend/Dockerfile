FROM python:3.12-slim

# System deps for opencv-python-headless, paddleocr runtime, pdf rasterization.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Persist HF + torch caches inside the container
ENV HF_HOME=/app/.cache/huggingface \
    TORCH_HOME=/app/.cache/torch

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
