import os, sys, json
sys.stdout.reconfigure(encoding="utf-8")
from dotenv import load_dotenv
load_dotenv(".env", override=True)
from google import genai as genai_sdk
from google.genai import types as genai_types

key = os.getenv("GEMINI_API_KEY")
print(f"API Key loaded: {key[:10]}..." if key else "NO API KEY")

client = genai_sdk.Client(api_key=key)

system_prompt = (
    "You are a code assistant. Return ONLY a raw JSON object with keys: "
    "startLine (int), endLine (int), newCode (string), explanation (string). "
    "No markdown, no extra text outside the JSON."
)

user_prompt = (
    'User Command: "add a comment at the top explaining what the function does"\n'
    "Language: python\n"
    "Code:\n"
    "```\n"
    "def hello():\n"
    '    print("hello")\n'
    "```"
)

config = genai_types.GenerateContentConfig(
    system_instruction=system_prompt,
    response_mime_type="application/json"
)

print("Calling gemini-2.5-flash-lite ...")
resp = client.models.generate_content(
    model="gemini-2.5-flash-lite",
    contents=user_prompt,
    config=config
)

raw = resp.text.strip()
print("Raw response:", raw[:400])

result = json.loads(raw)
print("\nParsed JSON OK:")
print(json.dumps(result, indent=2))
