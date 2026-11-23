/**
 * Host half of the `tianwen-star` package row. The row exists so the Web
 * client-module scan finds this package's `dsh.client` declaration and serves
 * `dsh-tianwen-star/client`; the coach itself mounts inside the 天问星 agent
 * preset through `dsh-tianwen-star/coach`.
 * @module dsh-tianwen-star
 */

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'tianwen-star'

/** Registers nothing on the Host. */
export function apply(): void {}
