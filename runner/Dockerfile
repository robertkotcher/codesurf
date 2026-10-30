FROM node:22-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates python3 python3-venv python3-pip ruby-full build-essential libpq-dev chromium ffmpeg procps && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/codesurf
RUN npm init -y && npm install --save-exact playwright@1.64.1 @openai/codex@0.166.0 && npx playwright install ffmpeg
COPY browser.mjs start.mjs agent.mjs report-schema.json ./
RUN mkdir -p /workspace /artifacts /root/.codex && git config --global user.email runner@codesurf.local && git config --global user.name CodeSurf
ENV NODE_PATH=/opt/codesurf/node_modules
WORKDIR /workspace
EXPOSE 3780
CMD ["node", "/opt/codesurf/browser.mjs", "serve"]
