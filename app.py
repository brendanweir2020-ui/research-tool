import os
import json
import uuid
import datetime
from pathlib import Path
from flask import Flask, render_template, request, jsonify
from dotenv import load_dotenv
import google.generativeai as genai
import PyPDF2
import docx
import requests
from bs4 import BeautifulSoup

load_dotenv()

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['RESULTS_FILE'] = 'results.json'
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB

Path(app.config['UPLOAD_FOLDER']).mkdir(exist_ok=True)


def load_results():
    if os.path.exists(app.config['RESULTS_FILE']):
        with open(app.config['RESULTS_FILE'], 'r') as f:
            return json.load(f)
    return []


def save_results(results):
    with open(app.config['RESULTS_FILE'], 'w') as f:
        json.dump(results, f, indent=2)


def extract_text_from_pdf(file_path):
    text = ""
    with open(file_path, 'rb') as f:
        reader = PyPDF2.PdfReader(f)
        for page in reader.pages:
            extracted = page.extract_text()
            if extracted:
                text += extracted + "\n"
    return text


def extract_text_from_docx(file_path):
    doc = docx.Document(file_path)
    return "\n".join([para.text for para in doc.paragraphs if para.text.strip()])


def extract_text_from_url(url):
    headers = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'}
    response = requests.get(url, timeout=30, headers=headers)
    response.raise_for_status()
    soup = BeautifulSoup(response.content, 'html.parser')
    for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
        tag.decompose()
    return soup.get_text(separator='\n', strip=True)


