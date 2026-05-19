def test_validate_stack_prepared_demo_rejects_failed_final_replay(tmp_path: Path):
    hdf5_path = tmp_path / "prepared.hdf5"
    with h5py.File(hdf5_path, "w") as handle:
        data_group = handle.create_group("data")
        _write_demo_group(data_group, "demo_0", grasp_signal=[0] * 8 + [1] * 32)

    with h5py.File(hdf5_path, "r") as handle:
        result = validate_stack_prepared_demo(
            demo_key="demo_0",
            demo_group=handle["data/demo_0"],
            task_config=STACK_TASK_CONFIG,
            replay_success_checker=lambda _: False,
        )

    assert result.accepted is False
    assert result.reason == "final_replay_not_success"
