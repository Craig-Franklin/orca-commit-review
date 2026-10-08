// Read-only integration probe. Run with Orca's packaged Electron in Node mode.
// Never opens tabs or sends terminal input; existing sessions are discovery only.
import { createCli } from '../cli.mjs'
import { createComments } from '../comments.mjs'
import { repository } from '../git.mjs'
const cli = createCli()
const repo = await repository(process.argv[2] || process.cwd())
const status = await cli(['status'])
if (!status.runtime?.reachable) throw Error('Local Orca runtime is unavailable.')
if (!status.runtime.capabilities?.includes('terminal.prompt-delivery.v1'))
  throw Error('Local Orca runtime lacks durable terminal prompt delivery.')
const { repos } = await cli(['repo', 'list'])
const targets = await createComments({ cli }).targets(repo)
console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  platform: process.platform,
  orcaVersion: status.runtime.appVersion,
  packagedNodeVersion: process.version,
  checkout: repo,
  checks: {
    bundledCliDiscovery: 'passed',
    localRuntimeReachable: 'passed',
    durablePromptCapability: 'advertised',
    repositoryListShape: Array.isArray(repos) ? 'passed' : 'failed',
    exactCheckoutTargetEnumeration: 'passed'
  },
  connectedAgentCount: targets.targets.length,
  terminalInputSent: false,
  desktopOrBrowserControlled: false,
  liveDeliveryVerified: false
}, null, 2))
