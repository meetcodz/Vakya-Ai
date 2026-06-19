FROM python:3.11-slim

# Install ffmpeg (required by faster-whisper)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Set working directory to backend
WORKDIR /app/backend

# Copy requirements first (layer caching)
COPY backend/requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the full project
COPY . /app

# Expose port (Render sets $PORT dynamically)
EXPOSE 8000

# Start the FastAPI app from the backend directory
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
