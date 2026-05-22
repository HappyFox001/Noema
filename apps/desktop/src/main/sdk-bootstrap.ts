/**
 * Bootstraps the desktop SDK instance from settings and runtime plugins.
 */
import { HerTextSDK } from '@her-text/sdk'
import type { AppSettings, LLMModelConfig } from './settings-store.js'
import { loadRuntimePlugins } from './plugin-loader.js'
import {
  buildSDKConfig,
  setActiveLLMConfig,
  setActiveTaskLLMConfig,
  setActiveTaskRuntimeConfig,
} from './sdk-config.js'

export interface DesktopSDKBootstrapOptions {
  appSettings: AppSettings
  activeLLMConfig: LLMModelConfig | null
  activeTaskConfig: LLMModelConfig | null
  pluginsDir: string
  onRuntimeEvent: (event: any) => void
  onTaskUserInputRequest: (request: any) => Promise<any>
}

export interface DesktopSDKBootstrapResult {
  sdk: HerTextSDK
  pluginsDir: string
}

export async function initializeDesktopSDK(
  options: DesktopSDKBootstrapOptions
): Promise<DesktopSDKBootstrapResult> {
  setActiveLLMConfig(options.activeLLMConfig)
  setActiveTaskLLMConfig(options.activeTaskConfig)
  setActiveTaskRuntimeConfig(options.appSettings.system.taskRuntime)

  const sdkConfig = await buildSDKConfig()
  console.log('[PluginLoader] Runtime plugins directory:', options.pluginsDir)
  const plugins = await loadRuntimePlugins(
    options.pluginsDir,
    options.appSettings.plugins,
    options.appSettings.pluginConfigs
  )
  const sdk = await HerTextSDK.initialize(sdkConfig, {
    plugins,
    selfLearningEnabled: options.appSettings.experimental?.selfLearningEnabled !== false,
    onRuntimeEvent: options.onRuntimeEvent,
    onTaskUserInputRequest: options.onTaskUserInputRequest,
  })

  return {
    sdk,
    pluginsDir: options.pluginsDir,
  }
}