def analyze_with_gemini(text, source_name):
    api_key = os.getenv('GEMINI_API_KEY')
    if not api_key:
        raise ValueError("GEMINI_API_KEY not set in .env file")

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel('gemini-2.0-flash')

    # Gemini 2.0 Flash supports up to 1M tokens — trim generously
    trimmed_text = text[:300000]

    prompt = f"""You are a clinical summarization assistant specializing in physical therapy. Analyze the following research document and extract clinically useful information for a physical therapist.

Document source: {source_name}

Document content:
{trimmed_text}

Provide your analysis as a valid JSON object with EXACTLY these keys. Be thorough and clinically specific. If certain information is not present in the document, return an empty array [] or a note saying "Not addressed in this document."

{{
  "title": "The document title, or a descriptive title you infer from the content",
  "evidence_quality": {{
    "level": "One of: Systematic Review/Meta-analysis, Randomized Controlled Trial, Cohort/Observational Study, Case Series/Case Report, Expert Opinion/Narrative Review",
    "score": 1,
    "explanation": "2-3 sentences explaining why you assigned this evidence level and any notable methodological strengths or weaknesses"
  }},
  "clinical_summary": "2-4 sentence overview of the main findings and their clinical relevance to physical therapy",
  "key_findings": [
    "Specific measurable finding 1 (include statistics/numbers if available)",
    "Specific measurable finding 2",
    "Specific measurable finding 3"
  ],
  "population_studied": "Who was studied — age range, diagnosis, setting, sample size if mentioned",
  "exercise_protocols": [
    {{
      "condition_or_goal": "Specific condition or rehabilitation goal this protocol targets",
      "exercises": [
        {{
          "name": "Exercise name",
          "parameters": "Sets x reps, or duration, frequency per week, intensity/load guidance",
          "progression": "How to progress this exercise over time",
          "notes": "Form cues, contraindications, or special considerations"
        }}
      ],
      "program_duration": "Total program length if specified",
      "outcome_measures": "What outcomes this protocol was shown to improve"
    }}
  ],
  "patient_education": [
    "Plain-language point patients can understand — what they should know about their condition based on this research",
    "Another patient education point",
    "Another patient education point"
  ],
  "clinical_decision_points": {{
    "indications": [
      "Clear indication for using these interventions"
    ],
    "contraindications": [
      "Contraindication or situation to avoid"
    ],
    "red_flags": [
      "Warning sign that warrants further investigation or referral"
    ],
    "when_to_refer": [
      "Situation that warrants referral to another provider"
    ],
    "dosage_considerations": [
      "Specific dosage, frequency, or timing note relevant to clinical practice"
    ]
  }},
  "limitations": [
    "Notable limitation that affects how you should apply this research clinically"
  ],
  "clinical_bottom_line": "One sentence: what should a PT actually do differently after reading this research?"
}}

Return ONLY the JSON object. No markdown, no explanation, no code blocks — just the raw JSON."""

    response = model.generate_content(prompt)
    raw = response.text.strip()

    # Strip markdown code blocks if Gemini wraps them
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()

    return json.loads(raw)


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/process', methods=['POST'])
def process():
    api_key = os.getenv('GEMINI_API_KEY')
    if not api_key or api_key == 'your-api-key-here':
        return jsonify({'error': 'API key not configured. Please add your Gemini API key to the .env file and restart the app.'}), 400

    source_name = ""
    text = ""

    # Handle URL input (sent as JSON)
    if request.is_json:
        data = request.get_json()
        url = data.get('url', '').strip()
        if not url:
            return jsonify({'error': 'No URL provided'}), 400
        source_name = url
        try:
            text = extract_text_from_url(url)
        except Exception as e:
            return jsonify({'error': f'Could not fetch URL: {str(e)}'}), 400

    # Handle file upload
    elif 'file' in request.files:
        file = request.files['file']
        if not file or file.filename == '':
            return jsonify({'error': 'No file selected'}), 400

        source_name = file.filename
        safe_name = f"{uuid.uuid4()}_{file.filename}"
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], safe_name)
        file.save(file_path)

        try:
            ext = file.filename.lower().rsplit('.', 1)[-1]
            if ext == 'pdf':
                text = extract_text_from_pdf(file_path)
            elif ext == 'docx':
                text = extract_text_from_docx(file_path)
            elif ext == 'txt':
                with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                    text = f.read()
            else:
                return jsonify({'error': f'Unsupported file type: .{ext}. Please upload PDF, DOCX, or TXT files.'}), 400
        except Exception as e:
            return jsonify({'error': f'Could not read file: {str(e)}'}), 400
    else:
        return jsonify({'error': 'No file or URL provided'}), 400

    if not text.strip():
        return jsonify({'error': 'Could not extract any text from the document. Please check the file is not scanned/image-only.'}), 400

    try:
        analysis = analyze_with_gemini(text, source_name)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except json.JSONDecodeError:
        return jsonify({'error': 'Failed to parse AI response. Please try again.'}), 500
    except Exception as e:
        return jsonify({'error': f'Analysis failed: {str(e)}'}), 500

    result = {
        'id': str(uuid.uuid4()),
        'source': source_name,
        'date': datetime.datetime.now().isoformat(),
        'word_count': len(text.split()),
        'analysis': analysis
    }

    results = load_results()
    results.insert(0, result)
    save_results(results)

    return jsonify(result)


@app.route('/history')
def history():
    results = load_results()
    # Return summary info for sidebar (not full analysis)
    summaries = [
        {
            'id': r['id'],
            'source': r['source'],
            'date': r['date'],
            'title': r['analysis'].get('title', r['source']),
            'evidence_level': r['analysis'].get('evidence_quality', {}).get('level', 'Unknown'),
            'evidence_score': r['analysis'].get('evidence_quality', {}).get('score', 0),
        }
        for r in results
    ]
    return jsonify(summaries)


@app.route('/result/<result_id>')
def get_result(result_id):
    results = load_results()
    for result in results:
        if result['id'] == result_id:
            return jsonify(result)
    return jsonify({'error': 'Result not found'}), 404


@app.route('/delete/<result_id>', methods=['DELETE'])
def delete_result(result_id):
    results = load_results()
    results = [r for r in results if r['id'] != result_id]
    save_results(results)
    return jsonify({'success': True})


if __name__ == '__main__':
    import webbrowser
    import threading

    def open_browser():
        import time
        time.sleep(1.2)
        webbrowser.open('http://localhost:5001')

    threading.Thread(target=open_browser, daemon=True).start()
    print("\n✓ PT Research Tool is starting...")
    print("✓ Opening in your browser at http://localhost:5001")
    print("✓ Press Ctrl+C in this window to stop the app\n")
    app.run(debug=False, port=5001, host='127.0.0.1')
