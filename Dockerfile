FROM node:22-bookworm-slim

WORKDIR /app

# Копируем манифесты и ставим зависимости (без devDependencies)
COPY package*.json ./
RUN npm install --omit=dev

# Устанавливаем браузер chromium для playwright и все необходимые системные зависимости
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install chromium --with-deps

# Копируем весь остальной код
COPY . .

# Ставим pm2 глобально
RUN npm install -g pm2

# Открываем порт 5000 (по умолчанию в server.js)
EXPOSE 5000

# Запуск бэкенда через pm2-runtime в кластерном режиме (на все ядра)
CMD ["pm2-runtime", "src/server.js", "-i", "max"]
