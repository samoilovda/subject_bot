#!/bin/bash

echo "🛑 Stopping PM2..."
pm2 stop all

echo "⬇️ Pulling latest changes..."
git pull

echo "🚀 Starting Ecosystem..."
pm2 start ecosystem.config.cjs

echo "✅ Update complete!"
