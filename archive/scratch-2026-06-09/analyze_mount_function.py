import hashlib

# Compute hash of the function
function_code = '''    def _important_geoms(self):
        """
        Returns:
             dict: (Default is no important geoms; i.e.: empty dict)
        """
        return {}'''

hash_obj = hashlib.md5(function_code.encode())
function_hash = hash_obj.hexdigest()[:16]
print(f"Computed hash: {function_hash}")
