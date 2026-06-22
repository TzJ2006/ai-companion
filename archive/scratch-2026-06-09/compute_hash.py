import hashlib

function_code = '''def check_bimanual(robot_name):
    """
    Utility function that returns whether the inputted robot_name is a bimanual robot or not

    Args:
        robot_name (str): Name of the robot to check

    Returns:
        bool: True if the inputted robot is a bimanual robot
    """
    return robot_name.lower() in BIMANUAL_ROBOTS'''

hash_value = hashlib.sha256(function_code.encode()).hexdigest()[:16]
print(hash_value)
