#!/usr/bin/env python3
"""
E5 Embeddings Server for OpenClaw Memory Plugin
Provides local embeddings using multilingual-e5-large model (1024 dimensions)

Usage:
    python3 e5-server.py
    
Environment:
    HF_TOKEN - optional, Hugging Face token for faster downloads
"""

from flask import Flask, request, jsonify
from sentence_transformers import SentenceTransformer
import os

app = Flask(__name__)

print("Loading E5-large model (this may take a minute on first run)...")
model = SentenceTransformer('intfloat/multilingual-e5-large')
print(f"Model loaded. Embedding dimension: {model.get_sentence_embedding_dimension()}")

@app.route('/embed', methods=['POST'])
def embed():
    """Generate embedding for text"""
    data = request.get_json()
    if not data or 'text' not in data:
        return jsonify({'error': 'Missing text field'}), 400
    
    text = data['text']
    
    # E5 requires prefix for optimal performance
    # "query: " for queries, "passage: " for documents
    prefix = data.get('type', 'passage')
    if not text.startswith('query:') and not text.startswith('passage:'):
        text = f"{prefix}: {text}"
    
    embedding = model.encode(text, normalize_embeddings=True)
    
    return jsonify({'embedding': embedding.tolist()})

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'ok',
        'model': 'intfloat/multilingual-e5-large',
        'dimension': model.get_sentence_embedding_dimension()
    })

@app.route('/batch', methods=['POST'])
def batch_embed():
    """Generate embeddings for multiple texts"""
    data = request.get_json()
    if not data or 'texts' not in data:
        return jsonify({'error': 'Missing texts field'}), 400
    
    texts = data['texts']
    prefix = data.get('type', 'passage')
    
    prefixed_texts = []
    for text in texts:
        if not text.startswith('query:') and not text.startswith('passage:'):
            prefixed_texts.append(f"{prefix}: {text}")
        else:
            prefixed_texts.append(text)
    
    embeddings = model.encode(prefixed_texts, normalize_embeddings=True)
    
    return jsonify({'embeddings': embeddings.tolist()})

if __name__ == '__main__':
    host = os.environ.get('E5_HOST', '127.0.0.1')
    port = int(os.environ.get('E5_PORT', 8765))
    
    print(f"\n🚀 E5 Embedding Server")
    print(f"   Model: multilingual-e5-large")
    print(f"   Dimension: 1024")
    print(f"   Listening: http://{host}:{port}")
    print(f"\nEndpoints:")
    print(f"   POST /embed  - Single text embedding")
    print(f"   POST /batch  - Batch embeddings")
    print(f"   GET  /health - Health check")
    print()
    
    app.run(host=host, port=port)
