<script lang="ts">
  import { broadcastId, channels, myNodeNum, nodes, packets, version, type MeshPacket } from 'api/src/vars'
  import Card from './lib/Card.svelte'
  import { getNodeById, getNodeName, getNodeNameById, getRelayName, getTransportLabel, scrollToBottom, summarizeTelemetry, testPacket } from './lib/util'
  import Modal from './lib/Modal.svelte'
  import { messageDestination } from './Message.svelte'
  import OpenLayersMap from './lib/OpenLayersMap.svelte'
  import { tick } from 'svelte'
  import { getSvgUri } from './Map.svelte'
  import { highlightOwnNode } from './Settings.svelte'

  function shouldPacketBeShown(packet: MeshPacket, includeTx, filterText: string) {
    if (filterText) {
      if (!(getNodeNameById(packet.from).toLowerCase().includes(filterText.toLowerCase()) || getNodeNameById(packet.to).toLowerCase().includes(filterText.toLowerCase()))) return false
    }
    if (!includeTx && packet.from == $myNodeNum && !packet.data && !packet.message && !packet.notification) return false
    if (!includeTx && packet.data?.$typeName == 'meshtastic.Telemetry' && packet.from == $myNodeNum) return false
    if (!includeTx && packet.data?.$typeName == 'meshtastic.Routing') return false
    return true
  }

  let packetsDiv: HTMLDivElement
  let includeTx = false
  let messagesOnly = false
  let selectedPacket: MeshPacket
  let filterText = ''
  let unseenMessages = false
  let showCsvModal = false
  let csvText: string
  let csvTextElement: HTMLPreElement
  export let ol: OpenLayersMap = undefined

  $: if ($packets) scrollToBottom(packetsDiv, false, (unseen) => (unseenMessages = unseen))
  $: messagesOnly, scrollToBottom(packetsDiv, true, (unseen) => (unseenMessages = unseen))
  $: if (showCsvModal) {
    tick().then(selectCSV)
  }

  function selectCSV() {
    window.getSelection().selectAllChildren(csvTextElement)
  }

  /** Generate CSV text based on the html content in the packetsDiv */
  function generateCSV() {
    try {
      let log = []
      log.push('Date,Nodes,Channel,SNR,RSSI,Type,Hops,Data')
      for (let packetDiv of packetsDiv.children) {
        if (packetDiv.children?.length < 7) continue
        let line = []
        for (let index of [0, 1, 2, 3, 4, 5, 6, 8]) {
          line.push(`"${packetDiv.children[index]?.textContent.trim() || ''}"`)
        }
        log.push(line.join(','))
      }
      showCsvModal = true
      csvText = log.join('\n')
    } catch (e) {
      console.error('Unable to generate CSV', e)
    }
  }

  const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'numeric', hour: 'numeric', minute: 'numeric' })

  function formatTime(seconds: number) {
    return seconds ? dateFormat.format(seconds * 1000) : ''
  }

  function getType(packet: MeshPacket) {
    if (packet.payloadVariant?.case == 'encrypted') return 'Encrypted'
    if (packet.notification) return 'Notification'
    if (packet.message) return packet.message.alert ? 'Alert' : 'Message'
    let typeName = packet.data?.variant?.value?.$typeName ?? packet.data?.$typeName
    // Ports without a decoded payload are identified by their port name
    return typeName ? typeName.replace('meshtastic.', '') : (packet.portName?.replace(/_APP$/, '') ?? '')
  }

  function showPin(packet: MeshPacket) {
    let node = getNodeById(packet.from)
    let description = getNodeName(node)
    let icon = getSvgUri(String(node.num))
    if (packet.rxTime) {
      description += ' (' + formatTime(packet.rxTime) + ')'
    }
    let lat = packet.data.latitudeI / 10000000
    let long = packet.data.longitudeI / 10000000
    ol.showPin(description, long, lat, icon)
  }
</script>

