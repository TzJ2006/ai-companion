import hashlib

function_code = '''    def _get_partial_task_metrics(self):
        """
        Check if all three pieces have been assembled together.
        """
        metrics = {
            "first_piece_assembled": self._check_first_piece_is_assembled(),
            "task": self._check_second_piece_is_assembled(),
        }

        return metrics'''

hash_object = hashlib.sha256(function_code.encode())
hash_hex = hash_object.hexdigest()
print(hash_hex[:16])
