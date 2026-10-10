<script lang="ts">
  import { connectionStatus, address, enableTLS, lastFromRadio, lockdownStatus } from 'api/src/vars'
  import Card from './lib/Card.svelte'
  import { smallMode } from './Nodes.svelte'
  import { hasAccess } from './lib/util'
  import axios from 'axios'

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

  let spinnerAngle = 0

  $: if ($lastFromRadio && $connectionStatus == 'configuring') spinnerAngle = (spinnerAngle + 8) % 360

  /** Lockdown states in which the device withholds data until it is unlocked */
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
      {connectionIcons[$connectionStatus]}
      <input disabled={$connectionStatus != 'disconnected'} size="3" class="input w-full" type="text" bind:value={$address} placeholder="Device IP" />
    </div>
    <!-- Cancel Button -->
    {#if $hasAccess}
      {#if $connectionStatus == 'disconnected'}
        <label class="select-none btn cursor-pointer text-center text-sm">
          TLS
          <input type="checkbox" bind:checked={$enableTLS} />
        </label>
        <button class="btn w-full h-full col-span-full saturate-150">Connect</button>
      {:else if $connectionStatus == 'connected'}
        <button type="button" class="btn w-full h-full {$smallMode ? 'col-span-full' : ''}" on:click={disconnect}>Disconnect</button>
      {:else if ['searching', 'connecting', 'configuring', 'reconnecting'].includes($connectionStatus)}
        <button type="button" class="btn w-full h-full" on:click={disconnect}>Cancel</button>
      {/if}
    {/if}
  </form>
  {#if lockdownNotice}
    <div class="text-xs bg-amber-700/40 text-amber-100 rounded m-2 mt-0 p-1.5">
      Device lockdown: <span class="font-bold">{lockdownNotice.stateName.replace('_', ' ').toLowerCase()}</span>
      {#if lockdownNotice.lockReason}({lockdownNotice.lockReason}){/if}
      <div>Unlock or provision the device with an official Meshtastic app to receive data.</div>
    </div>
  {/if}
</Card>
