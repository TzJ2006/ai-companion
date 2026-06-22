import hashlib

function_code = '''def set_ambient(self, name, value):
        """
        Sets ambient attribute of a specific light source

        Args:
            name (str): Name of the lighting source
            value (np.array): (r,g,b) ambient color to set lighting source to

        Raises:
            AssertionError: Invalid light name
            AssertionError: Invalid @value
        """
        lightid = self.get_lightid(name)
        assert lightid > -1, "Unkwnown light %s" % name

        value = list(value)
        assert len(value) == 3, "Expected 3-dim value, got %s" % value

        self.model.light_ambient[lightid] = value'''

# Compute hash
hash_obj = hashlib.md5(function_code.encode())
hash_value = hash_obj.hexdigest()
print(hash_value)
