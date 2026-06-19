import os
import joblib
import numpy as np

ENCODER_MODEL_NAME = "all-MiniLM-L6-v2"
MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "intent_classifier.joblib")

# ── Lazy-loaded globals (loaded on first request, not at import time) ──────────
_encoder = None
_classifier = None


def _get_encoder():
    global _encoder
    if _encoder is None:
        from sentence_transformers import SentenceTransformer
        print(f"Loading SentenceTransformer: {ENCODER_MODEL_NAME}...")
        _encoder = SentenceTransformer(ENCODER_MODEL_NAME)
        print("SentenceTransformer loaded.")
    return _encoder


def get_intent_classifier():
    global _classifier
    if _classifier is None:
        if os.path.exists(MODEL_PATH):
            print(f"Loading Classifier: {MODEL_PATH}...")
            _classifier = joblib.load(MODEL_PATH)
            print("Classifier loaded.")
        else:
            raise FileNotFoundError(
                f"Classifier model file not found at {MODEL_PATH}. Run train.py first."
            )
    return _classifier


def classify_intent(text: str):
    """
    Classify command text into one of the 6 intents:
    EDIT, EXPLAIN, NAVIGATE, GENERATE, REFACTOR, UNDO
    """
    encoder = _get_encoder()
    clf = get_intent_classifier()

    # 1. Encode text
    embedding = encoder.encode([text])[0]

    # 2. Predict probabilities
    probs = clf.predict_proba([embedding])[0]
    classes = clf.classes_

    # Find best class
    max_idx = np.argmax(probs)
    best_intent = classes[max_idx]
    confidence = float(probs[max_idx])

    # Probabilities map
    prob_map = {classes[i]: float(probs[i]) for i in range(len(classes))}

    # Fallback threshold
    fallback = confidence < 0.6

    return {
        "intent": best_intent,
        "confidence": confidence,
        "fallback": fallback,
        "probabilities": prob_map
    }
