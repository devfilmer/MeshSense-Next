<script lang="ts">
  import { connectionStatus, address, enableTLS, lastFromRadio, lockdownStatus, nodes, myNodeNum, showNodeNameInAddress, bluetoothInfo, currentTime, radioName, radioNameAddress, configProgress, pairingStatus } from 'api/src/vars'
  import Card from './lib/Card.svelte'
  import { smallMode } from './Nodes.svelte'
  import { hasAccess, connectionStatusMessage, bluetoothDetails, configProgressLines } from './lib/util'
  import axios from 'axios'
  import { onMount } from 'svelte'

  /** Ticks every second so pairing and connecting show elapsed time */
  let now = Date.now()
  onMount(() => {
    const timer = setInterval(() => (now = Date.now()), 1000)
    return () => clearInterval(timer)
  })

  let connectionIcons = {
    connected: '🟢',
    connecting: '🟡',
    configuring: '🟡',
    searching: '🟡',
    reconnecting: '🟡',
    disconnected: '🔴'
  }

  function connect() {
    axios.post('/connect', { address: $address })
  }

  function disconnect() {
    axios.post('/disconnect')
  }

  let pin = ''
  /** When the PIN was last edited; a pairing result older than that is hidden so it is not mistaken for the new attempt */
  let pinEditedAt = 0

  /** The radio dropped the link because this computer is not paired with it */
  $: needsPairing = !!$bluetoothInfo?.needsPairing && $bluetoothInfo.needsPairing == $address
  $: pairingName = ($radioNameAddress == $address && $radioName) || $address
  $: pairingResult = $pairingStatus?.address == $address && $pairingStatus.at > pinEditedAt ? $pairingStatus : undefined
  $: pairingSeconds = $pairingStatus?.at ? Math.max(0, Math.round((now - $pairingStatus.at) / 1000)) : 0
  /** Just paired and not connected yet: say so, since the pairing box is gone and connecting can take a while */
  $: justPaired = $pairingStatus?.state == 'paired' && $pairingStatus.address == $address && $connectionStatus != 'connected' && now - $pairingStatus.at < 120000

  function pair() {
    axios.post('/pair', { address: $address, pin }).catch(() => {})
    // The PIN is not kept in the page once it has been sent
    pin = ''
  }

  let spinnerAngle = 0

  $: if ($lastFromRadio && $connectionStatus == 'configuring') spinnerAngle = (spinnerAngle + 8) % 360

  /** Lockdown states in which the device withholds data until it is unlocked */
  /** Short name of the connected device, shown with its address once it is connected */
  $: deviceName = $nodes.find((n) => n.num == $myNodeNum)?.user?.shortName || ''
  $: addressLabel = $showNodeNameInAddress && deviceName && $connectionStatus != 'disconnected' ? `${deviceName} (${$address})` : $address

  $: busyMessage = connectionStatusMessage($connectionStatus, $address, $radioNameAddress == $address ? $radioName : '', $configProgress)

  $: lockdownNotice = ['NEEDS_PROVISION', 'LOCKED', 'UNLOCK_FAILED'].includes($lockdownStatus?.stateName) ? $lockdownStatus : undefined
</script>

