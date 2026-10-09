// Authored for fartola. Not ported from upstream.
//
// Drawer breakpoint shared by AppShell (JS + CSS) and TopBar (CSS). CSS
// media queries cannot read custom properties: keep the literal 1024px in
// AppShell.svelte and TopBar.svelte in step with this constant.
export const DRAWER_MAX_PX = 1024;
export const DRAWER_QUERY = `(max-width: ${DRAWER_MAX_PX}px)`;
