# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS frontend-build
WORKDIR /app
COPY frontend/package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY frontend /app
RUN npm run build

FROM nginx:1.27-alpine AS runtime
RUN apk add --no-cache bash
COPY dockerfile/nginx.prod.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend-build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