<Card title="Address" {...$$restProps}>
  <h2 slot="title" class="rounded-t flex items-center h-full gap-2">
    <div class="grow">Address</div>
    {#if $connectionStatus}
      <div class="h-full text-right w-full text-yellow-300 font-normal text-sm mt-1 capitalize">{$connectionStatus}</div>
      {#if $connectionStatus == 'configuring'}
        <div style="transform: rotate({spinnerAngle}deg);">⌛</div>
      {/if}
    {/if}
  </h2>
  <form on:submit|preventDefault={connect} class="grid {$smallMode ? 'grid-cols-1' : 'grid-cols-[1fr_auto]'} p-2 gap-1 items-center text-sm">
    <!-- Icon and Input -->
    <div class="flex gap-2 items-center">
      {#if busyMessage}
        <div class="animate-spin rounded-full h-4 w-4 border-2 border-yellow-300 border-t-transparent" role="status" aria-label="Connecting"></div>
      {:else}
        {connectionIcons[$connectionStatus]}
      {/if}
      {#if $connectionStatus == 'disconnected'}
        <input size="3" class="input w-full" type="text" bind:value={$address} placeholder="Device IP" />
      {:else}
        <div class="input w-full truncate" title={addressLabel}>{addressLabel}</div>
      {/if}
    </div>
    <!-- Cancel Button -->
    {#if $hasAccess}
      {#if $connectionStatus == 'disconnected'}
        <label class="select-none btn cursor-pointer text-center text-sm">
          TLS
          <input type="checkbox" bind:checked={$enableTLS} />
        </label>
        <button class="btn w-full h-full col-span-full saturate-150" disabled={$pairingStatus?.state == 'pairing'}>Connect</button>
      {:else if $connectionStatus == 'connected'}
        <button type="button" class="btn w-full h-full {$smallMode ? 'col-span-full' : ''}" on:click={disconnect}>Disconnect</button>
      {:else if ['searching', 'connecting', 'configuring', 'reconnecting'].includes($connectionStatus)}
        <button type="button" class="btn w-full h-full" on:click={disconnect}>Cancel</button>
      {/if}
    {/if}
  </form>
  {#if busyMessage}
    <div class="flex items-center gap-2 text-xs text-yellow-200 px-2 pb-2">
      <div class="animate-spin rounded-full h-3 w-3 border-2 border-yellow-200 border-t-transparent" role="status" aria-label="Working"></div>
      {busyMessage}
    </div>
    <div class="text-xs text-white/60 px-2 pb-2 grid gap-0.5">
      {#each [...bluetoothDetails($bluetoothInfo, $address, $currentTime), ...configProgressLines($configProgress)] as line}
        <div>{line}</div>
      {/each}
    </div>
  {/if}
  {#if justPaired}
    <div class="w-0 min-w-full">
      <div class="text-xs bg-green-800/40 text-green-100 rounded m-2 mt-0 p-2 flex items-center gap-2 break-words">
        <div class="shrink-0 animate-spin rounded-full h-3 w-3 border-2 border-green-100 border-t-transparent" role="status" aria-label="Connecting"></div>
        <div>Paired with {pairingName}. Now connecting: the radio is found by a Bluetooth scan first, then its nodes are read. This usually takes under a minute ({pairingSeconds} s so far).</div>
      </div>
    </div>
  {/if}
  {#if needsPairing && $hasAccess}
    <!-- Zero width plus full minimum width: the box fills the card but its long text never widens the column -->
    <div class="w-0 min-w-full">
      <form on:submit|preventDefault={pair} class="text-xs bg-amber-700/40 text-amber-100 rounded m-2 mt-0 p-2 grid gap-1.5 break-words">
        <div class="font-bold">{pairingName} needs to be paired</div>
        <div>The radio closed the connection because this computer is not paired with it. Enter the radio's Bluetooth PIN and press Pair. A radio with a screen shows its PIN there; if the PIN was never changed, it is 123456. Pairing can take up to 30 seconds.</div>
        <div class="flex gap-1">
          <input class="input w-full" type="text" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="PIN" bind:value={pin} on:input={() => (pinEditedAt = Date.now())} />
          <button class="btn" disabled={$pairingStatus.state == 'pairing' || !pin}>Pair</button>
        </div>
        {#if $pairingStatus.state == 'pairing' && $pairingStatus.address == $address}
          <div class="flex items-center gap-2">
            <div class="animate-spin rounded-full h-3 w-3 border-2 border-amber-100 border-t-transparent" role="status" aria-label="Pairing"></div>
            {$pairingStatus.message} ({pairingSeconds} s)
          </div>
        {:else if pairingResult?.state == 'failed'}
          <div class="text-red-200">{pairingResult.message} (attempt at {new Date(pairingResult.at).toLocaleTimeString()})</div>
        {/if}
      </form>
    </div>
  {/if}
  {#if lockdownNotice}
    <div class="text-xs bg-amber-700/40 text-amber-100 rounded m-2 mt-0 p-1.5">
      Device lockdown: <span class="font-bold">{lockdownNotice.stateName.replace('_', ' ').toLowerCase()}</span>
      {#if lockdownNotice.lockReason}({lockdownNotice.lockReason}){/if}
      <div>Unlock or provision the device with an official Meshtastic app to receive data.</div>
    </div>
  {/if}
</Card>
