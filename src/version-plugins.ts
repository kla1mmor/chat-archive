/**
 * Native plugins this web bundle calls. A shell that lacks any of them can't
 * take the bundle over the air and has to be reinstalled. Keep in sync with
 * the Capacitor plugins in package.json.
 */
export const REQUIRED_PLUGINS = ['Filesystem', 'Share', 'CapacitorUpdater'];
