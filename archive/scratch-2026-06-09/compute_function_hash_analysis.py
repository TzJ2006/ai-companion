import hashlib

# Function to analyze
function_code = '''def get_light_xpos(self, name):
    """
    Get cartesian position of a light source

    Args:
        name (str): The name of a lighting source
    Returns:
        light_xpos (np.ndarray): The cartesian position of the light source
    """
    lid = self.model.light_name2id(name)
    return self.light_xpos[lid]'''

# Compute hash
hash_object = hashlib.sha256(function_code.encode())
hash_hex = hash_object.hexdigest()
print(hash_hex[:16])
