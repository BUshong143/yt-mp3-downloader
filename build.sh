#!/bin/bash
echo "Installing npm packages..."
npm install

echo "Installing yt-dlp binary..."
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o ./yt-dlp-bin
chmod +x ./yt-dlp-bin

echo "yt-dlp version:"
./yt-dlp-bin --version

echo "Build complete!"
