import os
import json
import uuid
import datetime
from pathlib import Path
from flask import Flask, render_template, request, jsonify
from dotenv import load_dotenv
from groq import Groq
import PyPDF2
from pdfminer.high_level import extract_text as pdfminer_extract
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


def get_groq_client():
    api_key = os.getenv('GROQ_API_KEY')
    if not api_key:
        raise ValueError("GROQ_API_KEY not set in .env file")
    return Groq(api_key=api_key)


def strip_json(raw):
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return raw.strip()


def extract_text_from_pdf(file_path):
    # Try pdfminer first (handles modern PDFs better)
    try:
        text = pdfminer_extract(file_path)
        if text and text.strip():
            print(f"  [PDF] pdfminer extracted {len(text)} chars from {file_path}")
            return text
    except Exception as e:
        print(f"  [PDF] pdfminer failed ({e}), trying PyPDF2...")

    # Fall back to PyPDF2
    try:
        text = ""
        with open(file_path, 'rb') as f:
            reader = PyPDF2.PdfReader(f)
            for page in reader.pages:
                extracted = page.extract_text()
                if extracted:
                    text += extracted + "\n"
        if text.strip():
            print(f"  [PDF] PyPDF2 extracted {len(text)} chars from {file_path}")
            return text
    except Exception as e:
        print(f"  [PDF] PyPDF2 also failed: {e}")

    print(f"  [PDF] No text extracted from {file_path} — likely a scanned image PDF")
    return ""


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


def call_groq_with_retry(client, **kwargs):
    """Call Groq API with automatic retry on rate limit errors."""
    import time
    delays = [15, 30, 60]  # seconds to wait on each retry
    for attempt, delay in enumerate(delays + [None]):
        try:
            return client.chat.completions.create(**kwargs)
        except Exception as e:
            err = str(e)
            if '429' in err or 'rate limit' in err.lower() or 'quota' in err.lower():
                if delay is None:
                    raise Exception(f"Rate limit exceeded after {len(delays)} retries. Try again in a minute.")
                print(f"Rate limit hit — waiting {delay}s before retry {attempt + 1}...")
                time.sleep(delay)
            else:
                raise


def analyze_document(text, source_name):
    client = get_groq_client()
    # Keep under ~3,000 tokens of content to stay within free-tier TPM limits
    trimmed_text = text[:10000]

    prompt = f"""You are an expert clinical assistant specializing in physical therapy and musculoskeletal rehabilitation. Analyze the following research document and extract highly specific, clinically actionable information that a PT can use directly in practice.

Document source: {source_name}

Document content:
{trimmed_text}

Provide your analysis as a valid JSON object. Be precise and specific — include actual numbers, dosages, sets/reps, percentages, and outcome measures wherever the research provides them. Do not generalize when specifics are available.

{{
  "title": "The document title, or a descriptive title you infer from the content",
  "condition": "Primary musculoskeletal condition or body region this research addresses (e.g. 'Shoulder - Bicep Tendinopathy', 'Knee - ACL Reconstruction', 'Lumbar - Disc Herniation')",
  "evidence_quality": {{
    "level": "One of: Systematic Review/Meta-analysis, Randomized Controlled Trial, Cohort/Observational Study, Case Series/Case Report, Expert Opinion/Narrative Review",
    "score": 1,
    "explanation": "2-3 sentences on study design quality, sample size, blinding, control groups, follow-up period, and any major methodological strengths or weaknesses"
  }},
  "clinical_summary": "3-5 sentence overview of the key findings and their direct relevance to PT clinical practice",
  "key_findings": [
    "Specific finding with numbers (e.g. '67% reduction in pain VAS scores at 6 weeks in the eccentric exercise group vs 23% in controls, p<0.05')",
    "Another specific measurable finding",
    "Another specific measurable finding"
  ],
  "population_studied": "Age range, sex breakdown if reported, diagnosis criteria, sample size, setting (clinic/hospital/community), inclusion/exclusion criteria summary",
  "exercise_protocols": [
    {{
      "condition_or_goal": "Specific condition or rehab phase this protocol targets",
      "phase": "e.g. Acute (0-2 weeks), Subacute (2-6 weeks), Strengthening, Return to Sport",
      "exercises": [
        {{
          "name": "Full exercise name",
          "parameters": "Exact sets x reps x frequency (e.g. 3 sets x 15 reps x 3/week), load (% 1RM or RPE or bodyweight), rest periods",
          "tempo": "Eccentric:isometric:concentric tempo if specified (e.g. 3:1:1)",
          "progression": "Specific progression criteria — when to advance, by how much (e.g. 'Increase load by 2.5kg when patient achieves 3x15 without pain >3/10')",
          "notes": "Key form cues, muscle activation targets, positioning, equipment needed, pain guidelines during exercise"
        }}
      ],
      "program_duration": "Total weeks/months of the program",
      "frequency": "Sessions per week",
      "outcome_measures": "Specific validated tools used (e.g. DASH, PSFS, VAS, NPRS, LEFS, KOOS) and results achieved"
    }}
  ],
  "outcome_measures_used": [
    "List any validated outcome measures mentioned (DASH, VAS, NPRS, KOOS, LEFS, SF-36, etc.) with the scores or thresholds reported"
  ],
  "patient_education": [
    "Specific, plain-language point a PT can tell a patient directly (e.g. 'Your tendon heals best with controlled loading — pain up to 4/10 during exercise is acceptable and expected')",
    "Another direct patient education point",
    "Another direct patient education point",
    "Another direct patient education point"
  ],
  "clinical_decision_points": {{
    "indications": [
      "Specific indication with criteria (e.g. 'Appropriate for patients >6 weeks post-onset with pain <7/10 at rest')"
    ],
    "contraindications": [
      "Specific contraindication (e.g. 'Avoid heavy eccentric loading within 2 weeks of corticosteroid injection')"
    ],
    "red_flags": [
      "Specific red flag to monitor (e.g. 'Night pain unrelated to position — consider oncologic referral')"
    ],
    "when_to_refer": [
      "Specific referral trigger (e.g. 'No improvement after 6 weeks of conservative management — refer for imaging')"
    ],
    "pain_guidelines": "Pain monitoring approach used in the study (e.g. 'VAS up to 5/10 during exercise was permitted; pain must return to baseline within 24h')",
    "dosage_considerations": [
      "Specific load, frequency, or timing guidance from the research"
    ]
  }},
  "limitations": [
    "Specific limitation and how it affects clinical application"
  ],
  "clinical_bottom_line": "One concrete sentence: the single most important thing a PT should do differently or start doing based on this research"
}}

Return ONLY the JSON object. No markdown, no explanation, no code blocks — just raw JSON."""

    response = call_groq_with_retry(client,
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=4096,
        temperature=0.2,
    )

    raw = strip_json(response.choices[0].message.content)
    return json.loads(raw)


