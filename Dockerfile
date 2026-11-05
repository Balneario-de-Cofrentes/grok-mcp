# Stage 1: Build the application
FROM node:24.22.1-trixie-slim@sha256:89c5244bc22a9bc3287d89ebc7e49b9cb5bb84cd40e6175ac3421d5a9f68b95a AS builder

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install all dependencies (including devDependencies)
RUN npm ci

# Copy the rest of the application source code
COPY . .

# Increase memory limit for the build process (optional, keep if needed)
ENV NODE_OPTIONS=--max-old-space-size=4096

# Build the TypeScript code
RUN npm run build

# Optional: Prune devDependencies if you want to copy node_modules later
# RUN npm prune --production

# Stage 2: Create the final production image
FROM node:24.22.1-trixie-slim@sha256:89c5244bc22a9bc3287d89ebc7e49b9cb5bb84cd40e6175ac3421d5a9f68b95a

# Apply Debian security updates
RUN apt-get update \
    && apt-get upgrade -y \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json from the builder stage
COPY --from=builder /app/package*.json ./

# Install ONLY production dependencies
RUN npm ci --omit=dev

# Copy the compiled code from the builder stage
COPY --from=builder /app/build ./build

# Make port 3000 available
EXPOSE 3000

# Define environment variables if needed (e.g., for runtime)
# ENV NODE_ENV=production

# Run the app
CMD [ "npm", "start" ] 