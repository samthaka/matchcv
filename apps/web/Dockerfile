# Stage 1: Build the frontend

FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Copy root and workspace manifests
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json

# Install dependencies
RUN npm ci

# Copy application source
COPY . .

# Build the frontend
RUN npm run build --workspace @matchcv/web


# Stage 2: Production image

FROM nginx:alpine AS production

# Copy custom Nginx configuration
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

# Copy the production frontend files
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

# Nginx listens on port 80
EXPOSE 80

# Keep Nginx running in the foreground
CMD ["nginx", "-g", "daemon off;"]

