import requests
import json

url = "http://127.0.0.1:8000/command"

# Test 1: Send modified code, not the original template
modified_code = """def square(x):
    # This is a modified function
    return x * x
"""

payload = {
    "command": "add a docstring to the square function",
    "code": modified_code,
    "language": "python"
}

print("Sending request to /command...")
try:
    response = requests.post(url, data=payload)
    print("Status code:", response.status_code)
    if response.status_code == 200:
        res_json = response.json()
        print("Response JSON:")
        print(json.dumps(res_json, indent=2))
    else:
        print("Response Text:", response.text)
except Exception as e:
    print("Error connecting to server:", e)
