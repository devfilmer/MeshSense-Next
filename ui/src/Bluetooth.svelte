<script lang="ts">
  import { State } from 'api/src/lib/state'
  import Card from './lib/Card.svelte'
  import { address, connectionStatus } from 'api/src/vars'
  import { smallMode } from './Nodes.svelte'
  import axios from 'axios'
  import { hasAccess } from './lib/util'

  import { onMount } from 'svelte'

  let bluetoothDeviceList = new State<{ id: string; name: string; rssi?: number; seenAt?: number }[]>('bluetoothDeviceList', [])

  let now = Date.now()
  onMount(() => {
    const timer = setInterval(() => (now = Date.now()), 5000)
    return () => clearInterval(timer)
  })

  /** A device not heard for this long is shown as last seen, not as present */
  const staleAfterMs = 60000
  const isStale = (seenAt: number | undefined) => !seenAt || now - seenAt > staleAfterMs

  /** Devices heard recently first, strongest signal first, so the nearby radio is at the top */
  $: devicesByStrength = $bluetoothDeviceList
    .slice()
    .sort((a, b) => Number(isStale(a.seenAt)) - Number(isStale(b.seenAt)) || (b.rssi ?? -999) - (a.rssi ?? -999))

  /** The device just clicked, marked until the connection starts so the click never looks ignored */
  let startingId = ''
  let startingAt = 0
  $: if (startingId && !startingAt) startingAt = now
  $: if (startingId && ($connectionStatus != 'disconnected' || now - startingAt > 15000)) (startingId = ''), (startingAt = 0)

  function seenText(rssi: number | undefined, seenAt: number | undefined) {
    if (isStale(seenAt)) return seenAt ? `seen ${Math.round((now - seenAt) / 60000) || 1} min ago` : 'not seen recently'
    return rssi != undefined ? `${rssi} dBm` : ''
  }
</script>

{#if $connectionStatus == 'disconnected' && $hasAccess}
  <Card title="BLE Devices" {...$$restProps}>
    <div class="text-sm p-2 flex flex-col gap-1">
      {#if $bluetoothDeviceList.length == 0}
        <p>
          No bluetooth {#if $smallMode}<br />{/if}devices detected
        </p>
      {/if}
      {#each devicesByStrength as { id, name, rssi, seenAt } (id)}
        <button
          class="btn"
          class:opacity-50={isStale(seenAt)}
          title="Connect to {name} ({id})"
          class:hidden={name.startsWith('Unknown or Unsupported Device')}
          disabled={!!startingId}
          on:click={() => {
            $address = id
            startingId = id
            axios.post('/connect', { address: id })
          }}
        >
          <span class="flex justify-between gap-2 w-full"
            ><span>{name}</span><span class="text-white/60 text-xs">{startingId == id ? 'Starting…' : seenText(rssi, seenAt)}</span></span
          >
        </button>
      {/each}
    </div>
  </Card>
{/if}
