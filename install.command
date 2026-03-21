#!/bin/bash
# PT Research Tool - First-time installer
# Double-click this file to install. You only need to do this once.

cd "$(dirname "$0")"

echo ""
echo "======================================="
echo "  PT Research Tool — Installing"
echo "======================================="
echo ""

# Check for Python 3
if ! command -v python3 &>/dev/null; then
  echo "❌ Python 3 is not installed."
  echo ""
  echo "Please install Python 3 from: https://www.python.org/downloads/"
  echo "Then double-click install.command again."
  echo ""
  read -p "Press Enter to close..."
  exit 1
fi

echo "✓ Python 3 found: $(python3 --version)"

# Create virtual environment
echo ""
echo "Setting up virtual environment..."
python3 -m venv venv
if [ $? -ne 0 ]; then
  echo "❌ Failed to create virtual environment."
  read -p "Press Enter to close..."
  exit 1
fi
echo "✓ Virtual environment created"

# Activate and install dependencies
source venv/bin/activate

echo ""
echo "Installing dependencies (this may take a minute)..."
pip install --upgrade pip --quiet
pip install -r requirements.txt --quiet
if [ $? -ne 0 ]; then
  echo "❌ Failed to install dependencies."
  read -p "Press Enter to close..."
  exit 1
fi
echo "✓ Dependencies installed"

# Set up .env file if it doesn't exist
if [ ! -f ".env" ]; then
  cp .env.example .env
  echo ""
  echo "✓ Created .env file"
fi

echo ""
echo "======================================="
echo "  Installation Complete!"
echo "======================================="
echo ""
echo "NEXT STEP: Add your Anthropic API key."
echo ""
echo "1. Get your API key from: https://console.anthropic.com/"
echo "2. Open the file called '.env' in this folder"
echo "   (it may be hidden — press Cmd+Shift+. in Finder to show hidden files)"
echo "3. Replace 'your-api-key-here' with your actual key"
echo "4. Save the file"
echo "5. Double-click 'start.command' to launch the app"
echo ""
echo "Opening the .env file now..."
sleep 1
open -e .env 2>/dev/null || open .env 2>/dev/null || echo "(Could not open .env automatically — open it manually in TextEdit)"
echo ""
read -p "Press Enter to close this window..."
