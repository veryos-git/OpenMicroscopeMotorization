let s_root_dir = Deno.cwd();
// directory separator
let s_ds = '/';
// if windows is detected as platform, change to backslash
if (Deno.build.os === 'windows') {
    s_ds = '\\';
}
export {
    s_root_dir,
    s_ds
}