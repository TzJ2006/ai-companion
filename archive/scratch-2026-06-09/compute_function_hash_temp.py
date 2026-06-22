import hashlib

function_code = """def _get_placement_initializer(self):
    bounds = self._get_initial_placement_bounds()

    self.placement_initializer = SequentialCompositeSampler(name="ObjectSampler")
    self.placement_initializer.append_sampler(
        sampler=UniformRandomSampler(
            name="BaseSampler",
            mujoco_objects=self.base,
            x_range=bounds["base"]["x"],
            y_range=bounds["base"]["y"],
            rotation=bounds["base"]["z_rot"],
            rotation_axis='z',
            ensure_object_boundary_in_range=False,
            ensure_valid_placement=True,
            reference_pos=bounds["base"]["reference"],
            z_offset=0.001,
        )
    )
    self.placement_initializer.append_sampler(
        sampler=UniformRandomSampler(
            name="Piece1Sampler",
            mujoco_objects=self.piece_1,
            x_range=bounds["piece_1"]["x"],
            y_range=bounds["piece_1"]["y"],
            rotation=bounds["piece_1"]["z_rot"],
            rotation_axis='z',
            ensure_object_boundary_in_range=False,
            ensure_valid_placement=True,
            reference_pos=bounds["piece_1"]["reference"],
            z_offset=0.001,
        )
    )
    self.placement_initializer.append_sampler(
        sampler=UniformRandomSampler(
            name="Piece2Sampler",
            mujoco_objects=self.piece_2,
            x_range=bounds["piece_2"]["x"],
            y_range=bounds["piece_2"]["y"],
            rotation=bounds["piece_2"]["z_rot"],
            rotation_axis='z',
            ensure_object_boundary_in_range=False,
            ensure_valid_placement=True,
            reference_pos=bounds["piece_2"]["reference"],
            z_offset=0.001,
        )
    )"""

hash_obj = hashlib.sha256(function_code.encode())
hash_hex = hash_obj.hexdigest()[:16]
print(hash_hex)