<Modal title="Packet Detail" visible={selectedPacket != undefined}>
  <pre>{JSON.stringify(selectedPacket, undefined, 2)}</pre>
</Modal>

<Modal title="CSV Log" bind:visible={showCsvModal}>
  <pre id="csvTextElement" bind:this={csvTextElement}>{csvText}</pre>
</Modal>

<Card title="Log" {...$$restProps} class="min-h-36">
  <h2 slot="title" class="flex gap-2 font-bold rounded-t px-2">
    <div class="w-28">Date</div>
    <div class="w-44 whitespace-nowrap overflow-hidden">Nodes</div>
    <div class="w-7">Ch</div>
    <div class="w-10">SNR</div>
    <div class="w-10">RSSI</div>
    <div class="w-36">Type</div>
    <div class="w-10">Hops</div>
    <div class="w-52"></div>
  </h2>
  <div bind:this={packetsDiv} class="p-1 px-2 text-sm overflow-auto grid h-full content-start overflow-x-hidden">
    {#each $packets.filter((p) => shouldPacketBeShown(p, includeTx, filterText)) || [] as packet (packet)}
      {#if !messagesOnly || packet.message?.show}
        <div class="flex gap-2 whitespace-nowrap {($highlightOwnNode && packet.from === $myNodeNum) ? 'text-white/90' : ''}">
          <div class="w-28">{formatTime(packet.rxTime)}</div>

          <!-- Nodes -->
          <div class="w-44 flex gap-1 overflow-hidden">
            <div class="">
              <img class="h-4 inline-block" src={getSvgUri(String(packet.from))} alt="Node {packet.from}" />
              {getNodeNameById(packet.from)}
            </div>
            {#if packet.to && packet.to != 4294967295}
              <div>to</div>
              <div class="">{getNodeNameById(packet.to)}</div>
            {/if}
          </div>
          <div class="w-7">{packet.channel}</div>
          <div class="w-10">{packet.hopStart == packet.hopLimit ? packet.rxSnr || '' : ''}{getTransportLabel(packet)}</div>
          <div class="w-10">{packet.hopStart == packet.hopLimit ? packet.rxRssi || '' : ''}</div>
          <div class="w-36">{getType(packet)}</div>

          <div class="w-10" title={packet.relayNode ? `Relayed by ${getRelayName(packet.relayNode)}` : ''}>
            {#if packet.hopStart}{packet.hopStart - packet.hopLimit} / {packet.hopStart}{/if}
          </div>
          <div class="w-14 flex gap-0.5">
            <button on:click={() => (selectedPacket = packet)}>🔍</button>
            {#if packet.data?.$typeName == 'meshtastic.Position'}
              <button title="Fly To" on:click={() => showPin(packet)}>🌐</button>
            {/if}
            {#if packet.xeddsaSigned}
              <span title="Signature verified (XEdDSA)" class="cursor-help">🔏</span>
            {/if}
            {#if packet.pkiEncrypted}
              <span title="Encrypted with public key (PKI)" class="cursor-help">🔒</span>
            {/if}
          </div>
          {#if packet.data?.variant?.case == 'deviceMetrics'}
            <div class="bg-green-500/20 rounded px-1 my-0.5 text-xs ring-0 text-green-200 mx-2 w-fit">
              {Number(packet.data?.variant?.value?.voltage).toFixed(1)}V {packet.data?.variant?.value?.batteryLevel}%
            </div>
          {:else if packet.data?.$typeName == 'meshtastic.Telemetry' && packet.data?.variant?.case}
            <div class="bg-green-500/20 rounded px-1 my-0.5 text-xs ring-0 text-green-200 mx-2 w-fit">
              {summarizeTelemetry(packet.data.variant)}
            </div>
          {:else if packet.notification}
            <div class="bg-amber-700/40 rounded px-1 my-0.5 text-xs ring-0 text-amber-100 mx-2 w-fit">
              {packet.notification.message}
            </div>
          {:else if packet.data?.$typeName == 'meshtastic.StatusMessage'}
            <div class="bg-sky-800/60 rounded px-1 my-0.5 text-xs ring-0 text-sky-100 mx-2 w-fit">
              {packet.data.status}
            </div>
          {:else if packet.portName == 'MESH_BEACON_APP' && packet.data}
            <div class="bg-sky-800/60 rounded px-1 my-0.5 text-xs ring-0 text-sky-100 mx-2 w-fit">
              {packet.data.message}{packet.data.offerChannel?.name ? ` (offers channel ${packet.data.offerChannel.name})` : ''}
            </div>
          {:else if packet.data?.$typeName == 'meshtastic.Position'}
            <div class="bg-teal-800/60 rounded px-1 my-0.5 text-xs ring-0 text-teal-200 mx-2 w-fit">
              ({(packet.data.latitudeI / 10000000).toFixed(3)}, {(packet.data.longitudeI / 10000000).toFixed(3)}) {packet.data.altitude ?? '?'}m asl
            </div>
          {:else if packet.data?.$typeName == 'meshtastic.User'}
            <div class="bg-indigo-800/60 rounded px-1 my-0.5 text-xs ring-0 text-indigo-300 mx-2 w-fit">
              {packet?.data?.longName}
            </div>
          {:else if packet.data?.$typeName == 'meshtastic.Routing' && packet?.data?.variant?.value}
            <div class="bg-pink-800/40 rounded px-1 my-0.5 text-xs ring-0 text-white/80 mx-2 w-fit">
              {packet?.data?.variant?.value}
            </div>
          {:else if packet.data?.$typeName == 'meshtastic.RouteDiscovery'}
            <div class="bg-purple-800/60 rounded px-1 my-0.5 text-xs ring-0 text-white/80 mx-2 w-fit">
              {[packet.to, ...packet?.data?.route, packet.from].map((id) => getNodeNameById(id)).join(' -> ')}
            </div>
          {:else if packet.neighbors?.length}
            <div class="bg-fuchsia-800/60 rounded px-1 my-0.5 text-xs ring-0 text-white/80 mx-2 w-fit">
              {packet.neighbors.map(({ nodeId }) => getNodeNameById(nodeId)).join(', ')}
            </div>
          {/if}
        </div>
      {/if}
      {#if packet.message?.show}
        <div class="bg-blue-500/20 rounded px-1 ring-1 my-0.5 text-sm w-fit">
          {#if packet.to == broadcastId}
            <button on:click={() => ($messageDestination = packet.channel)} class="font-bold text-white">{channels.value[packet.channel]?.settings?.name || 'Primary'}</button>
          {/if}
          {#if packet.message.alert}<span title="Alert">🔔</span>{/if}
          <button class="font-bold" on:click={() => ($messageDestination = packet.from)}>{getNodeNameById(packet.from)}:</button>
          {packet.message.readable ?? packet.message.data}
        </div>
      {/if}
      <!-- <div>{JSON.stringify(packet)}</div> -->
    {/each}
  </div>
  <h2 class="relative font-normal text-sm self-end flex gap-4">
    <label>Self Metrics <input type="checkbox" bind:checked={includeTx} /></label>
    <label>Messages Only <input type="checkbox" bind:checked={messagesOnly} /></label>
    <label class="flex gap-1"
      >Filter <input class="rounded bg-black text-blue-300 font-bold px-2 w-20" type="text" bind:value={filterText} />
      {#if filterText}<button on:click={() => (filterText = '')} class="btn text-sm !py-0">Clear</button>{/if}
      <button class="btn btn-sm text-xs" on:click={() => generateCSV()}>CSV</button>
      {#if unseenMessages}<button class="btn !py-0 bottom-10" on:click={() => scrollToBottom(packetsDiv, true, (unseen) => (unseenMessages = unseen))}>Jump to new messages</button>{/if}
      {#if !$version}
        <button class="btn text-xs" on:click={testPacket}>Test Packet</button>
      {/if}
    </label>
  </h2>
</Card>
