
# Vakya AI
 — Voice Controlled Code Editor

Vakya AI is a premium browser-based, AI voice-controlled code editor that lets developers code, navigate, refactor, and explain their codebase entirely through spoken commands. It utilizes a high-efficiency dual transcription model (combining browser-side Speech Recognition for immediate feedback with a server-side Whisper transcription engine for high-fidelity text generation), a custom Machine Learning intent classifier, and the Claude 3.5 Sonnet API to compile code instructions into structured edits.

![Stack](https://img.shields.io/badge/Python-3.14-blue.svg)
![Stack](https://img.shields.io/badge/FastAPI-Web_Server-green.svg)
![Stack](https://img.shields.io/badge/Whisper-faster--whisper-blueviolet.svg)
![Stack](https://img.shields.io/badge/Embeddings-SentenceTransformer-yellow.svg)
![Stack](https://img.shields.io/badge/LLM-Claude_3.5_Sonnet-orange.svg)
![Stack](https://img.shields.io/badge/Editor-Monaco_Editor-lightblue.svg)

---

## 🏗️ System Architecture

Vakya AI is designed with an asynchronous decoupled architecture:
1. **Frontend (Browser UI)**:
   - Built on Monaco Editor (the core engine behind VS Code) with custom themes.
   - Captures microphone audio using the **Web Audio API** (`AudioContext` + `ScriptProcessorNode`) and encodes it into raw 16-bit 16kHz Mono PCM WAV files on-the-fly.
   - Leverages browser-native `webkitSpeechRecognition` to present live interim text feedback while the user is actively speaking.
   - Dispatches audio files to the FastAPI server and applies structured edits dynamically.
2. **Backend (FastAPI Server)**:
   - **Whisper Inference**: Loads `faster-whisper` (`small.en` model) on startup with `int8` quantization for fast local CPU audio transcription.
   - **Intent Classifier**: Encodes incoming text using `sentence-transformers` (`all-MiniLM-L6-v2`) and matches the semantic structure against 6 pre-trained classes using a `LogisticRegression` classifier.
   - **Claude API Wrapper**: Takes the classified intent, the current editor code, and the voice command. It queries Claude with a system instructions framework to obtain structured modifications.
   - **Log Engine & Metrics**: Automatically saves all commands and classification history to a local `.jsonl` file to support analytics monitoring and retraining pipelines.

```
+------------------+                   +----------------------------------+
|   Vakya UI       |                   |       FastAPI Backend            |
| (Monaco Editor)  |                   |                                  |
|                  |   POST /command   |  +----------------------------+  |
|  [Audio Capture] | ----------------> |  | Whisper (faster-whisper)   |  |
|   (float32ToWav) |                   |  +----------------------------+  |
|                  |                   |               v (Text)           |
|  [Apply Edits]   |                   |  +----------------------------+  |
|   (executeEdits) | <---------------- |  | Classifier (LR + all-MiniLM)|  |
|                  |   Structured Diff |  +----------------------------+  |
|  [Undo/Explain/  |   {newCode, ...}  |               v (Intent + Code)  |
|   Navigate]      |                   |  +----------------------------+  |
+------------------+                   |  | Claude 3.5 Sonnet API      |  |
                                       |  +----------------------------+  |
                                       +----------------------------------+
```

---

## ⚡ Key Features

* 🎙️ **Dual-Engine Voice Interface**: Visual feedback updates as you speak; high-precision Whisper verifies the final command.
* 🧠 **Custom ML Classifier**: Local logistic classifier categorizes inputs into 6 intent classes: `EDIT`, `EXPLAIN`, `NAVIGATE`, `GENERATE`, `REFACTOR`, and `UNDO` with >99% local evaluation accuracy.
* 📝 **Structured Code Modification**: Instead of copy-pasting code, the editor updates only the specific lines changed using Monaco's range diff layout.
* 🌐 **Language Models Dropdown**: Switch dynamically between **Python**, **JavaScript**, **Go**, and **Rust** configurations.
* 📂 **Direct File Loader**: Import local files directly into the editor interface.
* ⌨️ **Keyboard Shortcut**: Press `Space` outside text areas to instantly start/stop voice recording.
* 📊 **MLOps Monitoring**: Dashboard analytics endpoint `/metrics` tracks command frequency and model classification confidence.

---

## 🚀 Setup & Execution

### 1. Backend Setup (Python)

1. Navigate to the `backend/` directory:
   ```bash
   cd backend
   ```
2. Copy `.env.example` to `.env` and fill in your Anthropic API Key:
   ```bash
   copy .env.example .env
   ```
   Modify `.env` to set:
   ```
   ANTHROPIC_API_KEY=your-actual-api-key
   ```
3. Activate the virtual environment:
   ```bash
   # On Windows:
   .\venv\Scripts\activate
   ```
4. Run the FastAPI development server:
   ```bash
   uvicorn main:app --reload
   ```
   The backend will start on [http://localhost:8000](http://localhost:8000). The first run will automatically initialize the Whisper model, which can take 1–2 minutes to download.

### 2. Frontend Execution (Browser)

1. Navigate to the `frontend/` directory and start a local web server:
   ```bash
   cd frontend
   python -m http.server 5500
   ```
2. Open [http://localhost:5500](http://localhost:5500) in **Google Chrome**. (Chrome is required for Web Audio + Speech Recognition continuous features).
3. Allow Microphone access when prompted.
4. Select the programming language from the dropdown menu in the top bar.
5. Press **Space** or click the mic button and speak a command!

---

## 🧪 Model Details & Training

The intent classifier is trained locally using text embeddings from a 384-dimensional sentence transformer (`all-MiniLM-L6-v2`) and a multiclass Logistic Regression model.

### Intention Dataset (144 items)
* **EDIT**: "change line 5 to return true", "add error handling on line 12"
* **EXPLAIN**: "explain this function", "what does the write_file function do"
* **NAVIGATE**: "go to line 22", "scroll down to the bottom"
* **GENERATE**: "write a quick sort implementation", "create helper to validate emails"
* **REFACTOR**: "make this code cleaner", "optimize this sorting algorithm"
* **UNDO**: "undo the last change", "cancel my modification"

### Model Performance (F1-score: 1.00)
To retrain the model after adding new items to `backend/data/intents.json`:
* Run the retraining batch file on Windows:
  ```bash
  .\retrain.bat
  ```
  Or run manually:
  ```bash
  python train.py
  ```

---

## 📊 Analytics and Metrics Monitoring

You can inspect the live dashboard metrics at [http://localhost:8000/metrics](http://localhost:8000/metrics).
Returns JSON data detailing:
* Total commands processed.
* Percent success rate.
* Distribution frequency across intent categories.
* Average model classification confidence.

---

## 🌐 Hugging Face Spaces Deployment

Vakya AI is configured for deployment on Hugging Face Spaces using Docker:
- Hugging Face Spaces metadata is defined at the top of this `README.md`.
- The `Dockerfile` in the root directory manages the build environment (installing `ffmpeg`, setting up a non-root user, installing requirements, and exposing port `7860`).
- The production frontend uses the production config in `frontend/config.js` pointing to the deployed space backend.

