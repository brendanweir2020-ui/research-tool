#!/bin/bash
# PT Research Tool - Launcher
# Double-click this file to start the app.

cd "$(dirname "$0")"

echo ""
echo "======================================="
echo "  PT Research Tool — Starting"
echo "======================================="
echo ""

# Check that install has been run
if [ ! -d "venv" ]; then
  echo "❌ App is not installed yet."
  echo "Please double-click 'install.command' first."
  echo ""
  read -p "Press Enter to close..."
  exit 1
fi

# Check for .env file
if [ ! -f ".env" ]; then
  echo "❌ No .env file found."
  echo "Please run install.command first."
  echo ""
  read -p "Press Enter to close..."
  exit 1
fi

# Check for API key
if grep -q "your-api-key-here" .env; then
  echo "⚠️  No API key detected."
  echo ""
  echo "Please edit the .env file and replace 'your-api-key-here'"
  echo "with your Anthropic API key from: https://console.anthropic.com/"
  echo ""
  echo "Opening .env file..."
  open -e .env 2>/dev/null || open .env
  echo ""
  read -p "Press Enter to close..."
  exit 1
fi

# Activate virtual environment
source venv/bin/activate

echo "✓ Starting PT Research Tool..."
echo "✓ Your browser will open automatically"
echo ""
echo "To stop the app: press Ctrl+C in this window, or just close this window."
echo ""

# Start the app
python3 app.py
