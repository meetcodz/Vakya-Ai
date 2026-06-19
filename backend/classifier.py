import os
import joblib
import numpy as np
from sentence_transformers import SentenceTransformer

# Load models globally at startup
ENCODER_MODEL_NAME = "all-MiniLM-L6-v2"
MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "intent_classifier.joblib")

print(f"Loading SentenceTransformer: {ENCODER_MODEL_NAME}...")
encoder = SentenceTransformer(ENCODER_MODEL_NAME)

classifier = None
if os.path.exists(MODEL_PATH):
    print(f"Loading Classifier: {MODEL_PATH}...")
    classifier = joblib.load(MODEL_PATH)
else:
    print(f"WARNING: Classifier model file not found at {MODEL_PATH}. Run train.py first.")

def get_intent_classifier():
    global classifier
    if classifier is None:
        if os.path.exists(MODEL_PATH):
            classifier = joblib.load(MODEL_PATH)
        else:
            raise FileNotFoundError(f"Classifier model file not found at {MODEL_PATH}. Run train.py first.")
    return classifier

def classify_intent(text: str):
    """
    Classify command text into one of the 6 intents:
    EDIT, EXPLAIN, NAVIGATE, GENERATE, REFACTOR, UNDO
    """
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
    
    # Fallback threshold (e.g. 0.6)
    fallback = confidence < 0.6
    
    return {
        "intent": best_intent,
        "confidence": confidence,
        "fallback": fallback,
        "probabilities": prob_map
    }
