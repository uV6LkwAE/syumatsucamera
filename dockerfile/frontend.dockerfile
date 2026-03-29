# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS deps-dev
WORKDIR /app
RUN chown -R node:node /app
USER node
COPY --chown=node:node frontend/package*.json ./
RUN npm install

FROM node:22-alpine AS deps-prod
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci

FROM deps-dev AS dev
COPY --chown=node:node frontend /app
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]

FROM deps-prod AS build
COPY frontend /app
RUN npm run build

FROM nginx:1.27-alpine AS static
RUN apk add --no-cache bash
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