def synthesize_condition(condition_name, papers):
    """Compile multiple papers on the same condition into a master clinical protocol."""
    client = get_groq_client()

    summaries = []
    for i, p in enumerate(papers[:8], 1):  # Cap at 8 papers to stay in token budget
        a = p['analysis']
        summaries.append(f"""
PAPER {i}: {a.get('title', p['source'])}
Evidence level: {a.get('evidence_quality', {}).get('level', 'Unknown')} (score: {a.get('evidence_quality', {}).get('score', '?')}/5)
Summary: {a.get('clinical_summary', '')}
Key findings: {json.dumps(a.get('key_findings', []))}
Exercise protocols: {json.dumps(a.get('exercise_protocols', []))}
Clinical decisions: {json.dumps(a.get('clinical_decision_points', {}))}
Bottom line: {a.get('clinical_bottom_line', '')}
""")

    combined = "\n---\n".join(summaries)

    prompt = f"""You are an expert physical therapist synthesizing research evidence for clinical practice.

You have {len(papers)} research papers on: {condition_name}

Here are the paper summaries:
{combined}

Synthesize these papers into a single, comprehensive master clinical protocol. Where papers agree, consolidate. Where they conflict, note the disagreement and explain which evidence is stronger and why.

Return a JSON object with this structure:

{{
  "condition": "{condition_name}",
  "paper_count": {len(papers)},
  "overall_evidence_strength": "Strong / Moderate / Limited / Conflicting — with 1-2 sentence explanation",
  "consensus_findings": [
    "Finding that multiple papers agree on, with which papers support it"
  ],
  "conflicting_findings": [
    "Area where papers disagree, what each says, and which evidence is stronger"
  ],
  "master_exercise_protocol": [
    {{
      "phase": "Phase name (e.g. Acute, Subacute, Strengthening, Return to Sport)",
      "timeframe": "Weeks X-Y",
      "exercises": [
        {{
          "name": "Exercise name",
          "parameters": "Sets x reps x frequency, load guidance",
          "progression": "When and how to progress",
          "evidence_source": "Which paper(s) support this exercise",
          "notes": "Key clinical notes"
        }}
      ]
    }}
  ],
  "combined_patient_education": [
    "Consolidated patient education point supported by the research"
  ],
  "combined_clinical_decisions": {{
    "indications": ["Consolidated indication"],
    "contraindications": ["Consolidated contraindication"],
    "red_flags": ["Consolidated red flag"],
    "when_to_refer": ["Consolidated referral trigger"],
    "pain_guidelines": "Best-supported pain monitoring approach across papers"
  }},
  "research_gaps": [
    "Important clinical question not yet answered by this body of research"
  ],
  "clinical_bottom_line": "The single most important takeaway from this collection of research for a PT treating this condition"
}}

Return ONLY the JSON. No markdown, no code blocks."""

    response = call_groq_with_retry(client,
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=4096,
        temperature=0.2,
    )

    raw = strip_json(response.choices[0].message.content)
    return json.loads(raw)


