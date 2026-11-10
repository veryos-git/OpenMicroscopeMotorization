# Motion and Optics hub panels

Removed from the app on 2026-11-09 during the cockpit UI pass.

Both windows only held buttons that opened other windows (Auto move, Macro,
Stats / Focus, Stack, Camera, Filter, Flat field, Scale). The Tools window in
the top bar already lists every one of those windows, so the hubs were a second
way to reach the same place. Their styles (`.panel-motion`, `.panel-optics`,
`.hub-grid`, `.hub-item`) were removed from `webserved_dir/index.css`.
