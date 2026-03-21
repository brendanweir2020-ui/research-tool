# PT Research Tool

A desktop app for physical therapists to digest research papers, summarize findings, and extract actionable clinical insights.

## What It Does

Upload any research paper (PDF, Word, or text file) or paste a URL, and the tool will generate:

- **Evidence Quality Rating** — systematic review, RCT, cohort study, etc.
- **Clinical Summary** — key findings in plain language
- **Exercise Protocols** — specific exercises with sets/reps/progressions
- **Patient Education** — points you can share directly with patients
- **Clinical Decision Points** — indications, contraindications, red flags, referral triggers

## Setup (One Time)

### Step 1: Install Python
Download and install Python 3 from [python.org](https://www.python.org/downloads/)

### Step 2: Get an API Key
Sign up at [console.anthropic.com](https://console.anthropic.com/) and create an API key.

### Step 3: Install the App
Double-click `install.command` — it will set everything up automatically.

### Step 4: Add Your API Key
The installer will open the `.env` file. Replace `your-api-key-here` with your actual key.

## Daily Use

1. Double-click `start.command`
2. The app opens in your browser automatically
3. Drag and drop a PDF, or paste a URL
4. Wait ~30 seconds for analysis
5. Review results and click Export to print

## File Types Supported

| Type | Extension |
|------|-----------|
| PDF research papers | `.pdf` |
| Word documents | `.docx` |
| Plain text | `.txt` |
| Web articles | paste URL |

## Notes

- Your documents and results are saved locally on your computer only
- The API key stays in your `.env` file — never share it
- Each analysis uses the Claude AI model and will count toward your API usage
- Results are saved in `results.json` and appear in the history sidebar
