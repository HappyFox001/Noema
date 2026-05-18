/**
 * Live2D avatar runtime plugin.
 *
 * Declares the main-view UI surface and exposes admin state for quick setup
 * checks. The avatar itself runs inside the isolated plugin iframe.
 */
export default function plugin(ctx) {
  return {
    id: 'live2d-avatar',
    name: 'Live2D Avatar',
    getAdminState() {
      const config = ctx.config || {}
      return {
        modelConfigured: Boolean(String(config.modelUrl || '').trim()),
        modelUrl: String(config.modelUrl || ''),
        surface: 'main-view',
        lipSync: 'orb.outputEnergy -> ParamMouthOpenY',
      }
    },
  }
}
