import hashlib

function_code = '''def planner():
    with patch("src.agent.planner.get_settings") as mock_settings:
        mock_settings.return_value.ai_providers = ["glm"]
        p = Planner()
    return p'''

# Compute hash
hash_value = hashlib.md5(function_code.encode()).hexdigest()[:16]
print(f"Hash: {hash_value}")
print(f"Full MD5: {hashlib.md5(function_code.encode()).hexdigest()}")
