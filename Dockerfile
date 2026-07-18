FROM node:20-alpine

WORKDIR /app

# Копируем манифесты и ставим зависимости (без devDependencies)
COPY package*.json ./
RUN npm install --omit=dev

# Копируем весь остальной код
COPY . .

# Открываем порт 5000 (по умолчанию в server.js)
EXPOSE 5000

# Запуск бэкенда
CMD ["npm", "start"]
