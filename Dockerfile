# syntax=docker/dockerfile:1
# Stage 1 – Backend Builder (Python)
FROM python:3.11-slim AS backend-builder

WORKDIR /build/backend

# Install Python dependencies needed by the FastAPI backend
RUN pip install --no-cache-dir \
    PyPDF2 \
    pyttsx3 \
    SpeechRecognition \
    groq \
    python-dotenv \
    boto3 \
    uvicorn

# Copy the backend source code
COPY . .

# This stage builds the backend executable environment (packages + source)
# – No application artifacts are produced here; just ensure dependencies are pre‑installed

# Stage 2 – Frontend Builder (Node.js / Vite)
FROM node:20-alpine AS frontend-builder

WORKDIR /build/frontend

# Copy only the dependency manifests then install
COPY frontend/package*.json ./
# Install dependencies (omit dev packages for production)
RUN npm install --omit=dev

# Copy the full frontend source and build it
COPY frontend .
RUN npm run build

# Stage 3 – Runtime (Python + Nginx)
FROM python:3.11-slim AS runtime

WORKDIR /app

# Copy backend code and dependencies from the builder
COPY --from=backend-builder /build/backend/ .

# Copy built frontend static files
COPY --from=frontend-builder /build/frontend/dist ./frontend

# Install Nginx and clean up
RUN apt-get update && \
    apt-get install -y nginx && \
    rm -rf /var/lib/apt/lists/*

# Configure Nginx: serve static assets and proxy API calls to the internal FastAPI service
RUN mkdir -p /etc/nginx/conf.d && \
    cat > /etc/nginx/conf.d/default.conf <<'EOF'
server {
    listen 80;
    server_name localhost;

    root /app/frontend;
    index index.html;

    # Serve static assets and fallback to index.html for SPA routes
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy all /api URLs to the internal FastAPI backend
    location /api/ {
        proxy_pass http://127.0.0.1:8000/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Connection keep-alive;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

# Create an entry script that starts the backend and Nginx
RUN cat > /usr/local/bin/start.sh <<'EOL'
#!/bin/sh
# Ensure the Nginx pid directory exists
mkdir -p /run/nginx

# Start the FastAPI backend
uvicorn server:app --host 127.0.0.1 --port 8000 &

# Start Nginx in the foreground
nginx -g 'daemon off;'
EOL

RUN chmod +x /usr/local/bin/start.sh

# Expose the web port
EXPOSE 80

# Start the combined service
CMD ["/usr/local/bin/start.sh"]