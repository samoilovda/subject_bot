FROM node:20-alpine

# Создаем папку приложения
WORKDIR /app

# Копируем файлы package.json и package-lock.json
COPY package*.json ./

# Устанавливаем зависимости (только для продакшена)
RUN npm ci --only=production && npm cache clean --force

# Копируем остальной код
COPY . .

# Команда запуска (убедитесь, что ваш главный файл называется index.js или поправьте тут)
CMD ["node", "src/index.js"]