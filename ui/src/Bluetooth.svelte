<script lang="ts">
  import { State } from 'api/src/lib/state'
  import Card from './lib/Card.svelte'
  import { address, connectionStatus } from 'api/src/vars'
  import { smallMode } from './Nodes.svelte'
  import axios from 'axios'
  import { hasAccess } from './lib/util'

  let bluetoothDeviceList = new State<{ id: string; name: string; rssi?: number }[]>('bluetoothDeviceList', [])

  /** Strongest signal first, so the nearby radio is at the top */
  $: devicesByStrength = $bluetoothDeviceList.slice().sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999))
</script>

{#if $connectionStatus == 'disconnected' && $hasAccess}
  <Card title="BLE Devices" {...$$restProps}>
    <div class="text-sm p-2 flex flex-col gap-1">
      {#if $bluetoothDeviceList.length == 0}
        <p>
          No bluetooth {#if $smallMode}<br />{/if}devices detected
        </p>
      {/if}
      {#each devicesByStrength as { id, name, rssi }}
        <button
          class="btn"
          class:hidden={name.startsWith('Unknown or Unsupported Device')}
          on:click={() => {
            $address = id
            axios.post('/connect', { address: id })
          }}
        >
          <span class="flex justify-between gap-2 w-full"><span>{name}</span><span class="text-white/60 text-xs">{rssi != undefined ? `${rssi} dBm` : ''}</span></span>
        </button>
      {/each}
    </div>
  </Card>
{/if}
