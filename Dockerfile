FROM node:22-slim AS frontend

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
RUN npm run build

FROM python:3.12-slim

WORKDIR /app
RUN pip install --no-cache-dir fastapi uvicorn[standard] httpx pydantic python-multipart
COPY . .
COPY --from=frontend /app/dist ./dist
EXPOSE 80
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "80"]