# ── Routes ──

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/process', methods=['POST'])
def process():
    api_key = os.getenv('GROQ_API_KEY')
    if not api_key or api_key == 'your-api-key-here':
        return jsonify({'error': 'API key not configured. Please add your Groq API key to the .env file and restart the app.'}), 400

    source_name = ""
    text = ""

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
                return jsonify({'error': f'Unsupported file type: .{ext}'}), 400
        except Exception as e:
            return jsonify({'error': f'Could not read file: {str(e)}'}), 400
    else:
        return jsonify({'error': 'No file or URL provided'}), 400

    if not text.strip():
        msg = f'No text found in "{source_name}". It may be a scanned image PDF — only text-based PDFs are supported.'
        print(f"  [ERROR] {msg}")
        return jsonify({'error': msg}), 400

    print(f"  [OK] Extracted {len(text.split())} words from {source_name}, sending to AI...")
    try:
        analysis = analyze_document(text, source_name)
        print(f"  [OK] Analysis complete for {source_name}")
    except ValueError as e:
        print(f"  [ERROR] {source_name}: {e}")
        return jsonify({'error': str(e)}), 400
    except json.JSONDecodeError as e:
        print(f"  [ERROR] JSON parse failed for {source_name}: {e}")
        return jsonify({'error': 'AI returned invalid response. Please try again.'}), 500
    except Exception as e:
        print(f"  [ERROR] {source_name}: {e}")
        return jsonify({'error': f'Analysis failed: {str(e)}'}), 500

    result = {
        'id': str(uuid.uuid4()),
        'source': source_name,
        'date': datetime.datetime.now().isoformat(),
        'word_count': len(text.split()),
        'tags': [],
        'analysis': analysis
    }

    results = load_results()
    results.insert(0, result)
    save_results(results)

    return jsonify(result)


@app.route('/tag/<result_id>', methods=['POST'])
def update_tags(result_id):
    data = request.get_json()
    tags = data.get('tags', [])

    results = load_results()
    for result in results:
        if result['id'] == result_id:
            result['tags'] = tags
            save_results(results)
            return jsonify({'success': True})
    return jsonify({'error': 'Result not found'}), 404


@app.route('/tags')
def get_all_tags():
    results = load_results()
    tag_map = {}  # condition -> {subtype -> [result summaries]}

    for r in results:
        for tag in r.get('tags', []):
            parts = [p.strip() for p in tag.split('/')]
            condition = parts[0] if parts else tag
            subtype = parts[1] if len(parts) > 1 else None

            if condition not in tag_map:
                tag_map[condition] = {}

            key = subtype or '__all__'
            if key not in tag_map[condition]:
                tag_map[condition][key] = []

            tag_map[condition][key].append({
                'id': r['id'],
                'title': r['analysis'].get('title', r['source']),
                'date': r['date'],
                'evidence_score': r['analysis'].get('evidence_quality', {}).get('score', 0),
                'evidence_level': r['analysis'].get('evidence_quality', {}).get('level', ''),
            })

    return jsonify(tag_map)


@app.route('/synthesize', methods=['POST'])
def synthesize():
    data = request.get_json()
    condition = data.get('condition', '')
    tag_filter = data.get('tag', '')  # full tag like "Shoulder / Bicep Tendinopathy"

    if not condition and not tag_filter:
        return jsonify({'error': 'No condition specified'}), 400

    results = load_results()
    matching = []
    for r in results:
        for tag in r.get('tags', []):
            if tag_filter and tag == tag_filter:
                matching.append(r)
                break
            elif condition and tag.startswith(condition):
                matching.append(r)
                break

    if len(matching) < 2:
        return jsonify({'error': f'Need at least 2 tagged papers to synthesize. Found {len(matching)}.'}), 400

    label = tag_filter or condition
    try:
        synthesis = synthesize_condition(label, matching)
    except json.JSONDecodeError:
        return jsonify({'error': 'Failed to parse synthesis. Please try again.'}), 500
    except Exception as e:
        return jsonify({'error': f'Synthesis failed: {str(e)}'}), 500

    return jsonify({
        'id': str(uuid.uuid4()),
        'type': 'synthesis',
        'condition': label,
        'paper_count': len(matching),
        'date': datetime.datetime.now().isoformat(),
        'synthesis': synthesis
    })


