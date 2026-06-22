import hashlib

function_code = '''    def _get_initial_placement_bounds(self):
        """
        Internal function to get bounds for randomization of initial placements of objects (e.g.
        what happens when env.reset is called). Should return a dictionary with the following
        structure:
            object_name
                x: 2-tuple for low and high values for uniform sampling of x-position
                y: 2-tuple for low and high values for uniform sampling of y-position
                z_rot: 2-tuple for low and high values for uniform sampling of z-rotation
                reference: np array of shape (3,) for reference position in world frame (assumed to be static and not change)
        """
        return dict(
            nut=dict(
                x=(-0.115, -0.11),
                y=(0.11, 0.225),
                z_rot=(0., 2. * np.pi),
                # NOTE: hardcoded @self.table_offset since this might be called in init function
                reference=np.array((0, 0, 0.82)),
            ),
        )'''

hash_result = hashlib.md5(function_code.encode()).hexdigest()
print(f"MD5 Hash: {hash_result}")
print(f"First 16 chars: {hash_result[:16]}")
