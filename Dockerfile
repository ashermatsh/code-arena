# Judge server with every supported toolchain (C++, Java, Python, JavaScript).
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends g++ python3 openjdk-17-jdk-headless \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY shared ./shared
COPY public ./public
COPY problems ./problems

# Submissions run as an unprivileged user.
RUN useradd --system --create-home judge
USER judge

ENV HOST=0.0.0.0 PORT=3000 NODE_ENV=production
EXPOSE 3000
CMD ["node", "server/index.js"]
