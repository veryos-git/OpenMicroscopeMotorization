// Pinned, locally served Espressif flasher: no CDN is needed at flash time.
export async function f_flash_browser(o_port, o_firmware, f_log, f_load = () => import('./vendor/esptool-js-0.6.1.js')) {
    let { ESPLoader, Transport } = await f_load();
    let o_transport = new Transport(o_port, true);
    let o_loader = new ESPLoader({
        transport: o_transport,
        baudrate: 115200,
        terminal: { clean() {}, write: f_log, writeLine: f_log },
    });
    let o_failure;
    try {
        f_log('Connecting to bootloader. If it does not connect, hold BOOT and press RESET, then retry.');
        await o_loader.main();
        if (o_loader.chip.CHIP_NAME !== 'ESP32-S3' || o_firmware.s_chip !== 'ESP32-S3') {
            throw new Error('This firmware requires an ESP32-S3. No firmware was written.');
        }
        let a_o_image = o_firmware.a_o_image;
        let a_n_address = [0, 0x8000, 0xe000, 0x10000];
        if (!Array.isArray(a_o_image) || a_o_image.length !== 4) throw new Error('Incomplete firmware package');
        let a_o_file = a_o_image.map((o_image, n) => {
            if (o_image.n_address !== a_n_address[n] || !/^[a-f0-9]{32}$/.test(o_image.s_md5)) {
                throw new Error('Invalid firmware package');
            }
            let a_data = Uint8Array.from(atob(o_image.s_base64), s => s.charCodeAt(0));
            if (!a_data.length || a_data.length % 4 || (n < 3 && a_data.length + o_image.n_address > a_n_address[n + 1])) {
                throw new Error('Invalid firmware image size');
            }
            return { address: o_image.n_address, data: a_data };
        });
        let s_last_progress = '';
        await o_loader.writeFlash({
            fileArray: a_o_file,
            flashSize: 'keep', flashMode: 'keep', flashFreq: 'keep',
            eraseAll: false, compress: true,
            reportProgress(n_file, n_written, n_total) {
                let s_progress = `Image ${n_file + 1}/4: ${Math.floor(100 * n_written / n_total)}%`;
                if (s_progress !== s_last_progress) { f_log(s_progress); s_last_progress = s_progress; }
            },
        });
        for (let n = 0; n < a_o_file.length; n++) {
            let o_file = a_o_file[n];
            let s_hash = await o_loader.flashMd5sum(o_file.address, o_file.data.length);
            if (s_hash !== a_o_image[n].s_md5) throw new Error(`Verification failed for image ${n + 1}. Please flash again.`);
        }
        f_log('All firmware images verified. Restarting ESP32...');
        await o_loader.after('hard_reset');
    } catch (o_error) {
        o_failure = o_error;
        throw o_error;
    } finally {
        try { await o_transport.disconnect(); }
        catch (o_error) {
            // Preserve the useful bootloader/upload error if opening USB failed.
            if (!o_failure) throw o_error;
        }
    }
}
