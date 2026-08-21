FROM mcr.microsoft.com/playwright:v1.62.0-noble
RUN apt-get update && apt-get install -y --no-install-recommends libreoffice poppler-utils fonts-noto-cjk && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
USER pwuser