@app.route('/history')
def history():
    results = load_results()
    summaries = [
        {
            'id': r['id'],
            'source': r['source'],
            'date': r['date'],
            'title': r['analysis'].get('title', r['source']),
            'evidence_level': r['analysis'].get('evidence_quality', {}).get('level', 'Unknown'),
            'evidence_score': r['analysis'].get('evidence_quality', {}).get('score', 0),
            'tags': r.get('tags', []),
            'condition': r['analysis'].get('condition', ''),
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


@app.route('/chat', methods=['POST'])
def chat():
    data = request.get_json()
    message = data.get('message', '').strip()
    history = data.get('history', [])  # [{role, content}, ...]
    context = data.get('context', {})  # paper analysis or synthesis data

    if not message:
        return jsonify({'error': 'No message provided'}), 400

    try:
        client = get_groq_client()
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    # Build system prompt from paper/synthesis context
    ctx_type = context.get('type', 'paper')
    if ctx_type == 'synthesis':
        s = context.get('synthesis', {})
        system = f"""You are an expert physical therapy clinical assistant. A PT is asking you questions about a research synthesis they just generated.

SYNTHESIS TOPIC: {context.get('condition', '')}
PAPERS COMPILED: {context.get('paper_count', '')}

OVERALL EVIDENCE: {s.get('overall_evidence_strength', '')}

CONSENSUS FINDINGS:
{chr(10).join('- ' + f for f in s.get('consensus_findings', []))}

CONFLICTING FINDINGS:
{chr(10).join('- ' + f for f in s.get('conflicting_findings', []))}

MASTER PROTOCOL PHASES:
{json.dumps(s.get('master_exercise_protocol', []), indent=2)}

COMBINED PATIENT EDUCATION:
{chr(10).join('- ' + f for f in s.get('combined_patient_education', []))}

CLINICAL BOTTOM LINE: {s.get('clinical_bottom_line', '')}

RESEARCH GAPS:
{chr(10).join('- ' + g for g in s.get('research_gaps', []))}"""

    else:
        a = context.get('analysis', {})
        eq = a.get('evidence_quality', {})
        system = f"""You are an expert physical therapy clinical assistant. A PT is asking you questions about a research paper they just analyzed.

PAPER: {a.get('title', context.get('source', ''))}
CONDITION: {a.get('condition', '')}
EVIDENCE LEVEL: {eq.get('level', '')} ({eq.get('score', '')}/5)
EVIDENCE EXPLANATION: {eq.get('explanation', '')}

CLINICAL SUMMARY:
{a.get('clinical_summary', '')}

KEY FINDINGS:
{chr(10).join('- ' + f for f in a.get('key_findings', []))}

POPULATION STUDIED: {a.get('population_studied', '')}

EXERCISE PROTOCOLS:
{json.dumps(a.get('exercise_protocols', []), indent=2)}

PATIENT EDUCATION POINTS:
{chr(10).join('- ' + p for p in a.get('patient_education', []))}

CLINICAL DECISION POINTS:
{json.dumps(a.get('clinical_decision_points', {}), indent=2)}

OUTCOME MEASURES: {', '.join(a.get('outcome_measures_used', []))}

LIMITATIONS:
{chr(10).join('- ' + l for l in a.get('limitations', []))}

CLINICAL BOTTOM LINE: {a.get('clinical_bottom_line', '')}"""

    system += """

Answer questions as a knowledgeable clinical colleague would — practically, specifically, and concisely. Reference exact data from the research when relevant (sets/reps, percentages, timeframes). If the PT asks something not covered by the research, say so clearly and offer your best clinical reasoning. Keep responses focused and well-structured. Use bullet points when listing multiple items."""

    messages = [{"role": "system", "content": system}]
    # Add conversation history (last 10 exchanges to stay within token budget)
    for h in history[-20:]:
        messages.append({"role": h['role'], "content": h['content']})
    messages.append({"role": "user", "content": message})

    response = call_groq_with_retry(client,
        model="llama-3.3-70b-versatile",
        messages=messages,
        max_tokens=1024,
        temperature=0.3,
    )

    reply = response.choices[0].message.content.strip()
    return jsonify({'reply': reply})


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
