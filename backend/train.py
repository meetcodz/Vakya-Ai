import os
import json
import joblib
from sentence_transformers import SentenceTransformer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report

def train_model():
    print("Loading intents dataset...")
    intents_path = os.path.join("data", "intents.json")
    if not os.path.exists(intents_path):
        raise FileNotFoundError(f"Intents file not found at {intents_path}")
        
    with open(intents_path, "r") as f:
        data = json.load(f)
        
    texts = []
    labels = []
    for intent, examples in data.items():
        for ex in examples:
            texts.append(ex)
            labels.append(intent)
            
    print(f"Loaded {len(texts)} training examples across {len(data.keys())} classes.")
    
    print("Loading SentenceTransformer model ('all-MiniLM-L6-v2')...")
    # This will download the model to cache on first run (around 80MB)
    encoder = SentenceTransformer("all-MiniLM-L6-v2")
    
    print("Encoding text examples to embeddings...")
    X = encoder.encode(texts, show_progress_bar=True)
    y = labels
    
    # Train test split for evaluation
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    
    print("Training LogisticRegression classifier...")
    # C=10.0 works well for SentenceTransformer embeddings
    clf = LogisticRegression(C=10.0, max_iter=1000, random_state=42)
    clf.fit(X_train, y_train)
    
    print("\n--- Evaluation Report ---")
    y_pred = clf.predict(X_test)
    print(classification_report(y_test, y_pred))
    
    # Retrain on full dataset for maximum accuracy in production
    print("Retraining classifier on full dataset...")
    full_clf = LogisticRegression(C=10.0, max_iter=1000, random_state=42)
    full_clf.fit(X, y)
    
    # Ensure models directory exists
    os.makedirs("models", exist_ok=True)
    
    model_path = os.path.join("models", "intent_classifier.joblib")
    print(f"Saving classifier to {model_path}...")
    joblib.dump(full_clf, model_path)
    print("Training complete!")

if __name__ == "__main__":
    train_model()
