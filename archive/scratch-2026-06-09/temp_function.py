def save_defaults(self):
    """
    Uses the current MjSim state and model to save default parameter values.
    """
    self._defaults = {k: {} for k in self.camera_names}
    for camera_name in self.camera_names:
        self._defaults[camera_name]["pos"] = np.array(self.get_pos(camera_name))
        self._defaults[camera_name]["quat"] = np.array(self.get_quat(camera_name))
        self._defaults[camera_name]["fovy"] = self.get_fovy(camera_name)
